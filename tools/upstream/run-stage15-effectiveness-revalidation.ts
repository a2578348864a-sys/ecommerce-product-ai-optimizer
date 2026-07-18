import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  openIsolatedPublicBrowserSession,
  resolveSystemBrowser,
  type HumanAssistedBrowserCleanup,
  type IsolatedPublicBrowserSession,
  type PublicPageNavigationResult,
} from "../collectors/amazon/browser-control";
import {
  buildAmazonPageDiagnostic,
  buildAmazonPageDiagnosticDomExpression,
  type AmazonPageDomSignals,
} from "../collectors/amazon/page-diagnostics";
import { writeArtifactsIdempotently } from "./artifact-writer";

export const STAGE15_EFFECTIVENESS_REVALIDATION_AUTHORIZATION_PHRASE =
  "\u6211\u786e\u8ba4\u6309 stage15-effectiveness-revalidation-brief.v1 \u56fa\u5b9a\u8303\u56f4\u6267\u884c\u4e00\u6b21 A \u72ec\u7acb\u8bc1\u636e\u590d\u9a8c\u3002";

const AMAZON_ORIGIN = "https://www.amazon.com";
const REQUIRED_EVIDENCE = [
  "identity_reconfirmed_by_new_traceable_evidence",
  "product_function_and_variant_clarified",
  "dimensions_weight_or_missing_reason_recorded",
  "material_construction_or_missing_reason_recorded",
  "assembly_usage_and_execution_risks_checked",
  "independent_counter_evidence_checked",
] as const;

export type Stage15EffectivenessRevalidationTarget = {
  pilotItemId: string;
  origin: "https://www.amazon.com";
  safePath: string;
  sourceUrlHash: string;
};

export type Stage15EffectivenessRevalidationBrief = {
  schemaVersion: "stage15-effectiveness-revalidation-brief.v1";
  briefId: string;
  status: "pending_user_authorization";
  sourceProtocolHash: string;
  sourceBlindPacketHash: string;
  createdAt: string;
  browserIsolation: {
    browser: "system_chrome";
    profile: "new_temporary_anonymous_profile";
    control: "loopback_dynamic_cdp";
    initialPage: "about:blank";
    dailyProfileForbidden: boolean;
    loginForbidden: boolean;
  };
  accessBudget: {
    runs: 1;
    initialPages: 1;
    productDetailNavigations: 10;
    searchNavigations: 0;
    retries: 0;
  };
  allowedScope: {
    origin: "https://www.amazon.com";
    pathPattern: "/dp/{boundASIN}";
    targetCount: 10;
    redirectsOutsideOriginAllowed: boolean;
    productVariantsOrAdditionalLinksAllowed: boolean;
  };
  targets: Stage15EffectivenessRevalidationTarget[];
  evidenceWhitelist: string[];
  prohibitedInputs: string[];
  stopConditions: string[];
  outputBoundary: {
    evidenceOnly: boolean;
    outcomeAutoDecisionAllowed: boolean;
    stage1OrStage15MutationAllowed: boolean;
    stage2OrCandidateCreationAllowed: boolean;
    databaseWriteAllowed: boolean;
  };
  cleanupRequired: string[];
  userAuthorization: null;
  externalWebsiteAccessed: false;
  stage2FieldsConsumed: false;
  productionDatabaseWritten: false;
  externalAiApiCalled: false;
  briefHash: string;
};

export type Stage15ProductDetailDomSignals = {
  expectedAsin: string;
  observedAsin: string | null;
  identityConfirmed: boolean;
  title: string | null;
  variantText: string | null;
  dimensionsAndWeight: Array<{ label: string; value: string }>;
  materialAndConstruction: Array<{ label: string; value: string }>;
  assemblyUsageAndRiskFacts: Array<{ label: string; value: string }>;
  featureBullets: string[];
  reviewSnippets: string[];
  markerCounts: {
    title: number;
    detailRows: number;
    featureBullets: number;
    reviewSnippets: number;
  };
};

type SessionFactory = (input: {
  allowedOrigins: readonly string[];
  maxNavigations: number;
  headless: boolean;
}) => Promise<IsolatedPublicBrowserSession>;

function withoutHash<T extends Record<string, unknown>>(value: T, key: keyof T) {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

function cleanText(value: string | null | undefined, limit: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, limit) : null;
}

function elementText(element: Element | null, limit = 240) {
  return cleanText(element?.textContent, limit);
}

function labelValueFromElement(element: Element) {
  const label = elementText(element.querySelector("th"), 100);
  const value = elementText(element.querySelector("td"), 240);
  if (label && value) return { label, value };
  const text = elementText(element, 340);
  if (!text) return null;
  const split = text.match(/^([^:]{2,100}):\s*(.{1,240})$/);
  return split ? { label: split[1].trim(), value: split[2].trim() } : null;
}

function uniqueEntries(entries: Array<{ label: string; value: string }>) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.label.toLowerCase()}\u0000${entry.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueText(values: Array<string | null>, maximum: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= maximum) break;
  }
  return result;
}

export function inspectStage15AmazonProductDetailDom(
  root: Document,
  expectedAsin: string,
): Stage15ProductDetailDomSignals {
  const asinNode = root.querySelector("#ASIN") ?? root.querySelector("input[name='ASIN']");
  const observedAsin = cleanText(asinNode?.getAttribute("value"), 10)?.toUpperCase() ?? null;
  const title = elementText(root.querySelector("#productTitle"), 240);
  const variantText = elementText(root.querySelector(
    "#variation_color_name .selection, #variation_size_name .selection, "
      + "#variation_style_name .selection, #variation_pattern_name .selection",
  ), 160);
  const detailElements = Array.from(root.querySelectorAll(
    "#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, "
      + "#detailBullets_feature_div li",
  )).slice(0, 40);
  const detailEntries = uniqueEntries(detailElements
    .map((element) => labelValueFromElement(element))
    .filter((entry): entry is { label: string; value: string } => entry !== null));
  const dimensionsAndWeight = detailEntries.filter((entry) =>
    /dimension|weight|size|package dimension/i.test(entry.label)).slice(0, 8);
  const materialAndConstruction = detailEntries.filter((entry) =>
    /material|fabric|construction|frame|finish/i.test(entry.label)).slice(0, 8);
  const assemblyUsageAndRiskFacts = detailEntries.filter((entry) =>
    /assembly|install|mount|care|recommended use|capacity|maximum weight|load/i.test(entry.label)).slice(0, 8);
  const featureBullets = uniqueText(Array.from(root.querySelectorAll(
    "#feature-bullets li span.a-list-item, #feature-bullets li",
  )).map((element) => elementText(element, 240)), 6);
  const reviewSnippets = uniqueText(Array.from(root.querySelectorAll(
    "[data-hook='review-collapsed'], [data-hook='review-body'] span",
  )).map((element) => elementText(element, 240)), 3);
  return {
    expectedAsin,
    observedAsin,
    identityConfirmed: observedAsin === expectedAsin && title !== null,
    title,
    variantText,
    dimensionsAndWeight,
    materialAndConstruction,
    assemblyUsageAndRiskFacts,
    featureBullets,
    reviewSnippets,
    markerCounts: {
      title: title ? 1 : 0,
      detailRows: detailEntries.length,
      featureBullets: featureBullets.length,
      reviewSnippets: reviewSnippets.length,
    },
  };
}

const functionSource = (fn: (...args: never[]) => unknown) => fn.toString();

export function buildStage15AmazonProductDetailDomExpression(expectedAsin: string) {
  if (!/^[A-Z0-9]{10}$/.test(expectedAsin)) {
    throw new Error("STAGE15_REVALIDATION_ASIN_INVALID");
  }
  return `(() => {
    const cleanText = ${functionSource(cleanText)};
    const elementText = ${functionSource(elementText)};
    const labelValueFromElement = ${functionSource(labelValueFromElement)};
    const uniqueEntries = ${functionSource(uniqueEntries)};
    const uniqueText = ${functionSource(uniqueText)};
    const inspectStage15AmazonProductDetailDom = ${functionSource(inspectStage15AmazonProductDetailDom)};
    return inspectStage15AmazonProductDetailDom(document, ${JSON.stringify(expectedAsin)});
  })()`;
}

function validateBrief(brief: Stage15EffectivenessRevalidationBrief) {
  if (stableHash(withoutHash(brief as unknown as Record<string, unknown>, "briefHash")) !== brief.briefHash) {
    throw new Error("STAGE15_REVALIDATION_BRIEF_HASH_INVALID");
  }
  if (brief.schemaVersion !== "stage15-effectiveness-revalidation-brief.v1"
    || brief.status !== "pending_user_authorization"
    || brief.browserIsolation.browser !== "system_chrome"
    || brief.browserIsolation.profile !== "new_temporary_anonymous_profile"
    || brief.browserIsolation.control !== "loopback_dynamic_cdp"
    || brief.browserIsolation.initialPage !== "about:blank"
    || !brief.browserIsolation.dailyProfileForbidden
    || !brief.browserIsolation.loginForbidden) {
    throw new Error("STAGE15_REVALIDATION_BRIEF_ISOLATION_INVALID");
  }
  if (brief.accessBudget.runs !== 1
    || brief.accessBudget.initialPages !== 1
    || brief.accessBudget.productDetailNavigations !== 10
    || brief.accessBudget.searchNavigations !== 0
    || brief.accessBudget.retries !== 0) {
    throw new Error("STAGE15_REVALIDATION_BRIEF_BUDGET_INVALID");
  }
  if (brief.allowedScope.origin !== AMAZON_ORIGIN
    || brief.allowedScope.pathPattern !== "/dp/{boundASIN}"
    || brief.allowedScope.targetCount !== 10
    || brief.allowedScope.redirectsOutsideOriginAllowed
    || brief.allowedScope.productVariantsOrAdditionalLinksAllowed) {
    throw new Error("STAGE15_REVALIDATION_BRIEF_SCOPE_INVALID");
  }
  if (brief.targets.length !== 10
    || new Set(brief.targets.map((target) => target.pilotItemId)).size !== 10
    || new Set(brief.targets.map((target) => target.safePath)).size !== 10) {
    throw new Error("STAGE15_REVALIDATION_TARGET_COUNT_INVALID");
  }
  for (const target of brief.targets) {
    if (target.origin !== AMAZON_ORIGIN || !/^\/dp\/[A-Z0-9]{10}$/.test(target.safePath)
      || target.sourceUrlHash !== stableHash({ origin: target.origin, safePath: target.safePath })) {
      throw new Error("STAGE15_REVALIDATION_TARGET_BINDING_INVALID");
    }
  }
  if (REQUIRED_EVIDENCE.some((entry) => !brief.evidenceWhitelist.includes(entry))
    || !brief.outputBoundary.evidenceOnly
    || brief.outputBoundary.outcomeAutoDecisionAllowed
    || brief.outputBoundary.stage1OrStage15MutationAllowed
    || brief.outputBoundary.stage2OrCandidateCreationAllowed
    || brief.outputBoundary.databaseWriteAllowed
    || brief.userAuthorization !== null
    || brief.externalWebsiteAccessed
    || brief.stage2FieldsConsumed
    || brief.productionDatabaseWritten
    || brief.externalAiApiCalled) {
    throw new Error("STAGE15_REVALIDATION_EVIDENCE_BOUNDARY_INVALID");
  }
}

function safeUrl(value: string) {
  try {
    const parsed = new URL(value);
    return { origin: parsed.origin, path: parsed.pathname.slice(0, 160) };
  } catch {
    return { origin: null, path: null };
  }
}

function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_runtime_error";
  return cleanText(message
    .replace(/\b(?:token|authorization|password|cookie)\s*[:=]\s*\S+/gi, "[redacted-sensitive]"), 200)
    ?? "unknown_runtime_error";
}

function cleanupPassed(cleanup: HumanAssistedBrowserCleanup | null): cleanup is HumanAssistedBrowserCleanup {
  return cleanup !== null
    && cleanup.pageClosed
    && cleanup.browserClosed
    && cleanup.debugPortReleased
    && cleanup.profileRemoved
    && cleanup.browserProcessBaselineRestored;
}

function pageFailureCode(classification: string) {
  if (classification === "captcha") return "captcha";
  if (classification === "login_wall") return "login_wall";
  if (classification === "access_denied") return "access_denied";
  if (classification === "privacy_prompt_visible" || classification === "privacy_prompt_unknown") {
    return classification;
  }
  if (classification === "unexpected_redirect") return "unexpected_redirect";
  return "unknown_page_or_layout";
}

function missingReason<T>(value: T[] | string | null, reason: string) {
  if (Array.isArray(value)) return value.length === 0 ? reason : null;
  return value === null || value === "" ? reason : null;
}

export async function executeAuthorizedStage15EffectivenessRevalidation(input: {
  brief: Stage15EffectivenessRevalidationBrief;
  authorizationPhrase: string;
  capturedAt: string;
  openSession: SessionFactory;
}) {
  validateBrief(input.brief);
  if (input.authorizationPhrase !== STAGE15_EFFECTIVENESS_REVALIDATION_AUTHORIZATION_PHRASE) {
    throw new Error("STAGE15_REVALIDATION_AUTHORIZATION_PHRASE_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.capturedAt))) {
    throw new Error("STAGE15_REVALIDATION_CAPTURED_AT_INVALID");
  }
  const authorizationBody = {
    schemaVersion: "stage15-effectiveness-revalidation-authorization.v1" as const,
    status: "granted_single_use" as const,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    authorizedAt: input.capturedAt,
    authorizationPhraseHash: stableHash({ phrase: input.authorizationPhrase }),
    navigationBudget: {
      productDetailNavigations: 10 as const,
      searchNavigations: 0 as const,
      retries: 0 as const,
    },
  };
  const authorization = { ...authorizationBody, evidenceHash: stableHash(authorizationBody) };
  const runId = `stage15-effectiveness-a-${stableHash({
    briefHash: input.brief.briefHash,
    authorizationEvidenceHash: authorization.evidenceHash,
    capturedAt: input.capturedAt,
  }).slice(0, 24)}`;

  let session: IsolatedPublicBrowserSession | null = null;
  let cleanup: HumanAssistedBrowserCleanup | null = null;
  const pages: Array<Record<string, unknown>> = [];
  let status: "evidence_collected_pending_human_evaluation" | "failed_closed" = "failed_closed";
  let errorCode: string | null = "browser_runtime_failed";
  let reasonCodes: string[] = [];
  let navigationUsed = 0;
  try {
    session = await input.openSession({
      allowedOrigins: [AMAZON_ORIGIN],
      maxNavigations: 10,
      headless: false,
    });
    for (const target of input.brief.targets) {
      const expectedAsin = target.safePath.slice("/dp/".length);
      const requestedUrl = `${target.origin}${target.safePath}`;
      const navigation = await session.navigate(requestedUrl);
      navigationUsed = session.navigationCount;
      const diagnosticSignals = await session.evaluateDomByValue<AmazonPageDomSignals>(
        buildAmazonPageDiagnosticDomExpression(),
      );
      const diagnostic = buildAmazonPageDiagnostic({
        requestedUrl,
        finalUrl: navigation.finalUrl,
        redirectUrls: [...navigation.redirectOrigins],
        mainDocumentHttpStatus: navigation.mainDocumentHttpStatus,
        mainDocumentContentType: navigation.mainDocumentContentType,
        navigationElapsedMs: navigation.navigationElapsedMs,
        domWaitElapsedMs: navigation.domWaitElapsedMs,
        readyState: navigation.readyState ?? diagnosticSignals.readyState,
        title: diagnosticSignals.title,
        visibleText: diagnosticSignals.visibleText,
        visibleTextLength: diagnosticSignals.visibleTextLength,
        markerSources: diagnosticSignals.markerSources,
        markers: diagnosticSignals.markers,
      });
      const finalSafeUrl = safeUrl(navigation.finalUrl);
      const pathAllowed = navigation.allowedFinalOrigin
        && finalSafeUrl.origin === target.origin
        && finalSafeUrl.path === target.safePath;
      const diagnosticAllowed = ["amazon_normal", "amazon_normal_variant"].includes(diagnostic.classification);
      if (!pathAllowed || !diagnosticAllowed) {
        errorCode = pathAllowed ? pageFailureCode(diagnostic.classification) : "unexpected_redirect";
        reasonCodes = pathAllowed
          ? [...diagnostic.classificationReasonCodes]
          : ["final_origin_or_path_not_bound_target"];
        const failedPageBody = {
          schemaVersion: "stage15-effectiveness-product-evidence.v1" as const,
          runId,
          briefId: input.brief.briefId,
          pilotItemId: target.pilotItemId,
          expectedAsin,
          sourceType: "direct_observation" as const,
          capturedAt: input.capturedAt,
          requestedUrl: { origin: target.origin, path: target.safePath },
          finalUrl: finalSafeUrl,
          pageDiagnostic: diagnostic,
          gate: { status: "failed_closed" as const, errorCode, reasonCodes },
          productEvidence: null,
        };
        pages.push({ ...failedPageBody, evidenceHash: stableHash(failedPageBody) });
        break;
      }
      const signals = await session.evaluateDomByValue<Stage15ProductDetailDomSignals>(
        buildStage15AmazonProductDetailDomExpression(expectedAsin),
      );
      if (!signals.identityConfirmed || signals.observedAsin !== expectedAsin || !signals.title) {
        errorCode = "product_identity_or_layout_unconfirmed";
        reasonCodes = ["bound_asin_or_main_product_title_unconfirmed"];
        const failedPageBody = {
          schemaVersion: "stage15-effectiveness-product-evidence.v1" as const,
          runId,
          briefId: input.brief.briefId,
          pilotItemId: target.pilotItemId,
          expectedAsin,
          sourceType: "direct_observation" as const,
          capturedAt: input.capturedAt,
          requestedUrl: { origin: target.origin, path: target.safePath },
          finalUrl: finalSafeUrl,
          pageDiagnostic: diagnostic,
          gate: { status: "failed_closed" as const, errorCode, reasonCodes },
          productEvidence: null,
        };
        pages.push({ ...failedPageBody, evidenceHash: stableHash(failedPageBody) });
        break;
      }
      const productEvidence = {
        observedAsin: signals.observedAsin,
        identityConfirmed: signals.identityConfirmed,
        title: signals.title,
        variantText: signals.variantText,
        dimensionsAndWeight: signals.dimensionsAndWeight,
        materialAndConstruction: signals.materialAndConstruction,
        assemblyUsageAndRiskFacts: signals.assemblyUsageAndRiskFacts,
        featureBullets: signals.featureBullets,
        reviewSnippets: signals.reviewSnippets,
        markerCounts: signals.markerCounts,
        missingReasons: {
          variantText: missingReason(signals.variantText, "variant_not_visible"),
          dimensionsAndWeight: missingReason(signals.dimensionsAndWeight, "dimensions_or_weight_not_visible"),
          materialAndConstruction: missingReason(signals.materialAndConstruction, "material_or_construction_not_visible"),
          assemblyUsageAndRiskFacts: missingReason(
            signals.assemblyUsageAndRiskFacts, "assembly_usage_or_capacity_not_visible",
          ),
          reviewSnippets: missingReason(signals.reviewSnippets, "counter_evidence_not_visible"),
        },
      };
      const pageBody = {
        schemaVersion: "stage15-effectiveness-product-evidence.v1" as const,
        runId,
        briefId: input.brief.briefId,
        pilotItemId: target.pilotItemId,
        expectedAsin,
        sourceType: "direct_observation" as const,
        capturedAt: input.capturedAt,
        requestedUrl: { origin: target.origin, path: target.safePath },
        finalUrl: finalSafeUrl,
        pageDiagnostic: diagnostic,
        gate: { status: "passed" as const, errorCode: null, reasonCodes: [] as string[] },
        productEvidence,
      };
      pages.push({ ...pageBody, evidenceHash: stableHash(pageBody) });
    }
    navigationUsed = session.navigationCount;
    if (pages.length === input.brief.targets.length
      && pages.every((page) => (page.gate as { status: string }).status === "passed")) {
      status = "evidence_collected_pending_human_evaluation";
      errorCode = null;
      reasonCodes = [];
    }
  } catch (error) {
    status = "failed_closed";
    errorCode = "browser_runtime_failed";
    reasonCodes = [cleanError(error)];
  } finally {
    if (session) {
      navigationUsed = session.navigationCount;
      try {
        cleanup = await session.close();
      } catch (error) {
        reasonCodes.push(cleanError(error));
      }
    }
  }
  if (!cleanupPassed(cleanup)) {
    status = "failed_closed";
    errorCode = "browser_cleanup_failed";
    reasonCodes.push("owned_browser_resources_not_fully_restored");
  }
  if (navigationUsed > 10) {
    status = "failed_closed";
    errorCode = "navigation_budget_exhausted";
    reasonCodes.push("product_detail_navigation_budget_exceeded");
  }
  const evidenceCount = pages.filter((page) =>
    (page.gate as { status: string }).status === "passed").length;
  const runBody = {
    schemaVersion: "stage15-effectiveness-revalidation-run.v1" as const,
    runId,
    proofLevel: "real_public_product_detail_evidence_only" as const,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    authorizationEvidenceHash: authorization.evidenceHash,
    capturedAt: input.capturedAt,
    status,
    errorCode,
    reasonCodes: [...new Set(reasonCodes)],
    realWebsiteAccessed: navigationUsed > 0,
    navigationBudget: {
      maximum: 10 as const,
      used: navigationUsed,
      productDetailNavigations: navigationUsed,
      searchNavigations: 0 as const,
      retries: 0 as const,
    },
    evidenceCount,
    pages,
    stage1OrStage15Mutated: false as const,
    stage2FieldsConsumed: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
    cleanup,
  };
  const run = { ...runBody, evidenceHash: stableHash(runBody) };
  const summaryBody = {
    schemaVersion: "stage15-effectiveness-revalidation-summary.v1" as const,
    runId,
    runEvidenceHash: run.evidenceHash,
    authorizationEvidenceHash: authorization.evidenceHash,
    status,
    errorCode,
    navigationUsed,
    evidenceCount,
    targetCount: input.brief.targets.length,
    outcomeAutoDecisionGenerated: false as const,
    stage1OrStage15Mutated: false as const,
    stage2FieldsConsumed: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
  };
  return {
    authorization,
    run,
    summary: { ...summaryBody, evidenceHash: stableHash(summaryBody) },
  };
}

const jsonContent = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export async function runAuthorizedStage15EffectivenessRevalidation(input: {
  briefFile: string;
  outputDirectory: string;
  authorizationPhrase: string;
  capturedAt: string;
}) {
  const outputDirectory = resolve(input.outputDirectory);
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
    throw new Error("STAGE15_REVALIDATION_OUTPUT_ALREADY_EXISTS");
  }
  const brief = JSON.parse(
    readFileSync(resolve(input.briefFile), "utf8"),
  ) as Stage15EffectivenessRevalidationBrief;
  const browser = resolveSystemBrowser();
  if (!browser || browser.browser !== "chrome") {
    throw new Error("STAGE15_REVALIDATION_SYSTEM_CHROME_NOT_FOUND");
  }
  const result = await executeAuthorizedStage15EffectivenessRevalidation({
    brief,
    authorizationPhrase: input.authorizationPhrase,
    capturedAt: input.capturedAt,
    openSession: (sessionInput) => openIsolatedPublicBrowserSession({ browser, ...sessionInput }),
  });
  const artifactWrite = writeArtifactsIdempotently(outputDirectory, [
    {
      relativePath: "stage15-effectiveness-revalidation-authorization.v1.json",
      content: jsonContent(result.authorization),
    },
    {
      relativePath: "stage15-effectiveness-revalidation-run.v1.json",
      content: jsonContent(result.run),
    },
    {
      relativePath: "generation-summary.stage15-effectiveness-revalidation.v1.json",
      content: jsonContent(result.summary),
    },
  ], "STAGE15_REVALIDATION_OUTPUT_CONFLICT");
  return { ...result, artifactWrite };
}
