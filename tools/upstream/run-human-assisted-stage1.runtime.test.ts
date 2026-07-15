import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { buildBlindReviewMaterial, rankStage1 } from "../../lib/upstream/ranking";
import {
  validateHumanAssistedAmazonRun,
  type HumanAssistedAmazonRunResult,
} from "../collectors/amazon/human-assisted";

const inputFile = process.env.HUMAN_ASSISTED_STAGE1_INPUT_FILE;
const outputDirectory = process.env.HUMAN_ASSISTED_STAGE1_OUTPUT_DIRECTORY;

function writeJson(path: string, content: unknown) {
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

describe("human-assisted Amazon Stage 1 offline runner", () => {
  it.runIf(Boolean(inputFile && outputDirectory))(
    "validates one real source package and generates deterministic offline Stage 1 artifacts",
    () => {
      const sourcePath = resolve(inputFile!);
      const outputPath = resolve(outputDirectory!);
      const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
      const validation = validateHumanAssistedAmazonRun(parsed);
      expect(validation.evidenceStatus).toBe("complete");

      const run = validation.run as HumanAssistedAmazonRunResult;
      expect(run.status).toBe("completed");
      expect(run.environmentGate?.status).toBe("passed");
      expect(run.extractionAttempt.qualityGate?.status).toBe("passed");
      expect(run.extractionAttempt.layoutGate?.status).toBe("passed");
      expect(run.sourceAdapter).not.toBeNull();
      expect(run.sourceAdapter?.qualitySummary.status).toBe("passed");
      expect(run.sourceAdapter?.quarantinedCount).toBe(0);
      expect(run.sourceAdapter?.pipeline).not.toBeNull();

      const pipeline = run.sourceAdapter!.pipeline!;
      const extractedObservationCount = run.extractionAttempt.extractedObservationCount;
      expect(extractedObservationCount).not.toBeNull();
      if (extractedObservationCount === null) throw new Error("EXTRACTED_OBSERVATION_COUNT_REQUIRED");
      expect(run.sourceAdapter!.acceptedCount).toBe(extractedObservationCount);
      expect(pipeline.importPackage.candidates).toHaveLength(extractedObservationCount);

      const first = rankStage1(pipeline.importPackage, run.capturedAt);
      const second = rankStage1(pipeline.importPackage, run.capturedAt);
      expect(second).toEqual(first);

      const blindReviewId = `blind-${run.sourceAdapter!.sourceInputHash.slice(0, 24)}`;
      const blindReview = buildBlindReviewMaterial(pipeline.importPackage, blindReviewId);
      expect(blindReview.items).toHaveLength(first.results.length);

      const decisionCounts = first.results.reduce<Record<string, number>>((counts, result) => {
        counts[result.promotionDecision] = (counts[result.promotionDecision] ?? 0) + 1;
        return counts;
      }, {});
      const summaryBody = {
        schemaVersion: "human-assisted-stage1-offline-run-summary.v1",
        sourceRunSchemaVersion: run.schemaVersion,
        sourceRunCapturedAt: run.capturedAt,
        sourceInputHash: run.sourceAdapter!.sourceInputHash,
        collectionRunId: pipeline.run.collectionRunId,
        importPackageHash: pipeline.importPackage.importPackageHash,
        rankingRunId: first.rankingRunId,
        rankingRuleVersion: first.rankingRuleVersion,
        inputObservationCount: extractedObservationCount,
        importPreviewCandidateCount: pipeline.importPackage.candidates.length,
        resultCount: first.results.length,
        decisionCounts: {
          promoted: decisionCounts.promoted ?? 0,
          rejected: decisionCounts.rejected ?? 0,
          insufficient_evidence: decisionCounts.insufficient_evidence ?? 0,
        },
        deterministicReplayMatched: true,
        blindReviewItemCount: blindReview.items.length,
        humanReviewResultsRecorded: false,
        formalCandidateGenerated: false,
        productionDatabaseWritten: false,
        aiCalled: false,
      } as const;
      const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };

      mkdirSync(outputPath, { recursive: true });
      writeJson(resolve(outputPath, "stage1-ranking.v1.json"), first);
      writeJson(resolve(outputPath, "stage1-blind-review-material.v1.json"), blindReview);
      writeJson(resolve(outputPath, "stage1-offline-run-summary.v1.json"), summary);
    },
  );
});
