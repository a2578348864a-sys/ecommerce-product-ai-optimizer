import { describe, expect, it } from "vitest";
import {
  readCandidateAnalysisImageSnapshot,
  writeCandidateAnalysisImageSnapshot,
} from "@/lib/server/candidateProductImageAsset";
import { readCandidateProductImageSnapshotDual } from "@/lib/productResearchImage";
import { buildSellerSpriteProductImageSnapshot } from "@/lib/server/sellerSpriteProductImage";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TINY_PNG_SHA256 = "c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77";
const ALT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADklEQVR42mP8z8AARAAEBQGBNvxCKQAAAABJRU5ErkJggg==",
  "base64",
);
const ALT_PNG_SHA256 = "1407c21d69b0a853e9498c3491dcca45d1b979c6b5432e6479bf8a26d2d3bcab";

function makeSnapshot(contentHash = TINY_PNG_SHA256) {
  const bytes = contentHash === TINY_PNG_SHA256 ? TINY_PNG : ALT_PNG;
  return buildSellerSpriteProductImageSnapshot({
    fetched: {
      bytes,
      mimeType: "image/png",
      sha256: contentHash,
    },
    asin: "B0TEST0001",
    capturedAt: "2026-08-06T00:00:00.000Z",
  });
}

describe("candidateProductImageAsset (P1-1 analysisJson 资产)", () => {
  it("写入 analysisJson 保留既有字段（r22MarketDecision 等）", () => {
    const existing = JSON.stringify({
      version: "candidate-analysis-v2",
      r22MarketDecision: { ruleVersion: "r22-v1" },
    });
    const result = writeCandidateAnalysisImageSnapshot(existing, makeSnapshot());
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(result.analysisJson);
    expect(parsed.version).toBe("candidate-analysis-v2");
    expect(parsed.r22MarketDecision.ruleVersion).toBe("r22-v1");
    expect(parsed.productImageSnapshot).toBeDefined();
    expect(parsed.productImageSnapshot.contentHash).toBe(TINY_PNG_SHA256);
  });

  it("同 contentHash 重复写入 → unchanged 不覆盖", () => {
    const first = writeCandidateAnalysisImageSnapshot("{}", makeSnapshot());
    const second = writeCandidateAnalysisImageSnapshot(first.analysisJson, makeSnapshot());
    expect(second.changed).toBe(false);
    expect(second.analysisJson).toBe(first.analysisJson);
  });

  it("冲突 contentHash → 抛错不静默覆盖", () => {
    const first = writeCandidateAnalysisImageSnapshot("{}", makeSnapshot(TINY_PNG_SHA256));
    expect(() => writeCandidateAnalysisImageSnapshot(first.analysisJson, makeSnapshot(ALT_PNG_SHA256)))
      .toThrow("candidate_image_asset_conflict");
  });

  it("空 analysisJson 也可写入（新候选）", () => {
    const result = writeCandidateAnalysisImageSnapshot("", makeSnapshot());
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(result.analysisJson);
    expect(parsed.productImageSnapshot).toBeDefined();
  });

  it("损坏 analysisJson 拒绝写入（不破坏既有数据）", () => {
    expect(() => writeCandidateAnalysisImageSnapshot("not-json", makeSnapshot()))
      .toThrow();
  });

  it("readCandidateAnalysisImageSnapshot 回读成功", () => {
    const result = writeCandidateAnalysisImageSnapshot("{}", makeSnapshot());
    const read = readCandidateAnalysisImageSnapshot(result.analysisJson);
    expect(read).not.toBeNull();
    expect(read?.contentHash).toBe(TINY_PNG_SHA256);
    expect(read?.productKey).toBe("amazon:US:B0TEST0001");
  });

  it("双层读取：sourceMetaJson 优先（权威路径不变）", () => {
    // market-screening 候选的 sourceMetaJson 含 marketScreeningIdentity 与
    // productImageSnapshot（parseCandidateImage 权威路径）
    const fromSourceMeta = makeSnapshot(TINY_PNG_SHA256);
    const sourceMetaJson = JSON.stringify({
      schema: "candidate-source-meta-v2",
      marketScreeningIdentity: {
        schemaVersion: "market-screening-candidate-identity.v1",
        productKey: fromSourceMeta.productKey,
        identityHash: fromSourceMeta.candidateIdentityHash,
      },
      productImageSnapshot: fromSourceMeta,
    });
    const analysisJson = JSON.stringify({ productImageSnapshot: makeSnapshot(ALT_PNG_SHA256) });
    const read = readCandidateProductImageSnapshotDual(sourceMetaJson, analysisJson);
    expect(read).not.toBeNull();
    expect(read?.contentHash).toBe(TINY_PNG_SHA256);
  });

  it("双层读取：sourceMetaJson 无图时回退 analysisJson", () => {
    const read = readCandidateProductImageSnapshotDual("{}", JSON.stringify({
      productImageSnapshot: makeSnapshot(TINY_PNG_SHA256),
    }));
    expect(read).not.toBeNull();
    expect(read?.contentHash).toBe(TINY_PNG_SHA256);
  });

  it("双层读取：两者都无图 → null（不降级伪造）", () => {
    expect(readCandidateProductImageSnapshotDual("{}", "{}")).toBeNull();
    expect(readCandidateProductImageSnapshotDual("{}", "not-json")).toBeNull();
    expect(readCandidateProductImageSnapshotDual("not-json", "not-json")).toBeNull();
  });
});
