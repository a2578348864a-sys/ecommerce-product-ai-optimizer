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
