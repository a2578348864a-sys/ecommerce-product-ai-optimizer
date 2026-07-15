import { describe, expect, it } from "vitest";
import { generateStage2PublicCostResearchAuthorization } from "./generate-stage2-public-cost-research-authorization";

const required = {
  briefFile: process.env.STAGE2_PUBLIC_COST_AUTH_BRIEF_FILE,
  createdAt: process.env.STAGE2_PUBLIC_COST_AUTH_CREATED_AT,
  outputDirectory: process.env.STAGE2_PUBLIC_COST_AUTH_OUTPUT_DIRECTORY,
};

describe("Stage 2 public cost authorization runtime generator", () => {
  it.runIf(Object.values(required).every(Boolean))("generates a not-granted request package", () => {
    const result = generateStage2PublicCostResearchAuthorization(
      required as Record<keyof typeof required, string>,
    );
    expect(result.status).toBe("valid_not_granted");
  });
});
