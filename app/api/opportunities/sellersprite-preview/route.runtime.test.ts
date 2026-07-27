import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { SELLERSPRITE_SEARCH_EXPORT_SOURCE_HASH } from "@/lib/upstream/sellersprite/fixtures/search-export.sanitized.v1";

const { ownerGuardMock } = vi.hoisted(() => ({
  ownerGuardMock: vi.fn(() => ({ ok: true, context: { mode: "owner" } })),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireOwnerOnly: ownerGuardMock,
}));

import { POST } from "./route";

const officialSamplePath = process.env.SELLERSPRITE_XLSX_SAMPLE_PATH;
const runtimeDescribe = officialSamplePath ? describe : describe.skip;

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

runtimeDescribe("SellerSprite opportunity preview official sample", () => {
  it("returns the exact read-only market preview without persisting the source path", async () => {
    const bytes = readFileSync(officialSamplePath!);
    const form = new FormData();
    form.append(
      "file",
      new File([asArrayBuffer(bytes)], basename(officialSamplePath!), {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    form.append("reportType", "search_results");
    form.append("query", "storage box");
    form.append("category", "Home & Kitchen");
    form.append("priceMin", "20");
    form.append("priceMax", "100");
    const response = await POST(new NextRequest(
      "http://localhost:3407/api/opportunities/sellersprite-preview",
      {
        method: "POST",
        headers: { origin: "http://localhost:3407" },
        body: form,
      },
    ));
    const payload = await response.json() as {
      ok: boolean;
      data: {
        sourceFileName: string;
        sourceFileSha256: string;
        sheetName: string;
        headerColumnCount: number;
        totalRows: number;
        acceptedRows: number;
        rejectedRows: number;
        appearanceCount: number;
        productCount: number;
        familyCount: number;
        uniqueAsinCount: number;
        duplicateAppearanceGroupCount: number;
        sponsoredAppearanceCount: number;
        organicAppearanceCount: number;
        unknownAppearanceCount: number;
        productWeightedStatistics: {
          price: { median: number | null };
          estimatedMonthlySales: { median: number | null };
        };
        authoritative: boolean;
        promotionAllowed: boolean;
        hardGateEvaluable: boolean;
        currentStage1Invoked: boolean;
        productionEffect: boolean;
        productionDatabaseWritten: boolean;
        manifestRegistered: boolean;
        products: Array<{
          asin: string;
          appearanceCount: number;
          promotionEligible: boolean;
        }>;
        ranking: {
          schemaVersion: string;
          modelVersion: string;
          reportType: string;
          rankableProductCount: number;
          products: Array<{
            asin: string;
            scoreRank: number | null;
            signalScore: number | null;
            conditionalSignalScore: number | null;
            evidenceCoverage: number;
            evidenceStatus: string;
            researchPriority: string;
            promotionEligible: boolean;
            componentScores: Array<{ component: string }>;
          }>;
          safety: {
            authoritative: boolean;
            currentStage1Invoked: boolean;
            promotionEligible: boolean;
            manifestRegistered: boolean;
            productionEffect: boolean;
            productionDatabaseWritten: boolean;
          };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      sourceFileName: basename(officialSamplePath!),
      sourceFileSha256: SELLERSPRITE_SEARCH_EXPORT_SOURCE_HASH,
      sheetName: "US",
      headerColumnCount: 73,
      totalRows: 10,
      acceptedRows: 10,
      rejectedRows: 0,
      appearanceCount: 10,
      productCount: 9,
      familyCount: 4,
      uniqueAsinCount: 9,
      duplicateAppearanceGroupCount: 1,
      sponsoredAppearanceCount: 8,
      organicAppearanceCount: 2,
      unknownAppearanceCount: 0,
      authoritative: false,
      promotionAllowed: false,
      hardGateEvaluable: false,
      currentStage1Invoked: false,
      productionEffect: false,
      productionDatabaseWritten: false,
      manifestRegistered: false,
      ranking: {
        schemaVersion: "sellersprite-market-signal-ranking.v2",
        modelVersion: "sellersprite-market-signal-ranking.search.v2",
        reportType: "search_results",
        rankableProductCount: 8,
      },
    });
    expect(payload.data.sourceFileSha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(payload.data.productWeightedStatistics.price.median).toBe(78);
    expect(payload.data.productWeightedStatistics.estimatedMonthlySales.median).toBe(4449);
    expect(payload.data.products.find((product) => product.asin === "B082PJPQ1Y"))
      .toMatchObject({ appearanceCount: 2, promotionEligible: false });
    expect(payload.data.products.every((product) => product.promotionEligible === false)).toBe(true);
    expect(payload.data.ranking.products
      .filter((product) => product.scoreRank !== null)
      .slice(0, 3)
      .map((product) => product.asin)).toEqual([
        "B08HR4K9Y5",
        "B09ZV2TX28",
        "B082PJN8BD",
      ]);
    expect(payload.data.ranking.products
      .filter((product) => product.scoreRank !== null)
      .every((product) => (
        product.evidenceCoverage === 1
        && product.conditionalSignalScore === product.signalScore
        && product.promotionEligible === false
      ))).toBe(true);
    expect(payload.data.ranking.products
      .filter((product) => product.scoreRank === null)).toEqual([
        expect.objectContaining({
          signalScore: null,
          evidenceStatus: "limited_evidence",
          researchPriority: "unranked_insufficient_evidence",
          promotionEligible: false,
        }),
      ]);
    expect(payload.data.ranking.safety).toEqual({
      authoritative: false,
      currentStage1Invoked: false,
      hardGateEvaluable: false,
      promotionEligible: false,
      manifestRegistered: false,
      productionEffect: false,
      productionDatabaseWritten: false,
    });
    expect(JSON.stringify(payload)).not.toContain(officialSamplePath!);
  });
});

const categorySamples = [
  {
    name: "Sports",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_SPORTS_PATH,
    sha256: "41ced066135a5734251d493429effc8d6417db34d8fabdd7252abdde0f640582",
    familyCount: 8,
    top3: ["B0GSH7JDR8", "B0G3Y89LW9", "B0GXHR4CR9"],
  },
  {
    name: "Office",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_OFFICE_PATH,
    sha256: "5069fcaa967ee945995d2ff84bd05667a8a32ea909f064c175f469101dd84247",
    familyCount: 7,
    top3: ["B0GVZ3CWK1", "B0G8SFR7DH", "B0GLD9K9LF"],
  },
  {
    name: "Auto",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_AUTO_PATH,
    sha256: "8cf6007874c1eb778f8ef389c556e1b93c43e2fe0d78ab530650596856ccf742",
    familyCount: 9,
    top3: ["B0GHY6D5B2", "B0GXJM1Q2K", "B0H7W11LTY"],
  },
] as const;

describe("SellerSprite Category Current route official samples", () => {
  for (const sample of categorySamples) {
    const categoryIt = sample.path ? it : it.skip;
    categoryIt(`${sample.name} returns a Category Current ViewModel`, async () => {
      const bytes = readFileSync(sample.path!);
      const form = new FormData();
      form.append(
        "file",
        new File([asArrayBuffer(bytes)], basename(sample.path!), {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      form.append("reportType", "category_current");
      form.append("category", `${sample.name} Category`);
      form.append("priceMin", "20");
      form.append("priceMax", "100");
      const response = await POST(new NextRequest(
        "http://localhost:3407/api/opportunities/sellersprite-preview",
        {
          method: "POST",
          headers: { origin: "http://localhost:3407" },
          body: form,
        },
      ));
      const payload = await response.json() as {
        ok: boolean;
        data: Record<string, unknown> & {
          products: Array<{ promotionEligible: boolean }>;
          ranking: {
            modelVersion: string;
            reportType: string;
            rankableProductCount: number;
            searchPlacementStatus: string;
            products: Array<{
              asin: string;
              scoreRank: number | null;
              signalScore: number | null;
              conditionalSignalScore: number | null;
              evidenceCoverage: number;
              promotionEligible: boolean;
              componentScores: Array<{ component: string }>;
            }>;
          };
        };
      };
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.data).toMatchObject({
        reportType: "category_current",
        sourceFileSha256: sample.sha256,
        headerColumnCount: 72,
        totalRows: 10,
        acceptedRows: 10,
        rejectedRows: 0,
        query: null,
        occurrenceCount: 10,
        appearanceCount: null,
        productCount: 10,
        familyCount: sample.familyCount,
        uniqueAsinCount: 10,
        placementSummary: { status: "not_applicable" },
        sponsoredAppearanceCount: null,
        organicAppearanceCount: null,
        unknownAppearanceCount: null,
        authoritative: false,
        promotionAllowed: false,
        currentStage1Invoked: false,
        productionEffect: false,
        productionDatabaseWritten: false,
        manifestRegistered: false,
        ranking: {
          modelVersion: "sellersprite-market-signal-ranking.category.v2",
          reportType: "category_current",
          rankableProductCount: 10,
          searchPlacementStatus: "not_applicable",
        },
      });
      expect(payload.data.products.every((product) => product.promotionEligible === false))
        .toBe(true);
      expect(payload.data.ranking.products
        .filter((product) => product.scoreRank !== null)
        .slice(0, 3)
        .map((product) => product.asin)).toEqual(sample.top3);
      expect(payload.data.ranking.products.every((product) => (
        product.evidenceCoverage === 1
        && product.conditionalSignalScore === product.signalScore
        && product.promotionEligible === false
        && product.componentScores.some((component) => component.component === "categoryBsrSignal")
        && product.componentScores.every((component) => (
          component.component !== "organicVisibility"
          && component.component !== "sponsoredExposure"
          && component.component !== "placementCoverage"
        ))
      ))).toBe(true);
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(sample.path!);
      expect(payload.data.ranking.products.every((product) => (
        !("advance" in product)
        && !("watch" in product)
        && !("reject" in product)
      ))).toBe(true);
    });
  }
});
