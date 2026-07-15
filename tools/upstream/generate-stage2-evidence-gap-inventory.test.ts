import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RankingRun, Stage1Result } from "../../lib/upstream/contracts";
import {
  buildSoloStage2CalibrationPacket,
  type BlindReviewMaterialInput,
} from "./solo-validation-materials";
import { generateStage2EvidenceGapInventory } from "./generate-stage2-evidence-gap-inventory";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

function sha256(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "stage2-evidence-gaps-"));
  temporaryDirectories.push(root);
  const result: Stage1Result = {
    schemaVersion: "stage1-result.v1",
    rankingRunId: "ranking-test",
    rankingRuleVersion: "stage1-deterministic-v1.1",
    productKey: "amazon:US:TESTASIN01",
    candidateId: "candidate-test",
    variantGroupKey: "amazon:US:TESTASIN01",
    inputEvidenceHash: "evidence-hash",
    rank: 1,
    totalScore: 80,
    componentScores: { priceFit: 25 },
    hardGateResult: { schemaVersion: "hard-gate-result.v1", passed: true, errorCodes: [] },
    supportingEvidence: ["页面证据"],
    counterEvidence: [],
    missingEvidence: [],
    confidence: "high",
    promotionDecision: "promoted",
    recommendationTier: "high",
    nextValidationPlan: ["补商业证据"],
    killCriteria: ["关键证据无法验证"],
    createdAt: "2026-07-14T00:00:00.000Z",
  };
  const ranking: RankingRun = {
    schemaVersion: "ranking-run.v1",
    rankingRunId: "ranking-test",
    rankingRuleVersion: "stage1-deterministic-v1.1",
    briefId: "brief-test",
    collectionRunId: "run-test",
    inputHash: "ranking-input-hash",
    createdAt: "2026-07-14T00:00:00.000Z",
    results: [result],
  };
  const blindReview: BlindReviewMaterialInput = {
    schemaVersion: "blind-review-material.v1",
    blindReviewId: "blind-test",
    criteria: ["是否值得继续调查"],
    items: [{
      blindItemId: "blind-test-01",
      candidateId: result.candidateId,
      evidenceSnapshotId: "evidence-test",
      title: "Test organizer",
      sourceUrl: "https://www.amazon.com/dp/TESTASIN01",
      capturedAt: "2026-07-14T00:00:00.000Z",
      evidence: { price: 20, rating: 4.5, reviewCount: 100, missingEvidence: [] },
    }],
  };
  const packet = buildSoloStage2CalibrationPacket(ranking, blindReview);
  const sourceFile = join(root, "stage2-objective-calibration-packet.v1.json");
  const outputDirectory = join(root, "05-Stage2证据缺口清单");
  writeFileSync(sourceFile, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return { root, sourceFile, outputDirectory };
}

describe("Stage 2 evidence gap inventory generator", () => {
  it("writes a separate inventory, guide and summary without modifying the source packet", () => {
    const input = fixture();
    const before = sha256(readFileSync(input.sourceFile));

    const result = generateStage2EvidenceGapInventory({
      stage2PacketFile: input.sourceFile,
      outputDirectory: input.outputDirectory,
    });

    expect(result.files).toEqual([
      "stage2-evidence-gap-inventory.v1.json",
      "README-Stage2证据缺口怎么填.md",
      "generation-summary.stage2-gaps.v1.json",
    ]);
    expect(result.summary).toEqual({
      sampleCount: 1,
      samplesBlockedForProfit: 1,
      missingEvidenceFieldCount: 17,
      pendingHumanDecisionFieldCount: 2,
      readyForProfitCalculationCount: 0,
    });
    expect(sha256(readFileSync(input.sourceFile))).toBe(before);
    const inventory = JSON.parse(readFileSync(join(input.outputDirectory, result.files[0]), "utf8"));
    expect(inventory.status).toBe("evidence_collection_required");
  });

  it("fails closed for an invalid or unverified source packet", () => {
    const input = fixture();
    writeFileSync(input.sourceFile, JSON.stringify({ schemaVersion: "unknown" }), "utf8");

    expect(() => generateStage2EvidenceGapInventory({
      stage2PacketFile: input.sourceFile,
      outputDirectory: input.outputDirectory,
    })).toThrow("STAGE2_GAP_SOURCE_PACKET_INVALID");
  });
});
