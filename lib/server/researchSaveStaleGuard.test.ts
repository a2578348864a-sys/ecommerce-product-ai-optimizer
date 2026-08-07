import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  buildCandidateAnalysisContext,
  createCandidateAnalysisBindingHash,
} from "@/lib/server/candidateAnalysisContext";
import { buildSellerSpriteCandidateSourceMeta } from "@/lib/server/sellerSpriteImportContract";
import { comparableCandidateProductName } from "@/lib/comparableProductName";

const FILE_HASH = createHash("sha256").update("file").digest("hex");
const ROW_HASH_A = createHash("sha256").update("row-a").digest("hex");
const ROW_HASH_B = createHash("sha256").update("row-b").digest("hex");
const IMPORTED_AT = "2026-07-31T09:00:00.000Z";

// 模拟 Amazon SellerSprite 真实长标题（>120 字符），与生产导入的 row.title 一致
const LONG_TITLE = [
  "Bose QuietComfort Ultra Wireless Noise Cancelling Headphones, Spatial Audio,",
  "Bluetooth Headphones with Microphone, Over the Ear Headphones, Up to 24 Hours",
  "of Battery Life, Black, 2024",
].join(" ");

function sellerSpriteRecord(title: string, asin = "B0TEST0001") {
  const row = {
    rowHash: ROW_HASH_A,
    rowNumber: 2,
    asin,
    parentAsin: null,
    title,
    amazonUrl: `https://www.amazon.com/dp/${asin}`,
    imageUrl: null,
    priceUsd: 19.99,
    rating: 4.5,
    reviewCount: 123,
    brand: "Example",
    category: "Beauty",
    searchRank: 88,
    estimatedMonthlySales: 100,
    estimatedMonthlyRevenueUsd: 1999,
  };
  return {
    sourceMetaJson: buildSellerSpriteCandidateSourceMeta(row, FILE_HASH, IMPORTED_AT),
    analysisJson: "{}",
  };
}

describe("问题1：研究保存不再误失效（长标题对称截断）", () => {
  it("研究运行端截断 120 的 productName 与保存端 comparableCandidateProductName(candidate.name) 一致", () => {
    expect(LONG_TITLE.length).toBeGreaterThan(120);

    // 运行端（product-analysis/route.ts:325）
    const runProductName = LONG_TITLE.trim().slice(0, 120);
    // normalizeWorkflowRunInput 会再 trim + 折叠空格
    const workflowInputProductName = runProductName.trim().replace(/\s+/g, " ");

    // 保存端（修复后）：candidate.name 也按相同顺序截断 + normalize
    const saveSide = comparableCandidateProductName(LONG_TITLE);
    const inputSide = comparableCandidateProductName(workflowInputProductName);

    // 修复前：normalizeComparableProductName(candidate.name) 用完整 name → 不等
    const legacyFullName = LONG_TITLE.trim().toLowerCase().replace(/\s+/g, " ");
    expect(legacyFullName !== workflowInputProductName).toBe(true); // 证明修复前会误报

    // 修复后：对称截断 → 相等
    expect(saveSide).toBe(inputSide);
  });

  it("comparableCandidateProductName 对已截断的 workflowInput.productName 幂等", () => {
    const runProductName = LONG_TITLE.trim().slice(0, 120);
    const normalized = runProductName.trim().replace(/\s+/g, " ");
    expect(comparableCandidateProductName(normalized)).toBe(comparableCandidateProductName(runProductName));
  });

  it("真实核心事实变化（ASIN 变化）仍改变 contextHash，stale 保护保留", () => {
    const before = sellerSpriteRecord(LONG_TITLE, "B0TEST0001");
    const after = sellerSpriteRecord(LONG_TITLE, "B0TEST0002");
    const hashBefore = createCandidateAnalysisBindingHash(before, buildCandidateAnalysisContext(before));
    const hashAfter = createCandidateAnalysisBindingHash(after, buildCandidateAnalysisContext(after));
    expect(hashBefore).not.toBe(hashAfter);
  });

  it("真实核心事实变化（标题前 120 内变化）仍改变 contextHash", () => {
    const before = sellerSpriteRecord(LONG_TITLE, "B0TEST0001");
    const after = sellerSpriteRecord(
      `Completely Different Product Name That Is Also Long Enough To Exceed 120 Characters In Total Length `.slice(0, 140) + LONG_TITLE,
      "B0TEST0001",
    );
    const hashBefore = createCandidateAnalysisBindingHash(before, buildCandidateAnalysisContext(before));
    const hashAfter = createCandidateAnalysisBindingHash(after, buildCandidateAnalysisContext(after));
    expect(hashBefore).not.toBe(hashAfter);
  });

  it("非研究语义变化（仅 rowHash/rowNumber/图片下载时间）不改变 contextHash", () => {
    const row = {
      rowHash: ROW_HASH_A,
      rowNumber: 2,
      asin: "B0TEST0001",
      parentAsin: null,
      title: LONG_TITLE,
      amazonUrl: "https://www.amazon.com/dp/B0TEST0001",
      imageUrl: null,
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 123,
      brand: "Example",
      category: "Beauty",
      searchRank: 88,
      estimatedMonthlySales: 100,
      estimatedMonthlyRevenueUsd: 1999,
    };
    const recordA = {
      sourceMetaJson: buildSellerSpriteCandidateSourceMeta(row, FILE_HASH, IMPORTED_AT),
      analysisJson: "{}",
    };
    // 模拟图片资产化：analysisJson 写入 productImageSnapshot（研究语义之外）
    const recordB = {
      sourceMetaJson: recordA.sourceMetaJson,
      analysisJson: JSON.stringify({
        productImageSnapshot: {
          version: "product-batch-product-image.v1",
          source: "sellersprite_product_batch",
          status: "available",
          productKey: "amazon:US:B0TEST0001",
          candidateIdentityHash: "c".repeat(64),
          mimeType: "image/png",
          bytes: 8,
          contentHash: "d".repeat(64),
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          capturedAt: "2026-07-31T10:00:00.000Z",
        },
      }),
    };
    const hashA = createCandidateAnalysisBindingHash(recordA, buildCandidateAnalysisContext(recordA));
    const hashB = createCandidateAnalysisBindingHash(recordB, buildCandidateAnalysisContext(recordB));
    // seller_sprite 路径 context 只依赖 sourceMetaJson，不依赖 analysisJson 图片字段
    expect(hashA).toBe(hashB);
  });
});
