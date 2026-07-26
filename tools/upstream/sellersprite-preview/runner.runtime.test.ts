import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSellerSpritePreview } from "./runner";

const officialSamplePath = process.env.SELLERSPRITE_XLSX_SAMPLE_PATH;
const describeOfficialSample = officialSamplePath ? describe : describe.skip;

describeOfficialSample("SellerSprite local preview official sample runtime", () => {
  it("creates a non-authoritative report without persisting the source path", () => {
    const result = runSellerSpritePreview({
      kind: "run",
      reportType: "search_results",
      input: officialSamplePath!,
      query: "runtime validation query",
      category: "Storage & Organization",
      priceMin: 20,
      priceMax: 100,
      outputDir: null,
      format: "both",
    }, {
      now: () => "2026-07-27T02:00:00.000Z",
    });

    try {
      expect(result.report).toMatchObject({
        inputFileName: basename(officialSamplePath!),
        sourceFileSha256: createHash("sha256")
          .update(readFileSync(officialSamplePath!))
          .digest("hex"),
        precheckSummary: {
          sheetName: "US",
          headerColumnCount: 73,
          totalRows: 10,
          acceptedRows: 10,
          rejectedRows: 0,
        },
        appearanceSummary: {
          appearanceCount: 10,
          sponsoredPlacementCount: 8,
          organicPlacementCount: 2,
          unknownPlacementCount: 0,
        },
        productSummary: {
          productCount: 9,
          uniqueAsinCount: 9,
          duplicateAsinCount: 1,
        },
        currentStage1Invoked: false,
        authoritative: false,
        hardGateEvaluable: false,
        promotionEligible: false,
        manifestRegistered: false,
        productionEffect: false,
        productionDatabaseWritten: false,
      });
      const appearancesByAsin = new Map<string, number>();
      for (const appearance of result.report.appearances) {
        if (appearance.asin === null) continue;
        appearancesByAsin.set(
          appearance.asin,
          (appearancesByAsin.get(appearance.asin) ?? 0) + 1,
        );
      }
      expect([...appearancesByAsin.values()].filter((count) => count === 2))
        .toHaveLength(1);
      expect(result.report.products.every((product) => product.promotionEligible === false))
        .toBe(true);
      expect(result.writtenFiles).toEqual([
        "sellersprite-preview.json",
        "sellersprite-preview.md",
        "sellersprite-preview-manifest.json",
      ]);
      const reportJson = readFileSync(
        join(result.outputDirectory, "sellersprite-preview.json"),
        "utf8",
      );
      const markdown = readFileSync(
        join(result.outputDirectory, "sellersprite-preview.md"),
        "utf8",
      );
      expect(reportJson).not.toContain(officialSamplePath!);
      expect(markdown).not.toContain(officialSamplePath!);
    } finally {
      rmSync(result.outputDirectory, { recursive: true, force: true });
    }
  });
});

const categorySamples = [
  {
    name: "Sports",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_SPORTS_PATH,
    sha256: "41ced066135a5734251d493429effc8d6417db34d8fabdd7252abdde0f640582",
    familyCount: 8,
  },
  {
    name: "Office",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_OFFICE_PATH,
    sha256: "5069fcaa967ee945995d2ff84bd05667a8a32ea909f064c175f469101dd84247",
    familyCount: 7,
  },
  {
    name: "Auto",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_AUTO_PATH,
    sha256: "8cf6007874c1eb778f8ef389c556e1b93c43e2fe0d78ab530650596856ccf742",
    familyCount: 9,
  },
] as const;

describe("SellerSprite Category Current CLI official samples", () => {
  for (const sample of categorySamples) {
    const categoryIt = sample.path ? it : it.skip;
    categoryIt(`${sample.name} produces Category Current JSON and Markdown`, () => {
      const result = runSellerSpritePreview({
        kind: "run",
        reportType: "category_current",
        input: sample.path!,
        query: null,
        category: `${sample.name} Category`,
        priceMin: 20,
        priceMax: 100,
        outputDir: null,
        format: "both",
      }, {
        now: () => "2026-07-27T02:00:00.000Z",
      });
      try {
        expect(result.report).toMatchObject({
          reportType: "category_current",
          sourceFileSha256: sample.sha256,
          query: null,
          precheckSummary: {
            headerColumnCount: 72,
            totalRows: 10,
            acceptedRows: 10,
            rejectedRows: 0,
          },
          occurrenceSummary: {
            occurrenceCount: 10,
            occurrenceLabel: "Category Current records",
          },
          appearanceSummary: null,
          placementSummary: { status: "not_applicable" },
          productSummary: { productCount: 10, uniqueAsinCount: 10 },
          familySummary: { familyCount: sample.familyCount },
          currentStage1Invoked: false,
          promotionEligible: false,
          productionEffect: false,
          productionDatabaseWritten: false,
        });
        const markdown = readFileSync(
          join(result.outputDirectory, "sellersprite-preview.md"),
          "utf8",
        );
        expect(markdown).toContain("类目当前商品");
        expect(markdown).toContain("Category Current 记录");
        expect(markdown).toContain("大类 BSR");
        expect(markdown).toContain("小类 BSR");
        expect(markdown).not.toContain("查询关键词");
        expect(markdown).not.toContain("广告位数量");
        expect(markdown).not.toContain("自然位数量");
        expect(markdown).not.toContain("最佳广告位置");
        expect(markdown).not.toContain("最佳自然位置");
      } finally {
        rmSync(result.outputDirectory, { recursive: true, force: true });
      }
    });
  }
});
