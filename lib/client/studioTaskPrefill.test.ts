import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractStudioTaskPrefill } from "./studioTaskPrefill";

describe("Studio task prefill", () => {
  it("projects existing task facts without requiring a task-shaped Studio", () => {
    expect(extractStudioTaskPrefill({
      id: "task-1",
      title: "Foldable Stand",
      materialText: "Aluminium stand with adjustable angle.",
      result: {
        category: "Home Office",
        sellingPoints: ["foldable", "adjustable"],
      },
    })).toEqual({
      taskId: "task-1",
      productName: "Foldable Stand",
      description: "Aluminium stand with adjustable angle.",
      category: "Home Office",
      targetMarket: "",
      sellingPoints: "foldable, adjustable",
      confirmedFacts: "",
      unverifiedFacts: "",
      primaryKeyword: "Foldable Stand",
      secondaryKeywords: "",
    });
  });

  it("prefills ProductBatch facts and saved keyword preparation without treating provider facts as confirmed", () => {
    expect(extractStudioTaskPrefill({
      id: "task-product-batch",
      title: "Closet organizer",
      materialText: "Closet organizer",
      result: {
        sourceMeta: {
          productBatchSnapshot: {
            category: "Home & Kitchen",
            marketplace: "US",
            query: "closet organizer",
            productFacts: {
              productTitle: "Six-shelf closet organizer",
              brand: "Example Brand",
              price: 0,
              rating: 4.6,
              reviews: 1234,
              estimatedMonthlySales: 999,
              estimatedMonthlyRevenue: 9999,
              rootCategory: "Home & Kitchen",
            },
          },
          productBatchListingFacts: {
            version: "product-batch-listing-facts.v1",
            marketplace: "US",
            asin: "B000000001",
            parentAsin: "B000000000",
            category: "Home & Kitchen",
            productTitle: "Six-shelf closet organizer",
            brand: "Example Brand",
            price: 0,
            rating: 4.6,
            reviews: 1234,
            rootCategory: "Home & Kitchen",
            productDimensions: "20 x 30 x 100 cm",
            productBulletPoints: "foldable; adjustable",
            acKeywords: "closet organizer; hanging shelves",
          },
        },
        listingPrepSnapshot: {
          keywordPool: {
            coreWords: ["closet organizer", "hanging shelves"],
            longTailWords: ["six shelf closet storage"],
          },
        },
      },
    })).toEqual({
      taskId: "task-product-batch",
      productName: "Closet organizer",
      description: "foldable; adjustable",
      category: "Home & Kitchen",
      targetMarket: "US",
      sellingPoints: "foldable, adjustable",
      confirmedFacts: [
        "品牌：Example Brand",
        "ASIN：B000000001",
        "父 ASIN：B000000000",
        "商品价格：0 USD",
        "商品评分：4.6",
        "评论数：1234",
        "大类目：Home & Kitchen",
        "商品尺寸：20 x 30 x 100 cm",
      ].join("\n"),
      unverifiedFacts: "",
      primaryKeyword: "closet organizer",
      secondaryKeywords: "hanging shelves, six shelf closet storage",
    });
    const serialized = JSON.stringify(extractStudioTaskPrefill({
      id: "task-product-batch",
      title: "Closet organizer",
      result: {
        sourceMeta: {
          productBatchListingFacts: {
            version: "product-batch-listing-facts.v1",
            marketplace: "US",
            asin: "B000000001",
            category: "Home & Kitchen",
          },
        },
      },
    }));
    expect(serialized).not.toContain("estimatedMonthlySales");
    expect(serialized).not.toContain("estimatedMonthlyRevenue");
  });

  it("returns null for malformed task data", () => {
    expect(extractStudioTaskPrefill(null)).toBeNull();
    expect(extractStudioTaskPrefill({ id: "", title: "No id" })).toBeNull();
  });

  it("uses the real result name and cleans legacy task-title suffixes for both Studios", () => {
    expect(extractStudioTaskPrefill({
      id: "task-result-name",
      title: "Closet organizer 一键分析",
      materialText: "Closet organizer",
      result: {
        productName: "Closet organizer",
      },
    })?.productName).toBe("Closet organizer");

    expect(extractStudioTaskPrefill({
      id: "task-legacy-title",
      title: "Legacy desk stand 一键分析",
      materialText: "Legacy desk stand",
      result: {},
    })?.productName).toBe("Legacy desk stand");
  });

  it("keeps independent Studio pages and carries an optional verified taskId", () => {
    const listingPage = readFileSync(resolve(process.cwd(), "app/listing-studio/page.tsx"), "utf8");
    const imagePage = readFileSync(resolve(process.cwd(), "app/image-studio/page.tsx"), "utf8");

    expect(listingPage).not.toContain("redirect(");
    expect(imagePage).not.toContain("redirect(");
    expect(listingPage).toMatch(/<ListingStudioClient taskId=\{taskId\}/);
    expect(imagePage).toMatch(/<ImageStudioClient taskId=\{taskId\}/);
  });
});
