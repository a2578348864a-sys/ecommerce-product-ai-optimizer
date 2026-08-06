import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
    },
  }),
  occurrenceProjectionJson: '{"occurrences":[]}',
  familyProjectionJson: '{"family":null}',
  rankingJson: '{"scoreRank":1,"researchPriority":"priority_1"}',
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
  } = {},
) {
  const selectedBatch = overrides.selectedBatch ?? batch;
  return renderToStaticMarkup(createElement(ProductBatchManagerView, {
    state: "ready",
    accessMode,
    remainingAiCalls: accessMode === "visitor" ? 5 : null,
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
      "上传并预览报表",
      "批次历史",
      "查看商品",
      "设置为当前",
      "归档",
    ]) {
      expect(owner).toContain(label);
      expect(visitor).toContain(label);
    }
    // 已移除内嵌上传表单与旧版候选入口
    expect(owner).not.toContain("导入新批次");
    expect(owner).not.toContain("查看旧版候选");
    expect(owner).not.toContain("旧版候选批次");
    expect(visitor).not.toContain("仅 Owner");
    expect(visitor).not.toContain("访客无权上传");
  });

  it("adds only the Visitor quota and isolated sandbox notice", () => {
    const owner = render("owner");
    const visitor = render("visitor");
    expect(visitor).toContain("剩余真实 AI 额度 5/5");
    expect(visitor).toContain("独立访客沙盒");
    expect(owner).not.toContain("独立访客沙盒");
  });

  it("offers the same single primary research action for eligible Owner and Visitor items", () => {
    const owner = render("owner");
    const html = render("visitor");
    expect(html).toContain("Closet organizer");
    expect(html).toContain("研究此商品");
    expect(owner).toContain("研究此商品");
    expect(html.match(/研究此商品/g)).toHaveLength(1);
    expect(html).not.toContain("/agent/run");
  });

  it("replaces the inline upload form with a single upload entry to sellersprite-preview", () => {
    const automatic = render("owner");
    const fallback = render("owner", {
      manualReportTypeRequired: true,
      importInspectionState: "manual",
    });

    // 内嵌上传表单已移除，统一入口指向 sellersprite-preview
    expect(automatic).toContain("上传报表");
    expect(automatic).toContain("上传并预览报表");
    expect(automatic).toMatch(/href="\/opportunities\/sellersprite-preview"/);
    expect(automatic).not.toContain("导入新批次");
    expect(automatic).not.toContain("已自动识别文件结构");
    expect(automatic).not.toContain("手动选择报表类型");
    // 保留批次商品内部信息折叠（不暴露技术字段名）
    expect(automatic).toMatch(/<details[^>]*><summary[^>]*>高级信息<\/summary>/);
  });

  it("removes legacy candidate batch entry while keeping item internals collapsed", () => {
    const html = render("owner", {
      selection: {
        activeProductBatchId: null,
        activeLegacyRegistrationId: "production-registration-20260717-01",
        updatedAt: batch.updatedAt,
      },
    });

    // 旧版候选批次入口已移除；批次商品内部信息仍折叠展示
    expect(html).not.toContain("旧版候选批次");
    expect(html).not.toContain("查看旧版候选");
    expect(html).toContain("内部研究顺序：priority_1");
    expect(html).toContain("ASIN：B000000001");
    expect(html).not.toContain("ProductBatch V1");
    expect(html).not.toContain("切回 Legacy");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>高级信息<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*open/);
  });

  it("shows a clear empty state with upload button when no batch exists", () => {
    const empty = render("owner", { batches: [] });
    expect(empty).toContain("还没有商品批次");
    expect(empty).toContain("上传并预览报表");
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
    expect(inactive).toMatch(/<button[^>]*disabled[^>]*>研究此商品<\/button>/);
    expect(blockedQuality).toMatch(/<button[^>]*disabled[^>]*>研究此商品<\/button>/);
    expect(forgedPromotion).toMatch(/<button[^>]*disabled[^>]*>研究此商品<\/button>/);
  });

  it("does not expose private batch data in the unauthenticated state", () => {
    const html = renderToStaticMarkup(createElement(ProductBatchManagerView, {
      state: "unauthenticated",
      accessMode: null,
      remainingAiCalls: null,
      batches: [],
      selection: null,
      legacyRegistrationId: null,
      selectedBatch: null,
      selectedItems: [],
      busy: false,
      onResearchItem: () => undefined,
    }));
    expect(html).toContain("登录后管理商品批次");
    expect(html).not.toContain("batch-a");
    expect(html).not.toContain("Closet organizer");
  });
});
