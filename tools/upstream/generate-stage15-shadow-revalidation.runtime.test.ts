import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stableHash } from "../../lib/upstream/pipeline";
import { buildStage15ShadowObservation } from "./stage15-shadow-calibration";
import type { Stage15ShadowBatch } from "./stage15-shadow-batch";
import { generateStage15ShadowPreparation } from "./generate-stage15-shadow-revalidation";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function source() {
  const missing = { value: null, status: "missing" as const, evidenceRefs: [], capturedAt: null, exactVariant: null, missingReason: "not_collected" };
  const observations = Array.from({ length: 20 }, (_, index) => buildStage15ShadowObservation({ schemaVersion: "stage15-shadow-observation-input.v1", batchId: "batch-c", productKey: `amazon:US:C0${String(index).padStart(8, "0")}`, evidenceSnapshotId: `e-${index}`, marketValidation: { monthlyBought: missing, categoryRank: missing, rating: missing, reviewCount: missing }, listingMaturity: { firstAvailableAt: missing, ageDays: missing }, buyerReviews: { positive: missing, negative: missing, sampleCount: missing }, decisionImpact: false }));
  const body = { schemaVersion: "stage15-shadow-batch.v1" as const, batchId: "batch-c", role: "calibration" as const, readiness: "ready_partial" as const, productKeys: observations.map((item) => item.productKey).sort(), observations, baseline: observations.map((item, index) => ({ productKey: item.productKey, rank: index + 1, status: index < 5 ? "advance" : "watch" })), missingReasons: ["optional_detail_evidence_not_attached"], createdAt: "2026-07-17T06:00:00.000Z" };
  const batch: Stage15ShadowBatch = { ...body, batchHash: stableHash(body) };
  const presentationByProductKey = Object.fromEntries(batch.productKeys.map((key, index) => [key, { titleZh: `桌面用品 ${index + 1}`, purposeZh: "帮助整理桌面", image: { status: "not_cached" as const, dataUrl: null, missingReason: "not_cached" }, price: null, dimensions: null, material: null }]));
  return { batch, presentationByProductKey };
}

describe("generate stage15 shadow preparation", () => {
  it("writes once, returns unchanged on replay, and emits only the approved artifact set", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage15-shadow-generator-"));
    roots.push(outputDirectory);
    const input = { ...source(), outputDirectory, createdAt: "2026-07-17T07:00:00.000Z" };
    const first = generateStage15ShadowPreparation(input);
    const second = generateStage15ShadowPreparation(input);
    expect(first.artifactWrite.written).toHaveLength(7);
    expect(second.artifactWrite.unchanged).toHaveLength(7);
    expect(first.files.sort()).toEqual([
      "README-影子校准盲化评价说明.md",
      "generation-summary.stage15-shadow-revalidation.v1.json",
      "stage15-shadow-batch.v1.json",
      "stage15-shadow-blind-evaluation-bindings.private.v1.json",
      "stage15-shadow-blind-evaluation-packet.v1.json",
      "stage15-shadow-blind-evaluation-result-template.v1.json",
      "stage15-shadow-observations.v1.json",
    ].sort());
    for (const file of first.files.filter((value) => value.endsWith(".json"))) {
      expect(() => JSON.parse(readFileSync(join(outputDirectory, file), "utf8"))).not.toThrow();
    }
    expect(first.summary).toMatchObject({ databaseWritten: false, externalWebsiteAccessedDuringGeneration: false, aiOrPaidApiCalled: false, productionEffect: false });
  });

  it("refuses to overwrite a same-name different artifact", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage15-shadow-generator-conflict-"));
    roots.push(outputDirectory);
    const input = { ...source(), outputDirectory, createdAt: "2026-07-17T07:00:00.000Z" };
    generateStage15ShadowPreparation(input);
    writeFileSync(join(outputDirectory, "stage15-shadow-batch.v1.json"), "{}\n", "utf8");
    expect(() => generateStage15ShadowPreparation(input)).toThrow("STAGE15_SHADOW_OUTPUT_CONFLICT");
  });
});
