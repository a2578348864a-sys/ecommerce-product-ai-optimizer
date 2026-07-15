import { describe, expect, it } from "vitest";
import { generateStage2PublicCostResearchGrant } from "./generate-stage2-public-cost-research-grant";

const input = {
  briefFile: process.env.STAGE2_PUBLIC_COST_GRANT_BRIEF_FILE,
  requestFile: process.env.STAGE2_PUBLIC_COST_GRANT_REQUEST_FILE,
  authorizationText: process.env.STAGE2_PUBLIC_COST_GRANT_TEXT,
  authorizedAt: process.env.STAGE2_PUBLIC_COST_GRANT_AUTHORIZED_AT,
  consumedAt: process.env.STAGE2_PUBLIC_COST_GRANT_CONSUMED_AT,
  outputDirectory: process.env.STAGE2_PUBLIC_COST_GRANT_OUTPUT_DIRECTORY,
};

describe("Stage 2 public cost grant runtime generator", () => {
  it.runIf(Object.values(input).every(Boolean))("generates and consumes the single-use grant", () => {
    const result = generateStage2PublicCostResearchGrant(input as Record<keyof typeof input, string>);
    expect(result.runId).toMatch(/^stage2-public-cost-run-/);
  });
});
