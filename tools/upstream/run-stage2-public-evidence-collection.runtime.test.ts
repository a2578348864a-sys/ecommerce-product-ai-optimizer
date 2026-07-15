import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { writeArtifactsIdempotently } from "./artifact-writer";
import { buildStage2PublicRunEvidence } from "./stage2-public-evidence-collector";
import {
  reviewStage2PublicRunEvidence,
  runStage2PublicEvidenceCollection,
} from "./run-stage2-public-evidence-collection";

const required = {
  briefFile: process.env.STAGE2_PUBLIC_BRIEF_FILE,
  outputDirectory: process.env.STAGE2_PUBLIC_OUTPUT_DIRECTORY,
  capturedAt: process.env.STAGE2_PUBLIC_CAPTURED_AT,
};

describe("Stage 2 public evidence runtime", () => {
  it.runIf(Object.values(required).every(Boolean))(
    "runs the single authorized, budgeted public supplier evidence attempt",
    async () => {
      const result = await runStage2PublicEvidenceCollection(required as Record<keyof typeof required, string>);
      expect(result.run.navigationBudget.used).toBeLessThanOrEqual(4);
      expect(result.run.cleanup).toMatchObject({
        pageClosed: true,
        browserClosed: true,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineRestored: true,
      });
      expect(result.summary).toMatchObject({
        stage2SubmissionGenerated: false,
        candidateGenerated: false,
        databaseWritten: false,
      });
    },
    120_000,
  );

  it.runIf(Boolean(process.env.STAGE2_PUBLIC_REVIEW_SOURCE_FILE))(
    "writes an offline review without rerunning the public website",
    () => {
      const sourceFile = process.env.STAGE2_PUBLIC_REVIEW_SOURCE_FILE!;
      const run = JSON.parse(readFileSync(sourceFile, "utf8")) as ReturnType<typeof buildStage2PublicRunEvidence>;
      const review = reviewStage2PublicRunEvidence(run);
      writeArtifactsIdempotently(dirname(sourceFile), [{
        relativePath: "stage2-public-evidence-run-review.v1.json",
        content: `${JSON.stringify(review, null, 2)}\n`,
      }], "STAGE2_PUBLIC_REVIEW_OUTPUT_CONFLICT");
      expect(["non_authoritative_failed_evidence", "authoritative_failed_or_completed_evidence"])
        .toContain(review.status);
      expect(review).toMatchObject({ realWebsiteRerunPerformed: false, stage2SubmissionEligible: false });
    },
  );
});
