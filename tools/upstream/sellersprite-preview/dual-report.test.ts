import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
  SELLERSPRITE_CATEGORY_CURRENT_ROWS,
} from "../../../lib/upstream/sellersprite/fixtures/category-current.sanitized.v1";
import {
  SellerSpritePreviewError,
  parseSellerSpritePreviewArgs,
  runSellerSpritePreview,
} from "./runner";
import { createSellerSpritePreviewTestWorkbook } from "./test-fixtures";

function categoryArgs(input: string, outputDir: string) {
  return {
    kind: "run" as const,
    reportType: "category_current" as const,
    input,
    query: null,
    category: "Sports & Outdoors",
    priceMin: 20,
    priceMax: 100,
    outputDir,
    format: "both" as const,
  };
}

describe("SellerSprite local preview dual report CLI", () => {
  it("requires an explicit report type and enforces type-specific query semantics", () => {
    expect(() => parseSellerSpritePreviewArgs([
      "--input", "sample.xlsx",
      "--query", "storage",
      "--category", "Storage",
      "--price-min", "20",
      "--price-max", "100",
    ])).toThrow(expect.objectContaining({ code: "report_type_required" }));

    expect(parseSellerSpritePreviewArgs([
      "--report-type", "category-current",
      "--input", "sample.xlsx",
      "--category", "Sports & Outdoors",
      "--price-min", "20",
      "--price-max", "100",
    ])).toMatchObject({
      kind: "run",
      reportType: "category_current",
      query: null,
    });

    expect(() => parseSellerSpritePreviewArgs([
      "--report-type", "category-current",
      "--input", "sample.xlsx",
      "--query", "not applicable",
      "--category", "Sports & Outdoors",
      "--price-min", "20",
      "--price-max", "100",
    ])).toThrow(expect.objectContaining({ code: "query_not_applicable" }));

    expect(() => parseSellerSpritePreviewArgs([
      "--report-type", "search-results",
      "--input", "sample.xlsx",
      "--category", "Storage",
      "--price-min", "20",
      "--price-max", "100",
    ])).toThrow(expect.objectContaining({ code: "query_required" }));
  });

  it("renders a Category Current report without Search placement language", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-category-cli-test-"));
    try {
      const input = join(root, "category.xlsx");
      const output = join(root, "report");
      writeFileSync(input, createSellerSpritePreviewTestWorkbook({
        headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
        rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
      }));
      const result = runSellerSpritePreview(categoryArgs(input, output), {
        repositoryRoot: join(root, "repository"),
        now: () => "2026-07-27T02:00:00.000Z",
      });
      const markdown = readFileSync(join(output, "sellersprite-preview.md"), "utf8");

      expect(result.report).toMatchObject({
        schemaVersion: "sellersprite-local-preview-report.v3",
        reportType: "category_current",
        query: null,
        occurrenceSummary: {
          occurrenceCount: 2,
          occurrenceLabel: "Category Current records",
        },
        placementSummary: { status: "not_applicable" },
      });
      expect(result.manifest).toMatchObject({
        schemaVersion: "sellersprite-local-preview-manifest.v3",
        reportType: "category_current",
      });
      expect(result.report.ranking).toMatchObject({
        schemaVersion: "sellersprite-market-signal-ranking.v2",
        modelVersion: "sellersprite-market-signal-ranking.category.v2",
        reportType: "category_current",
      });
      expect(result.report.ranking.products.flatMap((product) => product.components))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({
            component: "categoryBsrSignal",
            label: "Category BSR",
          }),
        ]));
      expect(result.report.ranking.products.flatMap((product) => product.components))
        .not.toEqual(expect.arrayContaining([
          expect.objectContaining({ component: "organicVisibility" }),
          expect.objectContaining({ component: "placementCoverage" }),
          expect.objectContaining({ component: "sponsoredExposure" }),
        ]));
      expect(markdown).toContain("类目当前商品");
      expect(markdown).toContain("Category Current 记录");
      expect(markdown).toContain("大类 BSR");
      expect(markdown).toContain("小类 BSR");
      expect(markdown).toContain("搜索位置：不适用");
      expect(markdown).toContain("BSR 是类目排名信号，不代表平台后台订单数据");
      expect(markdown).toContain("Category BSR");
      expect(markdown).not.toContain("查询关键词");
      expect(markdown).not.toContain("搜索外观");
      expect(markdown).not.toContain("广告位数量");
      expect(markdown).not.toContain("自然位数量");
      expect(markdown).not.toContain("最佳广告位置");
      expect(markdown).not.toContain("最佳自然位置");
      expect(markdown).not.toContain("自然位可见性");
      expect(markdown).not.toContain("广告曝光");
      expect(markdown).not.toContain("搜索位置覆盖");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed with report_type_mismatch before writing a success report", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-mismatch-cli-test-"));
    try {
      const input = join(root, "category.xlsx");
      writeFileSync(input, createSellerSpritePreviewTestWorkbook({
        headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
        rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
      }));
      try {
        runSellerSpritePreview({
          ...categoryArgs(input, join(root, "report")),
          reportType: "search_results",
          query: "storage",
        });
        throw new Error("expected mismatch");
      } catch (error) {
        expect(error).toBeInstanceOf(SellerSpritePreviewError);
        expect(error).toMatchObject({
          code: "report_type_mismatch",
          exitCode: 4,
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
