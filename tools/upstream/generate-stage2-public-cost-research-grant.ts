import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import type { Stage2PublicCostResearchBrief } from "./stage2-public-cost-research-brief";
import {
  buildStage2PublicCostResearchAuthorizationGrant,
  consumeStage2PublicCostResearchAuthorizationGrant,
  validateStage2PublicCostResearchAuthorizationConsumption,
  type Stage2PublicCostResearchAuthorizationRequest,
} from "./stage2-public-cost-research-authorization";

type Input = {
  briefFile: string;
  requestFile: string;
  authorizationText: string;
  authorizedAt: string;
  consumedAt: string;
  outputDirectory: string;
};

export function generateStage2PublicCostResearchGrant(input: Input) {
  const brief = JSON.parse(readFileSync(resolve(input.briefFile), "utf8")) as Stage2PublicCostResearchBrief;
  const request = JSON.parse(readFileSync(resolve(input.requestFile), "utf8")) as Stage2PublicCostResearchAuthorizationRequest;
  const grant = buildStage2PublicCostResearchAuthorizationGrant({
    brief, request, authorizationText: input.authorizationText, authorizedAt: input.authorizedAt, authorizedBy: "user",
  });
  const runId = `stage2-public-cost-run-${stableHash({ grantHash: grant.grantHash, consumedAt: input.consumedAt }).slice(0, 24)}`;
  const consumption = consumeStage2PublicCostResearchAuthorizationGrant({
    brief, request, grant, runId, consumedAt: input.consumedAt,
  });
  if (validateStage2PublicCostResearchAuthorizationConsumption(brief, request, grant, consumption).status !== "valid_consumed") {
    throw new Error("STAGE2_PUBLIC_COST_AUTHORIZATION_CONSUMPTION_INVALID");
  }
  const files = [
    "stage2-public-cost-research-authorization-grant.v1.json",
    "stage2-public-cost-research-authorization-consumption.v1.json",
  ];
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: files[0], content: json(grant) },
    { relativePath: files[1], content: json(consumption) },
  ], "STAGE2_PUBLIC_COST_GRANT_OUTPUT_CONFLICT");
  return { files, artifactWrite, runId, grantHash: grant.grantHash, consumptionHash: consumption.consumptionHash };
}
