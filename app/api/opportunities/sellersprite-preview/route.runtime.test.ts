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
    });
    expect(payload.data.sourceFileSha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(payload.data.productWeightedStatistics.price.median).toBe(78);
    expect(payload.data.productWeightedStatistics.estimatedMonthlySales.median).toBe(4449);
    expect(payload.data.products.find((product) => product.asin === "B082PJPQ1Y"))
      .toMatchObject({ appearanceCount: 2, promotionEligible: false });
    expect(payload.data.products.every((product) => product.promotionEligible === false)).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(officialSamplePath!);
  });
});
