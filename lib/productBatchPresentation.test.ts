import { describe, expect, it } from "vitest";

import {
  AMAZON_US_TOP_LEVEL_CATEGORIES,
  detectProductBatchCategory,
  isAmazonUsTopLevelCategory,
  productBatchReportTypeLabel,
  readProductBatchItemPresentation,
} from "@/lib/productBatchPresentation";
import type { ProductBatchItemView } from "@/lib/productBatchStore";

describe("ProductBatch import presentation", () => {
  it("keeps stable English values while presenting Chinese report labels", () => {
    expect(productBatchReportTypeLabel("search_results")).toBe("搜索结果报表");
    expect(productBatchReportTypeLabel("category_current")).toBe("类目商品报表");
    expect(AMAZON_US_TOP_LEVEL_CATEGORIES.length).toBeGreaterThanOrEqual(40);
    expect(isAmazonUsTopLevelCategory("Home & Kitchen")).toBe(true);
    expect(isAmazonUsTopLevelCategory("Kitchen & Dining")).toBe(true);
    expect(isAmazonUsTopLevelCategory("Audible Books & Originals")).toBe(true);
    expect(isAmazonUsTopLevelCategory("Sports Collectibles")).toBe(true);
    expect(isAmazonUsTopLevelCategory("Unique Finds")).toBe(true);
  });

  it("selects the unique authoritative Category Current root category", () => {
    expect(detectProductBatchCategory({
      reportType: "category_current",
      rootCategories: [
        "Kitchen & Dining",
        "Kitchen & Dining",
        "Kitchen & Dining",
        "Home & Kitchen",
      ],
    })).toMatchObject({
      status: "detected",
      category: "Kitchen & Dining",
      validCategoryCount: 4,
    });
  });

  it("selects a clear Search Results majority but requires confirmation for a mixed report", () => {
    expect(detectProductBatchCategory({
      reportType: "search_results",
      rootCategories: [
        "Home & Kitchen",
        "Home & Kitchen",
        "Home & Kitchen",
        "Sports & Outdoors",
      ],
    })).toMatchObject({
      status: "detected",
      category: "Home & Kitchen",
    });
    expect(detectProductBatchCategory({
      reportType: "search_results",
      rootCategories: [
        "Home & Kitchen",
        "Home & Kitchen",
        "Sports & Outdoors",
        "Sports & Outdoors",
      ],
    })).toMatchObject({
      status: "mixed_requires_confirmation",
      category: null,
    });
  });

  it("normalizes only explicit Amazon aliases and never guesses an unknown category", () => {
    expect(detectProductBatchCategory({
      reportType: "category_current",
      rootCategories: ["Automotive Parts & Accessories", "Automotive Parts & Accessories"],
    })).toMatchObject({
      status: "detected",
      category: "Automotive",
    });
    expect(detectProductBatchCategory({
      reportType: "category_current",
      rootCategories: ["Synthetic Category", "Synthetic Category"],
    })).toMatchObject({
      status: "unknown",
      category: null,
    });
  });

  it("projects persisted ProductBatchItem evidence into a bounded research-priority view", () => {
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
      occurrenceProjectionJson: "{}",
      familyProjectionJson: "{}",
      rankingJson: JSON.stringify({
        positiveReasons: ["price_within_brief_range"],
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

    expect(readProductBatchItemPresentation(item)).toEqual({
      title: "Closet organizer",
      asin: "B000000001",
      price: "29.99",
      rating: "4.5",
      reviews: "120",
      estimatedMonthlySales: "25,957",
      researchPriority: "优先研究",
      evidenceStatus: "证据较完整，可用于批次内比较",
      positiveReasons: ["价格在本次研究范围内"],
      counterSignals: ["变体较多，仅作背景信息，未计分"],
      missingSignals: ["评论数"],
    });
  });

  it("fails visibly and safely when ProductBatchItem JSON is corrupt", () => {
    const corrupt = {
      normalizedProductJson: "not-json",
      rankingJson: '{"positiveReasons":"forged"}',
      asin: null,
      researchPriority: "unknown-priority",
      evidenceStatus: "unknown-evidence",
    } as ProductBatchItemView;

    expect(readProductBatchItemPresentation(corrupt)).toEqual({
      title: "商品标题缺失",
      asin: null,
      price: "待确认",
      rating: "缺失",
      reviews: "缺失",
      estimatedMonthlySales: "缺失",
      researchPriority: "研究顺序待确认",
      evidenceStatus: "证据状态待确认",
      positiveReasons: [],
      counterSignals: [],
      missingSignals: [],
    });
  });
});
