import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage15ShadowPublicUpstream } from "./generate-stage15-shadow-public-upstream";
import { generateStage15ShadowEvaluationBridge } from "./generate-stage15-shadow-evaluation-bridge";
import { generateStage15ShadowCombinedHumanFinalization } from "./generate-stage15-shadow-combined-human-finalization";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { force: true, recursive: true })));

function entry(index: number) {
  const asin = `B0${String(index).padStart(8, "0")}`;
  return `${index}. #${index} [![Image ${index}: Organizer ${index}](https://images.example.test/${index}.jpg)](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[Organizer ${index}](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[_4.7 out of 5 stars_ ${1_000 + index}](https://www.amazon.com/product-reviews/${asin}) [$${10 + index}.99](https://www.amazon.com/item-${index}/dp/${asin})\n`;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "stage15-finalize-"));
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
  generateStage15ShadowEvaluationBridge({
    batchDirectory: root,
    role: "calibration",
    createdAt: "2026-07-17T05:30:00.000Z",
  });
  const completedFile = join(root, "completed-human-evaluation.json");
  writeFileSync(completedFile, `${JSON.stringify({
    schemaVersion: "stage15-shadow-combined-human-evaluation-result.v1",
    batchId: generated.manifest.batchId,
    sourcePacketHash: generated.packet.packetHash,
    status: "completed",
    completedAt: "2026-07-17T06:00:00.000Z",
    answers: generated.packet.items.map((item, index) => ({
      evaluationItemId: item.evaluationItemId,
      productUnderstood: "yes",
      investigateNext10Minutes: index < 10 ? "yes" : "no",
      screeningEvidenceSufficient: "yes",
      worthFurtherInvestigation: index < 10 ? "yes" : "no",
      evidenceSufficient: "yes",
      dominantSignals: ["market_validation"],
      confidence: "medium",
      reason: `人工原话 ${index + 1}`,
    })),
  }, null, 2)}\n`, "utf8");
  return { root, completedFile, outputDirectory: join(root, "finalized") };
}

describe("Stage 1.5 combined human finalization generator", () => {
  it("writes a deterministic, idempotent Stage 1.5 result set from an explicit completed file", () => {
    const value = fixture();
    const input = {
      packetFile: join(value.root, "stage15-shadow-combined-human-evaluation-packet.v1.json"),
      bindingsFile: join(value.root, "stage15-shadow-combined-human-evaluation-bindings.private.v1.json"),
      bridgeFile: join(value.root, "stage15-shadow-evaluation-bridge.private.v1.json"),
      rankingFile: join(value.root, "ranking-run.v1.json"),
      completedResultFile: value.completedFile,
      outputDirectory: value.outputDirectory,
      createdAt: "2026-07-17T06:01:00.000Z",
    };
    const first = generateStage15ShadowCombinedHumanFinalization(input);
    const second = generateStage15ShadowCombinedHumanFinalization(input);
    expect(first.artifactWrite.written).toHaveLength(5);
    expect(second.artifactWrite.unchanged).toEqual(first.files);
    const screening = JSON.parse(readFileSync(join(value.outputDirectory, "novice-market-screening-run.v1.json"), "utf8"));
    const summary = JSON.parse(readFileSync(join(value.outputDirectory, "generation-summary.stage15-shadow-combined-finalization.v1.json"), "utf8"));
    expect(screening.summary).toEqual({ advance: 5, watch: 15, reject: 0, insufficient: 0 });
    expect(summary.status).toBe("stage15_ready_shadow_packet_pending");
    expect(summary.boundary).toMatchObject({ databaseWritten: false, candidateGenerated: false, productionEffect: false });
  });

  it("fails before writing when the completed result is incomplete or tampered", () => {
    const value = fixture();
    const completed = JSON.parse(readFileSync(value.completedFile, "utf8"));
    completed.answers.pop();
    writeFileSync(value.completedFile, `${JSON.stringify(completed)}\n`, "utf8");
    expect(() => generateStage15ShadowCombinedHumanFinalization({
      packetFile: join(value.root, "stage15-shadow-combined-human-evaluation-packet.v1.json"),
      bindingsFile: join(value.root, "stage15-shadow-combined-human-evaluation-bindings.private.v1.json"),
      bridgeFile: join(value.root, "stage15-shadow-evaluation-bridge.private.v1.json"),
      rankingFile: join(value.root, "ranking-run.v1.json"),
      completedResultFile: value.completedFile,
      outputDirectory: value.outputDirectory,
      createdAt: "2026-07-17T06:01:00.000Z",
    })).toThrow();
    expect(() => readFileSync(join(value.outputDirectory, "novice-market-screening-run.v1.json"), "utf8")).toThrow();
  });
});
