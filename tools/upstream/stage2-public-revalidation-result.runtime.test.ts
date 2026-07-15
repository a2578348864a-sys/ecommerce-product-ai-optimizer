import { describe, expect, it } from "vitest";
import { generateStage2PublicRevalidationResult } from "./stage2-public-revalidation-result";

const required = {
  briefFile: process.env.STAGE2_REVALIDATION_RESULT_BRIEF_FILE,
  authorizationFile: process.env.STAGE2_REVALIDATION_RESULT_AUTHORIZATION_FILE,
  runFile: process.env.STAGE2_REVALIDATION_RESULT_RUN_FILE,
  reviewFile: process.env.STAGE2_REVALIDATION_RESULT_REVIEW_FILE,
  outputDirectory: process.env.STAGE2_REVALIDATION_RESULT_OUTPUT_DIRECTORY,
};

describe("Stage 2 public revalidation result runtime", () => {
  it.runIf(Object.values(required).every(Boolean))(
    "writes the authorization-to-run-to-review result without website access",
    () => {
      const { result } = generateStage2PublicRevalidationResult(
        required as Record<keyof typeof required, string>,
      );
      expect(result).toMatchObject({
        status: "failed_closed",
        proofLevel: "authoritative_failure_evidence",
        stage2EvidenceReady: false,
        stage2SubmissionGenerated: false,
        candidateGenerated: false,
        databaseWritten: false,
      });
    },
  );
});
