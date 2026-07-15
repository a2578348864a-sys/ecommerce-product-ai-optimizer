import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  openIsolatedPublicBrowserSession,
  resolveSystemBrowser,
  type HumanAssistedBrowserCleanup,
} from "../collectors/amazon/browser-control";
import { writeArtifactsIdempotently } from "./artifact-writer";
import {
  buildAlibabaDomInspectionExpression,
  buildStage2PublicPageEvidence,
  buildStage2PublicRunEvidence,
  hasUnexpectedAlibabaRedirectOrigin,
  type AlibabaDomSignals,
  type Stage2PublicPageEvidence,
} from "./stage2-public-evidence-collector";
import {
  validateStage2EvidenceCollectionBrief,
  type Stage2EvidenceCollectionBrief,
} from "./stage2-evidence-collection-brief";

type Stage2PublicRunEvidence = ReturnType<typeof buildStage2PublicRunEvidence>;

const ALIBABA_ORIGIN = "https://www.alibaba.com";
const SEARCH_URL = "https://www.alibaba.com/trade/search?SearchText=hanging+closet+organizer+6+shelf+grey";

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function emptyCleanup(): HumanAssistedBrowserCleanup {
  return {
    pageClosed: false,
    browserClosed: false,
    forcedTerminationUsed: false,
    debugPortReleased: false,
    profileRemoved: false,
    browserProcessBaselineRestored: false,
  };
}

function blockedCode(classification: Stage2PublicPageEvidence["classification"]): string {
  return classification === "search_results" || classification === "supplier_product"
    ? "unknown_page_state"
    : classification;
}

export function reviewStage2PublicRunEvidence(run: Stage2PublicRunEvidence) {
  const { evidenceHash, ...body } = run;
  const reasonCodes: string[] = [];
  if (stableHash(body) !== evidenceHash) reasonCodes.push("source_run_hash_mismatch");
  const firstRedirectViolation = run.pages.findIndex((page) =>
    page.redirectOrigins.some((origin) => origin !== ALIBABA_ORIGIN));
  if (firstRedirectViolation >= 0) {
    reasonCodes.push("unexpected_intermediate_redirect_origin");
    if (run.pages.length > firstRedirectViolation + 1) {
      reasonCodes.push("collector_continued_after_fail_closed_redirect");
    }
  }
  if (run.pages.some((page) => page.classification === "unexpected_origin_redirect"
    && page.finalOrigin === ALIBABA_ORIGIN)) {
    reasonCodes.push("page_classification_conflicts_with_recorded_final_origin");
  }
  const reviewBody = {
    schemaVersion: "stage2-public-evidence-run-review.v1" as const,
    sourceRunId: run.runId,
    sourceRunEvidenceHash: evidenceHash,
    status: reasonCodes.length > 0
      ? "non_authoritative_failed_evidence" as const
      : "authoritative_failed_or_completed_evidence" as const,
    reasonCodes,
    historicalRunModified: false as const,
    realWebsiteRerunPerformed: false as const,
    stage2SubmissionEligible: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
  };
  return { ...reviewBody, evidenceHash: stableHash(reviewBody) };
}

export async function runStage2PublicEvidenceCollection(input: {
  briefFile: string;
  outputDirectory: string;
  capturedAt: string;
}) {
  const brief = JSON.parse(readFileSync(resolve(input.briefFile), "utf8")) as Stage2EvidenceCollectionBrief;
  const briefValidation = validateStage2EvidenceCollectionBrief(brief);
  if (briefValidation.status !== "valid_pending_authorization") throw new Error("STAGE2_PUBLIC_BRIEF_INVALID");
  if (!Number.isFinite(Date.parse(input.capturedAt))) throw new Error("STAGE2_PUBLIC_CAPTURED_AT_INVALID");

  const authorizationBody = {
    schemaVersion: "stage2-evidence-collection-authorization.v1" as const,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    authorizedAt: input.capturedAt,
    authorizedBy: "project_owner" as const,
    allowedOrigin: ALIBABA_ORIGIN,
    sampleId: "stage2-high-01" as const,
    navigationBudget: {
      maximum: 4 as const,
      searchPages: 1 as const,
      supplierProductPages: 3 as const,
      samples: 1 as const,
      automaticRetries: 0 as const,
    },
    boundary: brief.boundary,
  };
  const authorization = { ...authorizationBody, evidenceHash: stableHash(authorizationBody) };
  const browser = resolveSystemBrowser();
  if (!browser) throw new Error("STAGE2_PUBLIC_BROWSER_NOT_FOUND");

  const pages: Stage2PublicPageEvidence[] = [];
  let session: Awaited<ReturnType<typeof openIsolatedPublicBrowserSession>> | null = null;
  let cleanup = emptyCleanup();
  let status: "completed" | "failed" = "failed";
  let errorCode: string | null = "unknown_page_state";
  let reasonCodes: string[] = ["run_not_started"];
  let navigationUsed = 0;

  try {
    session = await openIsolatedPublicBrowserSession({
      browser,
      allowedOrigins: [ALIBABA_ORIGIN],
      maxNavigations: 4,
      headless: false,
    });
    const searchNavigation = await session.navigate(SEARCH_URL);
    navigationUsed = session.navigationCount;
    if (!searchNavigation.allowedFinalOrigin
      || hasUnexpectedAlibabaRedirectOrigin(searchNavigation.redirectOrigins)) {
      errorCode = "unexpected_origin_redirect";
      reasonCodes = [searchNavigation.allowedFinalOrigin
        ? "search_intermediate_redirect_origin_not_allowed"
        : "search_final_origin_not_allowed"];
    } else {
      const searchSignals = await session.evaluateDomByValue<AlibabaDomSignals>(buildAlibabaDomInspectionExpression());
      const searchEvidence = buildStage2PublicPageEvidence({
        navigation: searchNavigation,
        signals: searchSignals,
        amazonTitle: brief.sample.amazonObservedTitle,
      });
      pages.push(searchEvidence);
      if (searchEvidence.classification !== "search_results") {
        errorCode = blockedCode(searchEvidence.classification);
        reasonCodes = [...searchEvidence.classificationReasonCodes];
      } else {
        const productLinks = searchEvidence.productLinks.slice(0, 3);
        if (productLinks.length === 0) {
          errorCode = "unknown_page_state";
          reasonCodes = ["no_allowed_supplier_product_links"];
        } else {
          for (const productUrl of productLinks) {
            const productNavigation = await session.navigate(productUrl);
            navigationUsed = session.navigationCount;
            if (!productNavigation.allowedFinalOrigin
              || hasUnexpectedAlibabaRedirectOrigin(productNavigation.redirectOrigins)) {
              errorCode = "unexpected_origin_redirect";
              reasonCodes = [productNavigation.allowedFinalOrigin
                ? "product_intermediate_redirect_origin_not_allowed"
                : "product_final_origin_not_allowed"];
              break;
            }
            const productSignals = await session.evaluateDomByValue<AlibabaDomSignals>(buildAlibabaDomInspectionExpression());
            const productEvidence = buildStage2PublicPageEvidence({
              navigation: productNavigation,
              signals: productSignals,
              amazonTitle: brief.sample.amazonObservedTitle,
            });
            pages.push(productEvidence);
            if (productEvidence.classification !== "supplier_product") {
              errorCode = blockedCode(productEvidence.classification);
              reasonCodes = [...productEvidence.classificationReasonCodes];
              break;
            }
            if (productEvidence.variantIdentity?.status === "confirmed") {
              status = "completed";
              errorCode = null;
              reasonCodes = [];
              break;
            }
            errorCode = "variant_identity_cannot_be_confirmed";
            reasonCodes = [...(productEvidence.variantIdentity?.reasonCodes ?? ["variant_identity_unknown"])];
          }
        }
      }
    }
  } catch (error) {
    errorCode = error instanceof Error && error.message.startsWith("PUBLIC_NAVIGATION_FAILED")
      ? "access_denied_or_service_unavailable"
      : "browser_or_navigation_failed";
    reasonCodes = [error instanceof Error ? error.message.slice(0, 200) : "unknown_runtime_error"];
  } finally {
    navigationUsed = session?.navigationCount ?? navigationUsed;
    if (session) cleanup = await session.close();
  }

  if (!Object.values(cleanup).every((value) => value === true || value === false)
    || !cleanup.pageClosed || !cleanup.browserClosed || !cleanup.debugPortReleased
    || !cleanup.profileRemoved || !cleanup.browserProcessBaselineRestored) {
    status = "failed";
    errorCode = "browser_cleanup_failed";
    reasonCodes = [...new Set([...reasonCodes, "owned_browser_resources_not_fully_restored"])];
  }

  const runId = `stage2-public-${stableHash({ briefHash: brief.briefHash, capturedAt: input.capturedAt }).slice(0, 24)}`;
  const run = buildStage2PublicRunEvidence({
    runId,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    capturedAt: input.capturedAt,
    status,
    errorCode,
    reasonCodes,
    pages,
    navigationBudget: { maximum: 4, used: navigationUsed },
    cleanup,
  });
  const summaryBody = {
    schemaVersion: "stage2-public-evidence-generation-summary.v1" as const,
    runId,
    runEvidenceHash: run.evidenceHash,
    authorizationEvidenceHash: authorization.evidenceHash,
    status,
    errorCode,
    navigationCount: navigationUsed,
    pageEvidenceCount: pages.length,
    stage2SubmissionGenerated: false,
    candidateGenerated: false,
    databaseWritten: false,
  };
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const artifactWrite = writeArtifactsIdempotently(input.outputDirectory, [
    { relativePath: "stage2-evidence-collection-authorization.v1.json", content: jsonContent(authorization) },
    { relativePath: "stage2-public-evidence-collection-run.v1.json", content: jsonContent(run) },
    { relativePath: "generation-summary.stage2-public-evidence.v1.json", content: jsonContent(summary) },
  ], "STAGE2_PUBLIC_EVIDENCE_OUTPUT_CONFLICT");
  return { run, summary, artifactWrite };
}
