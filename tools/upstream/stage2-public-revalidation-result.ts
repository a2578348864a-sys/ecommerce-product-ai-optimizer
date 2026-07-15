import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import {
  validateStage2PublicRevalidationAuthorization,
  type Stage2PublicRevalidationAuthorization,
} from "./run-stage2-public-revalidation";
import type { reviewStage2PublicRunEvidence } from "./run-stage2-public-evidence-collection";
import type { buildStage2PublicRunEvidence } from "./stage2-public-evidence-collector";
import {
  validateStage2PublicRevalidationBrief,
  type Stage2PublicRevalidationBrief,
} from "./stage2-public-revalidation-brief";

type PublicRun = ReturnType<typeof buildStage2PublicRunEvidence>;
type PublicRunReview = ReturnType<typeof reviewStage2PublicRunEvidence>;

function assertEvidenceHash(value: { evidenceHash: string }, code: string): void {
  const { evidenceHash, ...body } = value;
  if (stableHash(body) !== evidenceHash) throw new Error(code);
}

export function buildStage2PublicRevalidationResult(input: {
  brief: Stage2PublicRevalidationBrief;
  authorization: Stage2PublicRevalidationAuthorization;
  run: PublicRun;
  review: PublicRunReview;
}) {
  if (validateStage2PublicRevalidationBrief(input.brief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_REVALIDATION_RESULT_BRIEF_INVALID");
  }
  if (validateStage2PublicRevalidationAuthorization(input.brief, input.authorization).status
    !== "valid_granted_authorization") {
    throw new Error("STAGE2_REVALIDATION_RESULT_AUTHORIZATION_INVALID");
  }
  assertEvidenceHash(input.run, "STAGE2_REVALIDATION_RESULT_RUN_HASH_INVALID");
  assertEvidenceHash(input.review, "STAGE2_REVALIDATION_RESULT_REVIEW_HASH_INVALID");
  if (input.run.status !== "failed"
    || input.run.briefId !== input.brief.sourceEvidence.originalBriefId
    || input.run.briefHash !== input.brief.sourceEvidence.originalBriefHash
    || input.run.navigationBudget.maximum !== input.brief.requestedScope.maxTotalNavigations
    || input.run.navigationBudget.used > input.run.navigationBudget.maximum
    || input.review.sourceRunId !== input.run.runId
    || input.review.sourceRunEvidenceHash !== input.run.evidenceHash
    || input.review.status !== "authoritative_failed_or_completed_evidence"
    || input.review.stage2SubmissionEligible !== false) {
    throw new Error("STAGE2_REVALIDATION_RESULT_SOURCE_LINKAGE_INVALID");
  }
  const cleanup = input.run.cleanup;
  if (!cleanup.pageClosed || !cleanup.browserClosed || !cleanup.debugPortReleased
    || !cleanup.profileRemoved || !cleanup.browserProcessBaselineRestored) {
    throw new Error("STAGE2_REVALIDATION_RESULT_CLEANUP_INVALID");
  }
  const source = {
    revalidationBriefHash: input.brief.briefHash,
    authorizationEvidenceHash: input.authorization.evidenceHash,
    runEvidenceHash: input.run.evidenceHash,
    reviewEvidenceHash: input.review.evidenceHash,
  };
  const body = {
    schemaVersion: "stage2-public-revalidation-result.v1" as const,
    resultId: `stage2-revalidation-result-${stableHash(source).slice(0, 24)}`,
    revalidationBriefId: input.brief.briefId,
    ...source,
    runId: input.run.runId,
    capturedAt: input.run.capturedAt,
    status: "failed_closed" as const,
    errorCode: input.run.errorCode,
    reasonCodes: [...input.run.reasonCodes],
    proofLevel: "authoritative_failure_evidence" as const,
    navigationBudget: { ...input.run.navigationBudget },
    pageEvidenceCount: input.run.pages.length,
    stage2EvidenceReady: false as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
    cleanup: { ...cleanup },
    inputHash: stableHash(source),
  };
  return { ...body, evidenceHash: stableHash(body) };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

export function generateStage2PublicRevalidationResult(input: {
  briefFile: string;
  authorizationFile: string;
  runFile: string;
  reviewFile: string;
  outputDirectory: string;
}) {
  const result = buildStage2PublicRevalidationResult({
    brief: readJson<Stage2PublicRevalidationBrief>(input.briefFile),
    authorization: readJson<Stage2PublicRevalidationAuthorization>(input.authorizationFile),
    run: readJson<PublicRun>(input.runFile),
    review: readJson<PublicRunReview>(input.reviewFile),
  });
  const artifactWrite = writeArtifactsIdempotently(input.outputDirectory, [{
    relativePath: "stage2-public-revalidation-result.v1.json",
    content: `${JSON.stringify(result, null, 2)}\n`,
  }], "STAGE2_REVALIDATION_RESULT_OUTPUT_CONFLICT");
  return { result, artifactWrite };
}
