import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import type { Stage2PublicCostResearchBrief } from "./stage2-public-cost-research-brief";
import {
  buildStage2PublicCostResearchAuthorizationRequest,
  validateStage2PublicCostResearchAuthorizationRequest,
} from "./stage2-public-cost-research-authorization";

type GeneratorInput = { briefFile: string; createdAt: string; outputDirectory: string };

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function generateStage2PublicCostResearchAuthorization(input: GeneratorInput) {
  const brief = JSON.parse(readFileSync(resolve(input.briefFile), "utf8")) as Stage2PublicCostResearchBrief;
  const request = buildStage2PublicCostResearchAuthorizationRequest(brief, input.createdAt);
  const validation = validateStage2PublicCostResearchAuthorizationRequest(brief, request);
  if (validation.status !== "valid_not_granted") throw new Error("STAGE2_PUBLIC_COST_AUTHORIZATION_REQUEST_INVALID");
  const files = [
    "stage2-public-cost-research-authorization-request.v1.json",
    "README-授权语句.md",
    "generation-summary.stage2-public-cost-authorization.v1.json",
  ];
  const guide = `# Stage2-Public-Cost-Research-01 一次性授权\n\n当前状态：未授权，不会访问任何网站。\n\n请逐字回复：\n\n${request.exactAuthorizationText}\n`;
  const summaryBody = {
    schemaVersion: "stage2-public-cost-research-authorization-generation-summary.v1" as const,
    requestId: request.requestId,
    requestHash: request.requestHash,
    briefId: request.briefId,
    briefHash: request.briefHash,
    status: validation.status,
    boundary: {
      authorizationGranted: false,
      authorizationGrantGenerated: false,
      externalWebsiteAccessed: false,
      evidenceCollected: false,
      databaseWritten: false,
      externalAiApiCalled: false,
    },
    files,
  };
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: files[0], content: json(request) },
    { relativePath: files[1], content: guide },
    { relativePath: files[2], content: json({ ...summaryBody, evidenceHash: stableHash(summaryBody) }) },
  ], "STAGE2_PUBLIC_COST_AUTHORIZATION_OUTPUT_CONFLICT");
  return { files, artifactWrite, status: validation.status, requestId: request.requestId };
}
