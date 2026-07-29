import { describe, expect, it } from "vitest";

import {
  AMAZON_US_TOP_LEVEL_CATEGORIES,
  detectProductBatchCategory,
  isAmazonUsTopLevelCategory,
  productBatchReportTypeLabel,
} from "@/lib/productBatchPresentation";

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
});
