import { describe, expect, it } from "vitest";
import { generateStage2PublicCostResearchBrief } from "./generate-stage2-public-cost-research-brief";

const required = {
  inventoryFile: process.env.STAGE2_PUBLIC_COST_INVENTORY_FILE,
  submissionFile: process.env.STAGE2_PUBLIC_COST_SUBMISSION_FILE,
  validationFile: process.env.STAGE2_PUBLIC_COST_VALIDATION_FILE,
  sampleId: process.env.STAGE2_PUBLIC_COST_SAMPLE_ID,
  createdAt: process.env.STAGE2_PUBLIC_COST_CREATED_AT,
  outputDirectory: process.env.STAGE2_PUBLIC_COST_OUTPUT_DIRECTORY,
};

describe("Stage 2 public cost research brief runtime generator", () => {
  it.runIf(Object.values(required).every(Boolean))(
    "generates the current pending authorization package",
    () => {
      const result = generateStage2PublicCostResearchBrief(required as Record<keyof typeof required, string>);
      expect(result).toMatchObject({ status: "valid_pending_authorization", sampleId: "stage2-high-01" });
    },
  );
});
