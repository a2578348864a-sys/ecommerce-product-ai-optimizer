import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SELLERSPRITE_SANITIZED_ROWS,
  SELLERSPRITE_SEARCH_EXPORT_HEADERS,
} from "@/lib/upstream/sellersprite/fixtures/search-export.sanitized.v1";
import {
  SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
  SELLERSPRITE_CATEGORY_CURRENT_ROWS,
} from "@/lib/upstream/sellersprite/fixtures/category-current.sanitized.v1";
import * as rankingModule from "@/lib/upstream/sellersprite/marketSignalRanking";
import { createSellerSpritePreviewTestWorkbook } from "@/tools/upstream/sellersprite-preview/test-fixtures";

const { ownerGuardMock } = vi.hoisted(() => ({
  ownerGuardMock: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireOwnerOnly: ownerGuardMock,
}));

import {
  SELLERSPRITE_PREVIEW_MAX_FILE_BYTES,
  SELLERSPRITE_PREVIEW_MAX_REQUEST_BYTES,
} from "@/lib/sellerSpriteOpportunityPreview";
import {
  GET,
  POST,
} from "./route";

const ROUTE_URL = "http://localhost:3407/api/opportunities/sellersprite-preview";
const ORIGIN = "http://localhost:3407";

type FormOptions = {
  bytes?: Uint8Array;
  fileName?: string;
  fileCount?: number;
  query?: string | null;
  category?: string | null;
  priceMin?: string | null;
  priceMax?: string | null;
  origin?: string | null;
  referer?: string;
  fetchSite?: string;
  host?: string;
  contentLength?: number;
  reportType?: string | null;
  clientComputedFields?: Readonly<Record<string, string>>;
};

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function requestWithForm(options: FormOptions = {}): NextRequest {
  const form = new FormData();
  const bytes = options.bytes ?? createSellerSpritePreviewTestWorkbook();
  const fileCount = options.fileCount ?? 1;
  for (let index = 0; index < fileCount; index += 1) {
    form.append(
      "file",
      new File([asArrayBuffer(bytes)], options.fileName ?? `sample-${index + 1}.xlsx`, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
  }
  if (options.reportType !== null) {
    form.append("reportType", options.reportType ?? "search_results");
  }
  if (options.query !== null) form.append("query", options.query ?? "storage box");
  if (options.category !== null) form.append("category", options.category ?? "Home & Kitchen");
  if (options.priceMin !== null) form.append("priceMin", options.priceMin ?? "10");
  if (options.priceMax !== null) form.append("priceMax", options.priceMax ?? "100");
  for (const [field, value] of Object.entries(options.clientComputedFields ?? {})) {
    form.append(field, value);
  }
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  if (options.referer !== undefined) headers.set("referer", options.referer);
  if (options.fetchSite !== undefined) headers.set("sec-fetch-site", options.fetchSite);
  if (options.host !== undefined) headers.set("host", options.host);
  if (options.contentLength !== undefined) {
    headers.set("content-length", String(options.contentLength));
  }
  return new NextRequest(ROUTE_URL, { method: "POST", headers, body: form });
}

async function json(response: Response) {
  return await response.json() as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
}

function invalidCurrencyRow(row: Readonly<Record<string, string>>) {
  const priceHeader = Object.keys(row).find((header) => row[header] === "$22.99")
    ?? Object.keys(row).find((header) => row[header] === "$24.99");
  if (!priceHeader) throw new Error("sanitized fixture price header missing");
  return { ...row, [priceHeader]: "$24.99€" };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  ownerGuardMock.mockReturnValue({ ok: true, context: { mode: "owner" } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("SellerSprite preview access and request gates", () => {
  it("is disabled before authorization checks in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(requestWithForm());
    expect(response.status).toBe(404);
    expect((await json(response)).error?.code).toBe("not_found");
    expect(ownerGuardMock).not.toHaveBeenCalled();
  });

  it("allows an Owner to probe local availability", async () => {
    const response = await GET(new NextRequest(ROUTE_URL));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      ok: true,
      data: {
        available: true,
        ownerOnly: true,
        productionEffect: false,
        productionDatabaseWritten: false,
      },
    });
  });

  it("rejects Visitor availability probes before exposing capability details", async () => {
    ownerGuardMock.mockReturnValue({
      ok: false,
      status: 403,
      code: "demo_action_forbidden",
      message: "visitor",
    });
    const response = await GET(new NextRequest(ROUTE_URL));
    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({
      ok: false,
      error: { code: "owner_required" },
    });
  });

  it.each([
    [{ ok: false, status: 401, code: "invalid_access", message: "login" }, 401],
    [{ ok: false, status: 403, code: "demo_action_forbidden", message: "visitor" }, 403],
  ])("rejects unauthenticated and Visitor access", async (guardResult, status) => {
    ownerGuardMock.mockReturnValue(guardResult);
    const response = await POST(requestWithForm());
    expect(response.status).toBe(status);
    expect((await json(response)).error?.code).toBe("owner_required");
  });

  it.each([null, "http://evil.example"])("fails closed for missing or cross-origin POSTs", async (origin) => {
    const response = await POST(requestWithForm({ origin }));
    expect(response.status).toBe(403);
    expect((await json(response)).error?.code).toBe("origin_not_allowed");
  });

  it("accepts the browser fallback only with a same-origin Referer", async () => {
    const response = await POST(requestWithForm({
      origin: null,
      referer: `${ORIGIN}/opportunities/sellersprite-preview`,
      fetchSite: "same-origin",
    }));
    expect(response.status).toBe(200);
  });

  it("uses the browser Host when Next.js normalizes request.url to localhost", async () => {
    const response = await POST(requestWithForm({
      origin: null,
      host: "127.0.0.1:3407",
      referer: "http://127.0.0.1:3407/opportunities/sellersprite-preview",
      fetchSite: "same-origin",
    }));
    expect(response.status).toBe(200);
  });

  it.each([
    ["http://evil.example/form", "cross-site"],
    [`${ORIGIN}/opportunities/sellersprite-preview`, "cross-site"],
  ])("rejects cross-origin or cross-site Referer fallback", async (referer, fetchSite) => {
    const response = await POST(requestWithForm({ origin: null, referer, fetchSite }));
    expect(response.status).toBe(403);
    expect((await json(response)).error?.code).toBe("origin_not_allowed");
  });

  it("rejects an oversized request before parsing multipart data", async () => {
    const response = await POST(requestWithForm({
      contentLength: SELLERSPRITE_PREVIEW_MAX_REQUEST_BYTES + 1,
    }));
    expect(response.status).toBe(413);
    expect((await json(response)).error?.code).toBe("file_too_large");
  });
});

describe("SellerSprite preview upload and brief validation", () => {
  it.each([
    "rankingHash",
    "snapshot",
    "signalScore",
  ])("rejects client-computed ranking input: %s", async (field) => {
    const response = await POST(requestWithForm({
      clientComputedFields: { [field]: "client-controlled" },
    }));
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({
      code: "client_computed_ranking_not_allowed",
    });
  });

  it("requires a supported explicit reportType and rejects Category query input", async () => {
    const missing = await POST(requestWithForm({ reportType: null }));
    expect(missing.status).toBe(400);
    expect((await json(missing)).error?.code).toBe("report_type_required");

    const unsupported = await POST(requestWithForm({ reportType: "future_report" }));
    expect(unsupported.status).toBe(400);
    expect((await json(unsupported)).error?.code).toBe("unsupported_report_type");

    const queryNotApplicable = await POST(requestWithForm({
      reportType: "category_current",
      query: "must not be accepted",
      bytes: createSellerSpritePreviewTestWorkbook({
        headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
        rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
      }),
    }));
    expect(queryNotApplicable.status).toBe(400);
    expect((await json(queryNotApplicable)).error?.code).toBe("query_not_applicable");
  });

  it("fails closed when selected and detected report types differ", async () => {
    const response = await POST(requestWithForm({
      reportType: "category_current",
      query: null,
    }));
    expect(response.status).toBe(422);
    expect((await json(response)).error).toMatchObject({
      code: "report_type_mismatch",
      message: "所选报表类型与文件结构不一致，请确认文件来源。",
    });
  });
  it("rejects missing and multiple files", async () => {
    const missing = await POST(requestWithForm({ fileCount: 0 }));
    expect(missing.status).toBe(400);
    expect((await json(missing)).error?.code).toBe("missing_file");

    const multiple = await POST(requestWithForm({ fileCount: 2 }));
    expect(multiple.status).toBe(400);
    expect((await json(multiple)).error?.code).toBe("unsupported_file_extension");
  });

  it("rejects requests that are not multipart form data", async () => {
    const response = await POST(new NextRequest(ROUTE_URL, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: "{}",
    }));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe("missing_file");
  });

  it.each(["sample.xls", "sample.csv", "folder/sample.xlsx", "folder\\sample.xlsx"])(
    "rejects unsupported or path-bearing file names: %s",
    async (fileName) => {
      const response = await POST(requestWithForm({ fileName }));
      expect(response.status).toBe(400);
      expect((await json(response)).error?.code).toBe("unsupported_file_extension");
    },
  );

  it("rejects empty and oversized file bodies", async () => {
    const empty = await POST(requestWithForm({ bytes: new Uint8Array() }));
    expect(empty.status).toBe(422);
    expect((await json(empty)).error?.code).toBe("invalid_workbook");

    const oversized = await POST(requestWithForm({
      bytes: new Uint8Array(SELLERSPRITE_PREVIEW_MAX_FILE_BYTES + 1),
    }));
    expect(oversized.status).toBe(413);
    expect((await json(oversized)).error?.code).toBe("file_too_large");
  });

  it("rejects fake and malformed XLSX bodies without leaking parser details", async () => {
    const fake = await POST(requestWithForm({ bytes: new TextEncoder().encode("not a zip") }));
    expect(fake.status).toBe(422);
    expect(await json(fake)).toMatchObject({
      error: { code: "unsafe_xlsx", message: "XLSX 文件未通过安全检查。" },
    });

    const malformed = await POST(requestWithForm({
      bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
    }));
    expect(malformed.status).toBe(422);
    expect((await json(malformed)).error?.code).toBe("unsafe_xlsx");
  });

  it.each([
    [{ query: "" }, "brief_validation_failed"],
    [{ category: "" }, "brief_validation_failed"],
    [{ priceMin: "-1" }, "brief_validation_failed"],
    [{ priceMin: "100", priceMax: "10" }, "brief_validation_failed"],
    [{ priceMax: "not-a-number" }, "brief_validation_failed"],
  ] as const)("rejects invalid Selection Brief values", async (options, code) => {
    const response = await POST(requestWithForm(options));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe(code);
  });

  it("distinguishes unsupported sheets and structurally invalid workbooks", async () => {
    const unsupported = await POST(requestWithForm({
      bytes: createSellerSpritePreviewTestWorkbook({
        headers: ["Unrelated"],
        rows: [{ Unrelated: "value" }],
      }),
    }));
    expect(unsupported.status).toBe(422);
    expect((await json(unsupported)).error?.code).toBe("unsupported_sheet");

    const titleHeader = SELLERSPRITE_SEARCH_EXPORT_HEADERS.find(
      (header) => SELLERSPRITE_SANITIZED_ROWS[0][header] === "Sanitized Storage Product - Parent",
    );
    if (!titleHeader) throw new Error("sanitized fixture title header missing");
    const structural = await POST(requestWithForm({
      bytes: createSellerSpritePreviewTestWorkbook({
        headers: SELLERSPRITE_SEARCH_EXPORT_HEADERS.filter((header) => header !== titleHeader),
      }),
    }));
    expect(structural.status).toBe(422);
    expect((await json(structural)).error?.code).toBe("unsupported_report_type");
  });

  it("rejects a workbook with zero accepted rows", async () => {
    const rejectedRow = invalidCurrencyRow(SELLERSPRITE_SANITIZED_ROWS[1]);
    const response = await POST(requestWithForm({
      bytes: createSellerSpritePreviewTestWorkbook({ rows: [rejectedRow] }),
    }));
    expect(response.status).toBe(422);
    expect((await json(response)).error?.code).toBe("no_accepted_rows");
  });
});

describe("SellerSprite preview allowlisted response", () => {
  it("fails closed without leaking internals when server-built ranking integrity fails", async () => {
    const originalRank = rankingModule.rankSellerSpriteMarketSignals;
    const rankSpy = vi.spyOn(rankingModule, "rankSellerSpriteMarketSignals")
      .mockImplementation((input) => ({
        ...originalRank(input),
        normalizedBusinessHash: "0".repeat(64),
      }));
    const response = await POST(requestWithForm());
    rankSpy.mockRestore();
    expect(response.status).toBe(500);
    const payload = await json(response);
    expect(payload.error).toMatchObject({
      code: "ranking_integrity_failed",
      message: "市场排序结果未通过服务端完整性检查。",
    });
    expect(JSON.stringify(payload)).not.toContain("SELLERSPRITE_");
    expect(JSON.stringify(payload)).not.toContain("normalizedBusinessHash");
  });

  it("returns a Category Current ViewModel without Search placement fields", async () => {
    const response = await POST(requestWithForm({
      reportType: "category_current",
      query: null,
      bytes: createSellerSpritePreviewTestWorkbook({
        headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
        rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
      }),
    }));
    expect(response.status).toBe(200);
    const payload = await json(response);
    expect(payload.data).toMatchObject({
      schemaVersion: "sellersprite-opportunity-preview.v2",
      reportType: "category_current",
      query: null,
      occurrenceCount: 2,
      appearanceCount: null,
      duplicateAppearanceGroupCount: null,
      placementSummary: { status: "not_applicable" },
      productCount: 2,
      familyCount: 1,
      categoryBsrSummary: {
        rootCategoryBsr: { validCount: 2 },
        subCategoryBsr: { validCount: 2 },
      },
      ranking: {
        schemaVersion: "sellersprite-market-signal-ranking.v2",
        modelVersion: "sellersprite-market-signal-ranking.category.v2",
        reportType: "category_current",
        searchPlacementStatus: "not_applicable",
      },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("extraRaw");
    expect(serialized).not.toContain("organicVisibility");
    expect(serialized).not.toContain("sponsoredExposure");
    expect(serialized).not.toContain("placementCoverage");
  });
  it("returns a complete non-authoritative ViewModel without raw workbook data", async () => {
    const response = await POST(requestWithForm());
    expect(response.status).toBe(200);
    const payload = await json(response);
    expect(payload).toMatchObject({
      ok: true,
      data: {
        schemaVersion: "sellersprite-opportunity-preview.v2",
        reportStatus: "complete",
        sourceFileName: "sample-1.xlsx",
        source: "SellerSprite",
        sourceType: "provider_metric",
        authoritative: false,
        promotionAllowed: false,
        hardGateEvaluable: false,
        currentStage1Invoked: false,
        productionEffect: false,
        productionDatabaseWritten: false,
        manifestRegistered: false,
        marketplace: "amazon.com",
        market: "US",
        currency: "USD",
        totalRows: 2,
        acceptedRows: 2,
        rejectedRows: 0,
        appearanceCount: 2,
        productCount: 2,
        familyCount: 1,
        ranking: {
          schemaVersion: "sellersprite-market-signal-ranking.v2",
          modelVersion: "sellersprite-market-signal-ranking.search.v2",
          reportType: "search_results",
          productCount: 2,
          safety: {
            authoritative: false,
            currentStage1Invoked: false,
            hardGateEvaluable: false,
            promotionEligible: false,
            manifestRegistered: false,
            productionEffect: false,
            productionDatabaseWritten: false,
          },
        },
      },
    });
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      "extraRaw",
      "rawText",
      "provisionalNumericScore",
      "provisionalDistribution",
      "formalDistribution",
      "stage1Result",
      "C:\\",
      "/Users/",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("accepts a case-insensitive XLSX extension while preserving only the basename", async () => {
    const response = await POST(requestWithForm({ fileName: "Official-Export.XLSX" }));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      data: { sourceFileName: "Official-Export.XLSX" },
    });
  });

  it("publishes a partial preview when at least one row remains accepted", async () => {
    const rejectedRow = invalidCurrencyRow(SELLERSPRITE_SANITIZED_ROWS[1]);
    const response = await POST(requestWithForm({
      bytes: createSellerSpritePreviewTestWorkbook({
        rows: [SELLERSPRITE_SANITIZED_ROWS[0], rejectedRow],
      }),
    }));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      data: {
        reportStatus: "partial",
        totalRows: 2,
        acceptedRows: 1,
        rejectedRows: 1,
      },
    });
  });

  it("keeps missing Brands and invalid Sellers explicit without blocking the US sheet", async () => {
    const missingBrands = await POST(requestWithForm({
      bytes: createSellerSpritePreviewTestWorkbook({ includeBrands: false }),
    }));
    expect(missingBrands.status).toBe(200);
    expect(await json(missingBrands)).toMatchObject({
      data: { brandConcentration: { status: "missing" } },
    });

    const invalidSellers = await POST(requestWithForm({
      bytes: createSellerSpritePreviewTestWorkbook({
        sellersHeaders: ["卖家", "Seller", "市场份额"],
      }),
    }));
    expect(invalidSellers.status).toBe(200);
    expect(await json(invalidSellers)).toMatchObject({
      data: { sellerConcentration: { status: "invalid" } },
    });
  });

  it("keeps every product non-authoritative and promotion-ineligible", async () => {
    const payload = await json(await POST(requestWithForm()));
    const products = payload.data?.products as Array<Record<string, unknown>>;
    expect(products).toHaveLength(2);
    expect(products.every((product) => (
      product.authoritative === false
      && product.promotionEligible === false
      && product.productionEffect === false
      && product.productionDatabaseWritten === false
      && product.manifestRegistered === false
      && !("provisionalNumericScore" in product)
    ))).toBe(true);
  });
});
