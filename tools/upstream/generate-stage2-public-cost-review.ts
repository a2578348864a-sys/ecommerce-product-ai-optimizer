import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import {
  buildStage2PublicCostReviewRequest,
  validateStage2PublicCostReviewRequest,
  type Stage2PublicCostReviewSources,
} from "./stage2-public-cost-review";

type Input = {
  briefFile: string; runFile: string; evidenceFile: string; validationFile: string;
  previewFile: string; patchPreviewFile: string; createdAt: string; outputDirectory: string;
};

export function generateStage2PublicCostReview(input: Input) {
  const read = (file: string) => JSON.parse(readFileSync(resolve(file), "utf8"));
  const sources = {
    brief: read(input.briefFile), run: read(input.runFile), evidence: read(input.evidenceFile),
    validation: read(input.validationFile), preview: read(input.previewFile), patchPreview: read(input.patchPreviewFile),
  } as Stage2PublicCostReviewSources;
  const request = buildStage2PublicCostReviewRequest({ ...sources, createdAt: input.createdAt });
  const validation = validateStage2PublicCostReviewRequest(sources, request);
  if (validation.status !== "valid_pending_user_review") throw new Error("STAGE2_PUBLIC_COST_REVIEW_REQUEST_INVALID");
  const files = ["stage2-public-cost-review-request.v1.json", "README-醒来后确认.md", "generation-summary.stage2-public-cost-review.v1.json"];
  const summaryBody = {
    schemaVersion: "stage2-public-cost-review-generation-summary.v1" as const,
    requestId: request.requestId,
    requestHash: request.requestHash,
    status: validation.status,
    boundary: { userDecisionGenerated: false, stage2SubmissionMutated: false, profitCalculated: false, candidateCreated: false, databaseWritten: false },
    files,
  };
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: files[0], content: json(request) },
    { relativePath: files[1], content: `# BOM 暂定值复核\n\n你不需要判断汇率公式，只需确认是否允许把已验证的机械换算结果写入本地 Stage 2 暂定输入。\n\n请逐字回复：\n\n${request.exactConfirmationText}\n` },
    { relativePath: files[2], content: json({ ...summaryBody, evidenceHash: stableHash(summaryBody) }) },
  ], "STAGE2_PUBLIC_COST_REVIEW_OUTPUT_CONFLICT");
  return { request, validation, files, artifactWrite };
}
