import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSellerSpritePreviewImportToken } from "@/lib/server/sellerSpritePreviewImportToken";
import {
  SELLERSPRITE_PLUGIN_PARSER_CONTRACT_VERSION,
  SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256,
  SELLERSPRITE_PLUGIN_WARNING_COUNT,
  mapPluginRowToSellerSpriteImportRow,
  sellerSpritePluginAcceptedRowsDigest,
  sellerSpritePluginWarningDigest,
  validateSellerSpritePluginRows,
} from "@/lib/server/sellerSpritePluginContract";

const auth = vi.hoisted(() => vi.fn());
const importCandidates = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: auth,
}));
vi.mock("@/lib/server/sellerSpriteCandidateImport", () => ({
  importSellerSpriteCandidates: importCandidates,
}));

import { POST } from "./route";

const expectedOrigin = "http://localhost:3105";
const ROUTE_URL = `${expectedOrigin}/api/opportunities/sellersprite-plugin-import`;

function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asin: "B0TEST0001",
    title: "HydroJug Travel Tumbler 40oz",
    productUrl: "https://www.amazon.com/dp/B0TEST0001",
    parentAsin: "B0PARENT01",
    brand: "HydroJug",
    category: "Home & Kitchen",
    priceUsd: 39.99,
    rating: 4.6,
    reviewCount: 1234,
    bsr: 120,
    estimatedMonthlySales: 5600,
    estimatedMonthlyRevenueUsd: 223944,
    variationCount: 4,
    reviewRate: 12.5,
    grossMargin: 35.2,
    listingDate: "2023-05-01",
    sellerCount: 2,
    fulfillment: "FBA",
    ...overrides,
  };
}

function buildRequest(
  body: unknown,
  options: { origin?: string | null; contentType?: string | null } = {},
): NextRequest {
  const headers = new Headers({ "x-client-role": "owner" });
  headers.set("host", new URL(expectedOrigin).host);
  if (options.origin === null) {
    // no Origin header
  } else {
    headers.set("origin", options.origin ?? expectedOrigin);
  }
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  return new NextRequest(ROUTE_URL, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function previewBody(rows: unknown = [validRow()]): Record<string, unknown> {
  return { stage: "preview", rows, capturedAt: "2026-08-20T08:30:00.000Z" };
}

function authenticated(mode: "owner" | "demo", id = "visitor-a"): void {
  auth.mockReturnValue({
    ok: true,
    context: mode === "owner" ? { mode } : { mode, demoAccessId: id },
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function errorCode(response: Response): Promise<string> {
  const body = await json(response);
  const error = body.error as Record<string, unknown> | undefined;
  return typeof error?.code === "string" ? error.code : "";
}

describe("POST /api/opportunities/sellersprite-plugin-import", () => {
  beforeEach(() => {
    auth.mockReset();
    importCandidates.mockReset();
    vi.stubEnv("ACCESS_PASSWORD", "route-test-access-password");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    authenticated("owner");
    importCandidates.mockResolvedValue({ created: [{ rowHash: "a".repeat(64), candidateId: "c1" }], skipped: [], conflicts: [] });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("preview stage", () => {
    it("returns a signed preview token + acceptedRows for valid rows", async () => {
      const response = await POST(buildRequest(previewBody()));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await json(response);
      expect(body.ok).toBe(true);
      const preview = body.preview as Record<string, unknown>;
      expect(preview.acceptedRowCount).toBe(1);
      expect(Array.isArray(preview.acceptedRows)).toBe(true);
      expect(preview.parserContractVersion).toBe(SELLERSPRITE_PLUGIN_PARSER_CONTRACT_VERSION);
      expect(preview.warningCount).toBe(0);
      expect(typeof preview.previewToken).toBe("string");
      expect(String(preview.previewToken).startsWith("preview-import-v1.")).toBe(true);
      const accepted = preview.acceptedRows as Array<Record<string, unknown>>;
      expect(accepted[0].asin).toBe("B0TEST0001");
      expect(accepted[0].rowHash).toMatch(/^[a-f0-9]{64}$/);
      expect(importCandidates).not.toHaveBeenCalled();
    });

    it("rejects out-of-whitelist fields with 400 (白名单越权)", async () => {
      const response = await POST(buildRequest(previewBody([validRow({ maliciousField: "x" })])));
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("plugin_unknown_field");
    });

    it("rejects an invalid ASIN with 400", async () => {
      const response = await POST(buildRequest(previewBody([validRow({ asin: "NOT-AN-ASIN" })])));
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("plugin_invalid_asin");
    });

    it("rejects more than 50 rows with 400", async () => {
      const rows = Array.from({ length: 51 }, (_, index) => validRow({
        asin: `B0TEST${String(index).padStart(4, "0")}`,
        productUrl: `https://www.amazon.com/dp/B0TEST${String(index).padStart(4, "0")}`,
      }));
      const response = await POST(buildRequest(previewBody(rows)));
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("plugin_rows_too_many");
    });

    it("rejects duplicate ASINs in one request before any write", async () => {
      const dup = [validRow(), validRow({ productUrl: "https://www.amazon.com/dp/B0TEST0001" })];
      const response = await POST(buildRequest(previewBody(dup)));
      expect(response.status).toBe(422);
      expect(await errorCode(response)).toBe("duplicate_selected_candidate_identity");
      expect(importCandidates).not.toHaveBeenCalled();
    });

    it("rejects a non-JSON content type", async () => {
      const response = await POST(buildRequest(previewBody(), { contentType: "text/plain" }));
      expect(response.status).toBe(415);
      expect(await errorCode(response)).toBe("json_required");
    });

    it("rejects an unauthenticated request", async () => {
      auth.mockReturnValue({ ok: false, status: 401, code: "invalid_access", message: "login required" });
      const response = await POST(buildRequest(previewBody()));
      expect(response.status).toBe(401);
    });

    it("rejects a null Origin", async () => {
      const response = await POST(buildRequest(previewBody(), { origin: "null" }));
      expect(response.status).toBe(403);
    });

    it("rejects an invalid stage", async () => {
      const response = await POST(buildRequest({ stage: "import", rows: [validRow()] }));
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("invalid_stage");
    });

    it("rejects a non-object JSON body", async () => {
      const response = await POST(buildRequest([1, 2, 3]));
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("invalid_json_body");
    });

    it("rejects invalid JSON", async () => {
      const response = await POST(buildRequest("{ not json", { contentType: "application/json" }));
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("invalid_json_body");
    });

    it("rejects an oversized body with 413", async () => {
      const bigRows = [validRow({ title: "x".repeat(300 * 1024) })];
      const response = await POST(buildRequest(previewBody(bigRows)));
      expect(response.status).toBe(413);
      expect(await errorCode(response)).toBe("payload_too_large");
    });

    it("returns no-store on every error response", async () => {
      const response = await POST(buildRequest({ stage: "nope" }));
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
  });

  describe("confirm stage", () => {
    it("imports a valid selection after a real preview", async () => {
      const previewResponse = await POST(buildRequest(previewBody()));
      expect(previewResponse.status).toBe(200);
      const previewBodyJson = await json(previewResponse);
      const preview = previewBodyJson.preview as Record<string, unknown>;
      const accepted = preview.acceptedRows as Array<Record<string, unknown>>;
      const confirm = await POST(buildRequest({
        stage: "confirm",
        rows: [validRow()],
        previewToken: preview.previewToken,
        selectedRowHashes: [accepted[0].rowHash],
        confirmed: true,
        capturedAt: "2026-08-20T08:30:00.000Z",
      }));
      expect(confirm.status).toBe(200);
      expect(confirm.headers.get("cache-control")).toBe("no-store");
      const body = await json(confirm);
      expect(body.ok).toBe(true);
      expect(importCandidates).toHaveBeenCalledTimes(1);
      const call = importCandidates.mock.calls[0][0];
      expect(call.context).toEqual({ mode: "owner" });
      expect(call.rows).toHaveLength(1);
      expect(call.rows[0].asin).toBe("B0TEST0001");
      expect(call.rows[0].rowHash).toBe(accepted[0].rowHash);
      expect(call.sourceFileSha256).toBe(SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256);
      expect(typeof call.importedAt).toBe("string");
    });

    it("rejects a token issued for a different subject", async () => {
      const previewResponse = await POST(buildRequest(previewBody()));
      const preview = (await json(previewResponse)).preview as Record<string, unknown>;
      const accepted = preview.acceptedRows as Array<Record<string, unknown>>;
      const visitorToken = generateSellerSpritePreviewImportToken(
        "visitor:other-visitor",
        SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256,
        String(preview.acceptedRowsDigest),
        Number(preview.acceptedRowCount),
        sellerSpritePluginWarningDigest(),
        SELLERSPRITE_PLUGIN_WARNING_COUNT,
        SELLERSPRITE_PLUGIN_PARSER_CONTRACT_VERSION,
      );
      const confirm = await POST(buildRequest({
        stage: "confirm",
        rows: [validRow()],
        previewToken: visitorToken,
        selectedRowHashes: [accepted[0].rowHash],
        confirmed: true,
      }));
      expect(confirm.status).toBe(403);
      expect(await errorCode(confirm)).toBe("preview_token_subject_mismatch");
      expect(importCandidates).not.toHaveBeenCalled();
    });

    it("rejects a selection that is not a subset of accepted rows", async () => {
      const previewResponse = await POST(buildRequest(previewBody()));
      const preview = (await json(previewResponse)).preview as Record<string, unknown>;
      const confirm = await POST(buildRequest({
        stage: "confirm",
        rows: [validRow()],
        previewToken: preview.previewToken,
        selectedRowHashes: ["b".repeat(64)],
        confirmed: true,
      }));
      expect(confirm.status).toBe(422);
      expect(await errorCode(confirm)).toBe("selected_rows_not_subset");
      expect(importCandidates).not.toHaveBeenCalled();
    });

    it("rejects when confirmed is not true", async () => {
      const previewResponse = await POST(buildRequest(previewBody()));
      const preview = (await json(previewResponse)).preview as Record<string, unknown>;
      const accepted = preview.acceptedRows as Array<Record<string, unknown>>;
      const confirm = await POST(buildRequest({
        stage: "confirm",
        rows: [validRow()],
        previewToken: preview.previewToken,
        selectedRowHashes: [accepted[0].rowHash],
        confirmed: false,
      }));
      expect(confirm.status).toBe(422);
      expect(await errorCode(confirm)).toBe("confirmation_required");
      expect(importCandidates).not.toHaveBeenCalled();
    });

    it("rejects rows that no longer match the preview digest (tampered)", async () => {
      const previewResponse = await POST(buildRequest(previewBody()));
      const preview = (await json(previewResponse)).preview as Record<string, unknown>;
      const accepted = preview.acceptedRows as Array<Record<string, unknown>>;
      const confirm = await POST(buildRequest({
        stage: "confirm",
        rows: [validRow({ title: "Tampered Title" })],
        previewToken: preview.previewToken,
        selectedRowHashes: [accepted[0].rowHash],
        confirmed: true,
      }));
      expect(confirm.status).toBe(422);
      expect(await errorCode(confirm)).toBe("preview_token_rows_mismatch");
      expect(importCandidates).not.toHaveBeenCalled();
    });

    it("rejects an invalid selectedRowHashes value", async () => {
      const previewResponse = await POST(buildRequest(previewBody()));
      const preview = (await json(previewResponse)).preview as Record<string, unknown>;
      const confirm = await POST(buildRequest({
        stage: "confirm",
        rows: [validRow()],
        previewToken: preview.previewToken,
        selectedRowHashes: "not-an-array",
        confirmed: true,
      }));
      expect(confirm.status).toBe(400);
      expect(await errorCode(confirm)).toBe("invalid_selected_rows");
    });

    it("rejects a malformed preview token", async () => {
      const confirm = await POST(buildRequest({
        stage: "confirm",
        rows: [validRow()],
        previewToken: "not-a-token",
        selectedRowHashes: ["a".repeat(64)],
        confirmed: true,
      }));
      expect(confirm.status).toBe(400);
      expect(await errorCode(confirm)).toBe("malformed_preview_token");
      expect(importCandidates).not.toHaveBeenCalled();
    });

    it("rejects a token bound to a different sourceFileSha256", async () => {
      const validated = validateSellerSpritePluginRows([validRow()]);
      if (!validated.ok) throw new Error("fixture invalid");
      const importRows = validated.rows.map((row, index) => mapPluginRowToSellerSpriteImportRow(row, index, null));
      const foreignToken = generateSellerSpritePreviewImportToken(
        "owner",
        "e".repeat(64),
        sellerSpritePluginAcceptedRowsDigest(importRows),
        importRows.length,
        sellerSpritePluginWarningDigest(),
        SELLERSPRITE_PLUGIN_WARNING_COUNT,
        SELLERSPRITE_PLUGIN_PARSER_CONTRACT_VERSION,
      );
      const confirm = await POST(buildRequest({
        stage: "confirm",
        rows: [validRow()],
        previewToken: foreignToken,
        selectedRowHashes: [importRows[0].rowHash],
        confirmed: true,
      }));
      expect(confirm.status).toBe(422);
      expect(await errorCode(confirm)).toBe("preview_token_file_mismatch");
      expect(importCandidates).not.toHaveBeenCalled();
    });

    it("never imports on any validation failure", async () => {
      // unknown field in confirm
      const response = await POST(buildRequest({ stage: "confirm", rows: [validRow({ hack: 1 })], previewToken: "x", selectedRowHashes: [], confirmed: true }));
      expect(response.status).toBe(400);
      expect(importCandidates).not.toHaveBeenCalled();
    });
  });
});
