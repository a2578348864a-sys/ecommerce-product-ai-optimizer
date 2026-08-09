import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { ProductBatchItemView, ProductBatchView } from "@/lib/productBatchStore";
import { ProductBatchManagerView } from "./ProductBatchManager";

const batch: ProductBatchView = {
  id: "batch-a",
  batchName: "Home · organizer",
  marketplace: "US",
  currency: "USD",
  reportType: "search_results",
  query: "organizer",
  category: "Home",
  priceMinCents: 1000,
  priceMaxCents: 4000,
  briefHash: "a".repeat(64),
  sourceFileName: "input.xlsx",
  sourceFileSha256: "b".repeat(64),
  normalizedBusinessHash: "c".repeat(64),
  snapshotHash: "d".repeat(64),
  manifestHash: "e".repeat(64),
  itemCount: 1,
  acceptedCount: 1,
  quarantinedCount: 0,
  dataQualityStatus: "passed",
  batchStatus: "ready",
  sellerSpriteDisclaimerVersion: "v1",
  normalizedSnapshotJson: '{"schemaVersion":"sellersprite-market-snapshot.v3"}',
  manifestJson: '{"schemaVersion":"sellersprite-local-preview-manifest.v3"}',
  qualitySummaryJson: "{}",
  errorJson: null,
  dedupeKey: "f".repeat(64),
  importedAt: "2026-07-28T00:00:00.000Z",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

const item: ProductBatchItemView = {
  id: "item-a",
  batchId: "batch-a",
  productKey: "amazon:US:B000000001",
  ordinal: 0,
  asin: "B000000001",
  parentAsin: null,
  itemIdentityHash: "1".repeat(64),
  itemHash: "2".repeat(64),
  evidenceHash: "3".repeat(64),
  normalizedProductJson: JSON.stringify({
    providerMetrics: {
      productTitle: { status: "resolved", normalized: "Closet organizer" },
      price: { status: "resolved", normalized: 29.99 },
      rating: { status: "resolved", normalized: 4.5 },
      reviews: { status: "resolved", normalized: 120 },
      estimatedMonthlySales: { status: "resolved", normalized: 25957 },
    },
  }),
  occurrenceProjectionJson: '{"occurrences":[]}',
  familyProjectionJson: '{"family":null}',
  rankingJson: JSON.stringify({
    scoreRank: 1,
    researchPriority: "priority_1",
    evidenceStatus: "sufficient_for_comparison",
    positiveReasons: [
      "price_within_brief_range",
      "organic_visibility_observed",
    ],
    counterSignals: ["multiple_variations_context_only_no_score"],
    missingSignals: ["reviews"],
  }),
  provisionalDisposition: "provisional_score_only",
  researchPriority: "priority_1",
  evidenceStatus: "sufficient_for_comparison",
  promotionEligible: false,
  imageSnapshotJson: '{"status":"not_cached"}',
  createdAt: "2026-07-28T00:00:00.000Z",
};

function render(
  accessMode: "owner" | "visitor",
  overrides: {
    selectedBatch?: ProductBatchView;
    selection?: {
      activeProductBatchId: string | null;
      activeLegacyRegistrationId: string | null;
      updatedAt: string;
    };
    selectedItem?: ProductBatchItemView;
    manualReportTypeRequired?: boolean;
    importInspectionState?: "idle" | "loading" | "ready" | "manual" | "error";
    categoryStatus?: "detected" | "mixed_requires_confirmation" | "unknown";
    selectedCategory?: string;
    batches?: unknown[];
    errorMessage?: string | null;
    selectedFileName?: string;
  } = {},
) {
  const selectedBatch = overrides.selectedBatch ?? batch;
  return renderToStaticMarkup(createElement(ProductBatchManagerView, {
    state: "ready",
    accessMode,
    maxProducts: accessMode === "visitor" ? 5 : null,
    usedProducts: accessMode === "visitor" ? 0 : null,
    remainingProducts: accessMode === "visitor" ? 5 : null,
    batches: (overrides.batches ?? [batch]) as never,
    selection: overrides.selection ?? {
      activeProductBatchId: batch.id,
      activeLegacyRegistrationId: null,
      updatedAt: batch.updatedAt,
    },
    legacyRegistrationId: "production-registration-20260717-01",
    selectedBatch,
    selectedItems: [overrides.selectedItem ?? item],
    busy: false,
    errorMessage: overrides.errorMessage,
    selectedFileName: overrides.selectedFileName,
    manualReportTypeRequired: overrides.manualReportTypeRequired,
    importInspectionState: overrides.importInspectionState ?? "ready",
    importInspection: {
      reportType: "search_results",
      reportTypeDetected: true,
      categoryDetection: {
        status: overrides.categoryStatus ?? "detected",
        category: overrides.categoryStatus === "mixed_requires_confirmation"
          ? null
          : "Home & Kitchen",
        distribution: [
          { category: "Home & Kitchen", count: 8 },
          { category: "Sports & Outdoors", count: 2 },
        ],
        validCategoryCount: 10,
      },
      query: null,
      queryDetection: "not_available",
    },
    selectedReportType: "search_results",
    selectedCategory: overrides.selectedCategory ?? "Home & Kitchen",
    onResearchItem: () => undefined,
  }));
}

describe("ProductBatch unified role UI", () => {
  it("shows Owner and Visitor the same main batch actions", () => {
    const owner = render("owner");
    const visitor = render("visitor");
    for (const label of [
      "上传报表",
      "导入并查看优先级",
      "历史导入",
      "查看商品",
      "设为当前",
      "归档",
    ]) {
      expect(owner).toContain(label);
      expect(visitor).toContain(label);
    }
    expect(owner).toContain('name="file"');
    expect(owner).not.toContain("查看旧版候选");
    expect(owner).not.toContain("旧版候选批次");
    expect(visitor).not.toContain("仅 Owner");
    expect(visitor).not.toContain("访客无权上传");
  });

  it("adds only the Visitor quota and isolated sandbox notice", () => {
    const owner = render("owner");
    const visitor = render("visitor");
    expect(visitor).toContain("已使用商品 0 / 5");
    expect(visitor).toContain("剩余 5 个商品");
    expect(visitor).not.toContain("AI 额度");
    expect(owner).not.toContain("已使用商品");
  });

  it("offers the same single add-to-research action for eligible Owner and Visitor items", () => {
    const owner = render("owner");
    const html = render("visitor");
    expect(html).toContain("Closet organizer");
    expect(html).toContain("加入研究");
    expect(owner).toContain("加入研究");
    expect(html.match(/加入研究/g)).toHaveLength(1);
    expect(html).not.toContain("/agent/run");
  });

  it("restores the existing inline inspect/import form as the only new import entry", () => {
    const automatic = render("owner");
    const fallback = render("owner", {
      manualReportTypeRequired: true,
      importInspectionState: "manual",
    });

    expect(automatic).toContain("上传报表");
    expect(automatic).toContain('name="file"');
    expect(automatic).toContain('accept=".xlsx"');
    expect(automatic).toContain('class="sr-only"');
    expect(automatic).toContain('for="product-batch-file"');
    expect(automatic).toContain("选择文件");
    expect(automatic).toContain("尚未选择文件");
    expect(automatic).toContain('name="reportType"');
    expect(automatic).toContain('name="query"');
    expect(automatic).toContain('name="category"');
    expect(automatic).toContain('name="priceMin"');
    expect(automatic).toContain('name="priceMax"');
    expect(automatic).not.toMatch(/<input[^>]*name="priceMin"[^>]*required/);
    expect(automatic).not.toMatch(/<input[^>]*name="priceMax"[^>]*required/);
    expect(automatic).toContain("已识别为搜索结果报表");
    expect(automatic).toContain("导入并查看优先级");
    expect(automatic).not.toMatch(/href="\/opportunities\/sellersprite-preview"/);
    expect(fallback).toContain("手动选择报表类型");
    // 保留批次商品内部信息折叠（不暴露技术字段名）
    expect(automatic).toMatch(/<details[^>]*><summary[^>]*>报表信息<\/summary>/);
  });

  it("shows the selected XLSX name beside the stable accessible file trigger", () => {
    const html = render("owner", { selectedFileName: "seller-sprite.xlsx" });
    expect(html).toContain("已选择：seller-sprite.xlsx");
    expect(html).toContain('aria-label="选择 SellerSprite XLSX 文件"');
  });

  it("keeps the inspected file state when the native chooser is cancelled", () => {
    const source = readFileSync(new URL("./ProductBatchManager.tsx", import.meta.url), "utf8");
    const handler = source.slice(
      source.indexOf("const handleImportFileChange"),
      source.indexOf("const handleImport =", source.indexOf("const handleImportFileChange")),
    );
    expect(handler.indexOf("if (!file) return;")).toBeGreaterThan(-1);
    expect(handler.indexOf("if (!file) return;")).toBeLessThan(handler.indexOf("setImportInspection(null);"));
  });

  it("shows XLSX inspection errors next to the import form", () => {
    const html = render("owner", {
      importInspectionState: "error",
      manualReportTypeRequired: true,
      errorMessage: "SellerSprite XLSX 文件结构无法识别",
    });

    expect(html).toContain("SellerSprite XLSX 文件结构无法识别");
  });

  it("shows the intelligent research priority with evidence and third-party estimate boundaries", () => {
    const html = render("owner");

    expect(html).toContain("智能研究优先级");
    expect(html).toContain("优先研究");
    expect(html).toContain("证据较完整，可用于批次内比较");
    expect(html).toContain("第三方估算月销量");
    expect(html).toContain("25,957");
    expect(html).toContain("有利信号");
    expect(html).toContain("价格在本次研究范围内");
    expect(html).toContain("观察到自然搜索曝光");
    expect(html).toContain("反向信号");
    expect(html).toContain("变体较多，仅作背景信息，未计分");
    expect(html).toContain("缺失信号");
    expect(html).toContain("评论数");
    for (const forbidden of ["AI推荐购买", "爆款", "赚钱概率"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("removes the legacy candidate entry while keeping ranking evidence explainable", () => {
    const html = render("owner", {
      selection: {
        activeProductBatchId: null,
        activeLegacyRegistrationId: "production-registration-20260717-01",
        updatedAt: batch.updatedAt,
      },
    });

    // 旧版候选批次入口已移除；新的排序依据可展开查看
    expect(html).not.toContain("旧版候选批次");
    expect(html).not.toContain("查看旧版候选");
    expect(html).toContain("智能研究优先级");
    expect(html).toContain("优先研究");
    expect(html).toContain("ASIN：B000000001");
    expect(html).not.toContain("ProductBatch V1");
    expect(html).not.toContain("切回 Legacy");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>查看排序依据<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*open/);
  });

  it("shows a clear empty state with upload button when no batch exists", () => {
    const empty = render("owner", { batches: [] });
    expect(empty).toContain("还没有导入商品");
    expect(empty).toContain("使用上方上传区导入 SellerSprite XLSX");
  });

  it("shows a validated cached product image and keeps a safe placeholder otherwise", () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]);
    const cached = render("owner", {
      selectedItem: {
        ...item,
        imageSnapshotJson: JSON.stringify({
          status: "cached",
          mimeType: "image/png",
          sizeBytes: pngBytes.length,
          sha256: "275f1bcbbb585c71e3b2184304eccfa0e37de92022ca3b6f4e9c10df32318d85",
          base64: pngBytes.toString("base64"),
        }),
      },
    });
    const missing = render("owner");

    expect(cached).toContain("data:image/png;base64,");
    expect(missing).toContain("商品图片暂不可用");
    expect(missing).not.toContain("<img");
  });

  it("distinguishes a resolved zero price from a missing price", () => {
    const zeroPrice = render("owner", {
      selectedItem: {
        ...item,
        normalizedProductJson: JSON.stringify({
          providerMetrics: {
            productTitle: { status: "resolved", normalized: "Free sample" },
            price: { status: "resolved", normalized: 0 },
          },
        }),
      },
    });
    const missingPrice = render("owner", {
      selectedItem: {
        ...item,
        normalizedProductJson: JSON.stringify({
          providerMetrics: {
            productTitle: { status: "resolved", normalized: "Unknown price" },
            price: { status: "missing", normalized: null },
          },
        }),
      },
    });

    expect(zeroPrice).toContain("价格<br/><b>0</b>");
    expect(missingPrice).toContain("价格<br/><b>待确认</b>");
  });

  it("disables research when the batch is not active, passing, or source-safe", () => {
    const inactive = render("owner", {
      selection: {
        activeProductBatchId: "batch-other",
        activeLegacyRegistrationId: null,
        updatedAt: batch.updatedAt,
      },
    });
    const blockedQuality = render("owner", {
      selectedBatch: { ...batch, dataQualityStatus: "blocked" },
    });
    const forgedPromotion = render("owner", {
      selectedItem: { ...item, promotionEligible: true },
    });

    expect(inactive).toContain("请先把该批次设置为当前批次");
    expect(blockedQuality).toContain("批次数据质量尚未通过");
    expect(forgedPromotion).toContain("商品来源状态异常");
    expect(inactive).toMatch(/<button[^>]*disabled[^>]*>加入研究<\/button>/);
    expect(blockedQuality).toMatch(/<button[^>]*disabled[^>]*>加入研究<\/button>/);
    expect(forgedPromotion).toMatch(/<button[^>]*disabled[^>]*>加入研究<\/button>/);
  });

  it("does not expose private batch data in the unauthenticated state", () => {
    const html = renderToStaticMarkup(createElement(ProductBatchManagerView, {
      state: "unauthenticated",
      accessMode: null,
      maxProducts: null,
      usedProducts: null,
      remainingProducts: null,
      batches: [],
      selection: null,
      legacyRegistrationId: null,
      selectedBatch: null,
      selectedItems: [],
      busy: false,
      onResearchItem: () => undefined,
    }));
    expect(html).toContain("登录后查看和选择商品");
    expect(html).not.toContain("batch-a");
    expect(html).not.toContain("Closet organizer");
  });
});
