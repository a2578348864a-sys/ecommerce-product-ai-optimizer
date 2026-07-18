import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { generateStage15ShadowPublicUpstream } from "./generate-stage15-shadow-public-upstream";
import { validateStage15ShadowCombinedHumanEvaluationResult } from "./stage15-shadow-combined-human-evaluation";
import {
  buildStage15ShadowEvaluationBridge,
  finalizeStage15ShadowCombinedHumanEvaluation,
} from "./stage15-shadow-evaluation-bridge";
import { generateStage15ShadowEvaluationBridge } from "./generate-stage15-shadow-evaluation-bridge";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { force: true, recursive: true })));

function entry(index: number) {
  const asin = `B0${String(index).padStart(8, "0")}`;
  return `${index}. #${index} [![Image ${index}: Organizer ${index}](https://images.example.test/${index}.jpg)](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[Organizer ${index}](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[_4.7 out of 5 stars_ ${1_000 + index}](https://www.amazon.com/product-reviews/${asin}) [$${10 + index}.99](https://www.amazon.com/item-${index}/dp/${asin})\n`;
}

function upstream() {
  const root = mkdtempSync(join(tmpdir(), "stage15-bridge-"));
  roots.push(root);
  const sourceMarkdown = Array.from({ length: 20 }, (_, index) => entry(index + 1)).join("\n");
  const generated = generateStage15ShadowPublicUpstream({
    role: "calibration",
    batchId: "stage15-shadow-calibration-c-20260717-01",
    manifestId: "manifest-c",
    briefId: "brief-c",
    collectionRunId: "run-c",
    query: "desk organizers",
    category: "Desk Organizers",
    targetScenario: "desk organization",
    targetPriceRange: { min: 8, max: 45 },
    sourceUrl: "https://www.amazon.com/Best-Sellers/zgbs/office-products/1069514",
    sourceMarkdown,
    sourceFileSha256: createHash("sha256").update(sourceMarkdown, "utf8").digest("hex"),
    page: 1,
    capturedAt: "2026-07-17T05:00:00.000Z",
    accessBudget: {
      maxAggregatePageRequests: 1,
      maxDetailPageRequests: 0,
      maxAutomaticRetries: 0,
      maxImageDownloads: 0,
      actualAggregatePageRequests: 1,
      requestedUrls: ["https://www.amazon.com/Best-Sellers/zgbs/office-products/1069514"],
    },
    forbiddenPlatformProductIds: [],
    outputDirectory: root,
  });
  return { ...generated, outputDirectory: root };
}

function completed(source: ReturnType<typeof upstream>) {
  return validateStage15ShadowCombinedHumanEvaluationResult({
    schemaVersion: "stage15-shadow-combined-human-evaluation-result.v1",
    batchId: source.manifest.batchId,
    sourcePacketHash: source.packet.packetHash,
    status: "completed",
    completedAt: "2026-07-17T06:00:00.000Z",
    answers: source.packet.items.map((item) => ({
      evaluationItemId: item.evaluationItemId,
      productUnderstood: "yes",
      investigateNext10Minutes: "yes",
      screeningEvidenceSufficient: "yes",
      worthFurtherInvestigation: "yes",
      evidenceSufficient: "yes",
      dominantSignals: ["market_validation"],
      confidence: "medium",
      reason: `继续调查 ${item.evaluationItemId}`,
    })),
  }, source.packet, source.privateBindings);
}

describe("Stage 1.5 shadow evaluation bridge", () => {
  it("freezes a private bridge from the real public pipeline without fabricating quality gates", () => {
    const source = upstream();
    const bridge = buildStage15ShadowEvaluationBridge({
      source: source.source,
      combinedPacket: source.packet,
      combinedBindings: source.privateBindings,
      sourceUpstreamManifestHash: source.manifest.manifestHash,
      createdAt: "2026-07-17T05:30:00.000Z",
    });
    expect(bridge.blindReview.items).toHaveLength(20);
    expect(bridge.blindReview.items[0].blindItemId).toMatch(/^C-\d{2}$/u);
    expect(bridge.novicePacket.packetHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(bridge.marketEvidence.qualityGates).toMatchObject({
      source: { status: "passed" },
      context: { status: "passed" },
      layout: { status: "passed" },
    });
    expect(bridge.marketEvidence.candidates).toHaveLength(20);
    expect(bridge.bridgeHash).toBe(stableHash({
      schemaVersion: bridge.schemaVersion,
      batchId: bridge.batchId,
      sourceUpstreamManifestHash: bridge.sourceUpstreamManifestHash,
      sourceCombinedPacketHash: bridge.sourceCombinedPacketHash,
      rankingInputHash: bridge.rankingInputHash,
      rankingRunHash: bridge.rankingRunHash,
      blindReview: bridge.blindReview,
      novicePacket: bridge.novicePacket,
      marketEvidence: bridge.marketEvidence,
      boundary: bridge.boundary,
      createdAt: bridge.createdAt,
    }));
  });

  it("turns completed human answers into a deterministic current Stage 1.5 run", () => {
    const source = upstream();
    const bridge = buildStage15ShadowEvaluationBridge({
      source: source.source,
      combinedPacket: source.packet,
      combinedBindings: source.privateBindings,
      sourceUpstreamManifestHash: source.manifest.manifestHash,
      createdAt: "2026-07-17T05:30:00.000Z",
    });
    const first = finalizeStage15ShadowCombinedHumanEvaluation({
      bridge,
      rankingRun: source.source.rankingRun,
      combinedResult: completed(source),
      createdAt: "2026-07-17T06:01:00.000Z",
    });
    const second = finalizeStage15ShadowCombinedHumanEvaluation({
      bridge,
      rankingRun: source.source.rankingRun,
      combinedResult: completed(source),
      createdAt: "2026-07-17T06:01:00.000Z",
    });
    expect(first.screeningRun.summary).toEqual({ advance: 5, watch: 15, reject: 0, insufficient: 0 });
    expect(first.screeningRun.screeningHash).toBe(second.screeningRun.screeningHash);
    expect(first.acceptance.engineering.status).toBe("passed");
    expect(first.acceptance.effectiveness.conclusion).toBe("screening_effectiveness_not_validated");
    expect(first.boundary).toMatchObject({ databaseWritten: false, candidateGenerated: false, productionEffect: false });
  });

  it("rejects source, packet, binding, ranking, or bridge drift", () => {
    const source = upstream();
    expect(() => buildStage15ShadowEvaluationBridge({
      source: { ...source.source, batchId: "tampered" },
      combinedPacket: source.packet,
      combinedBindings: source.privateBindings,
      sourceUpstreamManifestHash: source.manifest.manifestHash,
      createdAt: "2026-07-17T05:30:00.000Z",
    })).toThrow();
    const bridge = buildStage15ShadowEvaluationBridge({
      source: source.source,
      combinedPacket: source.packet,
      combinedBindings: source.privateBindings,
      sourceUpstreamManifestHash: source.manifest.manifestHash,
      createdAt: "2026-07-17T05:30:00.000Z",
    });
    expect(() => finalizeStage15ShadowCombinedHumanEvaluation({
      bridge: { ...bridge, bridgeHash: "tampered" },
      rankingRun: source.source.rankingRun,
      combinedResult: completed(source),
      createdAt: "2026-07-17T06:01:00.000Z",
    })).toThrow("SHADOW_EVALUATION_BRIDGE_INVALID");
    expect(() => finalizeStage15ShadowCombinedHumanEvaluation({
      bridge,
      rankingRun: { ...source.source.rankingRun, inputHash: "tampered" },
      combinedResult: completed(source),
      createdAt: "2026-07-17T06:01:00.000Z",
    })).toThrow("SHADOW_EVALUATION_RANKING_DRIFT");
  });

  it("writes a private bridge supplement idempotently without changing the frozen upstream manifest", () => {
    const source = upstream();
    const manifestPath = join(source.outputDirectory, "stage15-shadow-upstream-manifest.v1.json");
    const before = readFileSync(manifestPath, "utf8");
    const first = generateStage15ShadowEvaluationBridge({
      batchDirectory: source.outputDirectory,
      role: "calibration",
      createdAt: "2026-07-17T05:30:00.000Z",
    });
    const second = generateStage15ShadowEvaluationBridge({
      batchDirectory: source.outputDirectory,
      role: "calibration",
      createdAt: "2026-07-17T05:30:00.000Z",
    });
    expect(first.artifactWrite.written).toHaveLength(3);
    expect(second.artifactWrite.unchanged).toEqual(first.files);
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
    const supplement = JSON.parse(readFileSync(join(source.outputDirectory, "evaluation-bridge-supplement.v1.json"), "utf8"));
    expect(supplement.status).toBe("ready_for_completed_human_result");
    expect(supplement.boundary).toMatchObject({ frozenUpstreamManifestModified: false, databaseWritten: false });
  });
});
