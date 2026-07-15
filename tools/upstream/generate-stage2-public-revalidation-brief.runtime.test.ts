import { describe, expect, it } from "vitest";
import { generateStage2PublicRevalidationMaterials } from "./generate-stage2-public-revalidation-brief";

const required = {
  originalBriefFile: process.env.STAGE2_REVALIDATION_ORIGINAL_BRIEF_FILE,
  failedRunFile: process.env.STAGE2_REVALIDATION_FAILED_RUN_FILE,
  failedReviewFile: process.env.STAGE2_REVALIDATION_FAILED_REVIEW_FILE,
  outputDirectory: process.env.STAGE2_REVALIDATION_OUTPUT_DIRECTORY,
  createdAt: process.env.STAGE2_REVALIDATION_CREATED_AT,
};

describe("Stage 2 public revalidation runtime generator", () => {
  it.runIf(Object.values(required).every(Boolean))(
    "generates the pending authorization package without website access",
    () => {
      const result = generateStage2PublicRevalidationMaterials(
        required as Record<keyof typeof required, string>,
      );
      expect(result.validation.status).toBe("valid_pending_authorization");
      expect(result.summary).toMatchObject({
        realWebsiteAccessed: false,
        authorizationGranted: false,
        candidateGenerated: false,
        databaseWritten: false,
      });
    },
  );
});
