import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSellerSpritePreviewWorkbook } from "@/lib/upstream/sellersprite/previewTestFixtures";
import { precheckSellerSpritePreview } from "@/lib/upstream/sellersprite/preview";
import { generateSellerSpritePreviewImportToken } from "@/lib/server/sellerSpritePreviewImportToken";

const auth = vi.hoisted(() => vi.fn());
const importCandidates = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: auth,
}));
vi.mock("@/lib/server/sellerSpriteCandidateImport", () => ({
  importSellerSpriteCandidates: importCandidates,
}));

import { POST } from "./route";

const headers = ["ASIN", "商品标题", "商品详情页链接"];
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const expectedOrigin = "http://localhost:3105";

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function makeWorkbook(rows: Array<Array<string | null>>) {
  return createSellerSpritePreviewWorkbook({ headers, rows, sheetName: "US" });
}

function validPreview(source: Uint8Array) {
  return precheckSellerSpritePreview(source);
}

function issueToken(preview: ReturnType<typeof validPreview>, subject = "owner", overrides: {
  sourceFileSha256?: string;
  acceptedRowsDigest?: string;
  acceptedRowCount?: number;
  warningDigest?: string;
  warningCount?: number;
  parserContractVersion?: string;
} = {}) {
  return generateSellerSpritePreviewImportToken(
    subject,
    overrides.sourceFileSha256 ?? preview.source.sourceFileSha256,
    overrides.acceptedRowsDigest ?? preview.acceptedRowsDigest!,
    overrides.acceptedRowCount ?? preview.acceptedRowCount,
    overrides.warningDigest ?? preview.warningDigest!,
    overrides.warningCount ?? preview.warnings.length,
    overrides.parserContractVersion ?? preview.parserContractVersion!,
  );
}

function standardWorkbook(): Uint8Array {
  return makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]);
}

function buildRequest(
  options: {
    file?: Uint8Array;
    previewToken?: string;
    selectedRowHashesJson?: string;
    confirmed?: string;
    warningsAccepted?: string;
    origin?: string | null;
    extraFields?: Record<string, string>;
    filename?: string;
    mimeType?: string;
    contentLength?: number | null;
  } = {},
): NextRequest {
  const file = options.file ?? standardWorkbook();
  const form = new FormData();
  form.set("file", new File([asArrayBuffer(file)], options.filename ?? "seller-sprite.xlsx", {
    type: options.mimeType ?? XLSX_MIME,
  }));
  if (options.previewToken !== undefined) form.set("previewToken", options.previewToken);
  if (options.selectedRowHashesJson !== undefined) form.set("selectedRowHashesJson", options.selectedRowHashesJson);
  if (options.confirmed !== undefined) form.set("confirmed", options.confirmed);
  if (options.warningsAccepted !== undefined) form.set("warningsAccepted", options.warningsAccepted);
  for (const [key, value] of Object.entries(options.extraFields ?? {})) form.set(key, value);

  const requestHeaders = new Headers({ "x-client-role": "owner" });
  requestHeaders.set("host", new URL(expectedOrigin).host);
  if (options.origin === null) {
    // no Origin header
  } else {
    requestHeaders.set("origin", options.origin ?? expectedOrigin);
  }
  if (options.contentLength !== null) {
    requestHeaders.set("content-length", String(options.contentLength ?? file.length + 512));
  }
  return new NextRequest(`${expectedOrigin}/api/opportunities/sellersprite-import`, {
    method: "POST",
    headers: requestHeaders,
    body: form,
  });
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

describe("POST /api/opportunities/sellersprite-import", () => {
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

  it("imports a valid single-row selection", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview);
    const selected = JSON.stringify([preview.acceptedRows[0].rowHash!]);
    const response = await POST(buildRequest({ previewToken: token, selectedRowHashesJson: selected, confirmed: "true", warningsAccepted: "false" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await json(response);
    expect(body.ok).toBe(true);
    expect(importCandidates).toHaveBeenCalledTimes(1);
  });

  it("rejects when the file field is missing", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const form = new FormData();
    form.set("previewToken", issueToken(preview));
    form.set("selectedRowHashesJson", JSON.stringify([preview.acceptedRows[0].rowHash!]));
    form.set("confirmed", "true");
    form.set("warningsAccepted", "false");
    const requestHeaders = new Headers();
    requestHeaders.set("host", new URL(expectedOrigin).host);
    requestHeaders.set("origin", expectedOrigin);
    requestHeaders.set("content-length", "100");
    const response = await POST(new NextRequest(`${expectedOrigin}/api/opportunities/sellersprite-import`, {
      method: "POST", headers: requestHeaders, body: form,
    }));
    expect(response.status).toBe(400);
    expect(importCandidates).not.toHaveBeenCalled();
  });

  it("rejects a duplicate file field", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview);
    const selected = JSON.stringify([preview.acceptedRows[0].rowHash!]);
    const file = standardWorkbook();
    const form = new FormData();
    form.append("file", new File([asArrayBuffer(file)], "a.xlsx", { type: XLSX_MIME }));
    form.append("file", new File([asArrayBuffer(file)], "b.xlsx", { type: XLSX_MIME }));
    form.set("previewToken", token);
    form.set("selectedRowHashesJson", selected);
    form.set("confirmed", "true");
    form.set("warningsAccepted", "false");
    const requestHeaders = new Headers();
    requestHeaders.set("host", new URL(expectedOrigin).host);
    requestHeaders.set("origin", expectedOrigin);
    requestHeaders.set("content-length", "100");
    const response = await POST(new NextRequest(`${expectedOrigin}/api/opportunities/sellersprite-import`, {
      method: "POST", headers: requestHeaders, body: form,
    }));
    expect(response.status).toBe(400);
    expect(importCandidates).not.toHaveBeenCalled();
  });

  it("rejects a non-XLSX file type", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
      filename: "file.csv",
      mimeType: "text/csv",
    }));
    expect(response.status).toBe(415);
  });

  it("rejects an oversized file", async () => {
    const file = standardWorkbook();
    const preview = validPreview(file);
    const response = await POST(buildRequest({
      file,
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
      contentLength: file.length + 9 * 1024 * 1024,
    }));
    expect(response.status).toBe(413);
  });

  it("rejects a missing previewToken", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: undefined,
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(400);
  });

  it("rejects a malformed token", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: "not-a-valid-token",
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("malformed_preview_token");
  });

  it("rejects a token with a broken signature", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview);
    const parts = token.split(".");
    const sig = Buffer.from(parts[2], "base64url");
    sig[0] ^= 0x01;
    const broken = `${parts[0]}.${parts[1]}.${sig.toString("base64url")}`;
    const response = await POST(buildRequest({
      previewToken: broken,
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("invalid_preview_token_signature");
  });

  it("rejects a token issued for a different subject", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview, "visitor:other-visitor");
    const response = await POST(buildRequest({
      previewToken: token,
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("preview_token_subject_mismatch");
  });

  it("rejects an expired token", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 331_000);
    const response = await POST(buildRequest({
      previewToken: token,
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    vi.useRealTimers();
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("preview_token_expired");
  });

  it("rejects a not-yet-valid token", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() - 60_000);
    const response = await POST(buildRequest({
      previewToken: token,
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    vi.useRealTimers();
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("preview_token_not_yet_valid");
  });

  it("rejects a file hash mismatch", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview, "owner", { sourceFileSha256: "e".repeat(64) });
    const response = await POST(buildRequest({
      previewToken: token,
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("preview_token_file_mismatch");
  });

  it("rejects an acceptedRowsDigest mismatch", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview, "owner", { acceptedRowsDigest: "c".repeat(64) });
    const response = await POST(buildRequest({
      previewToken: token,
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("preview_token_rows_mismatch");
  });

  it("rejects an acceptedRowCount mismatch", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview, "owner", { acceptedRowCount: 99 });
    const response = await POST(buildRequest({
      previewToken: token,
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("preview_token_rows_mismatch");
  });

  it("rejects a warningDigest mismatch", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview, "owner", { warningDigest: "d".repeat(64) });
    const response = await POST(buildRequest({
      previewToken: token,
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("preview_token_warning_mismatch");
  });

  it("rejects a warningCount mismatch", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const token = issueToken(preview, "owner", { warningCount: 5 });
    const response = await POST(buildRequest({
      previewToken: token,
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("preview_token_warning_mismatch");
  });

  it("rejects invalid selectedRowHashesJson", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: issueToken(preview),
      selectedRowHashesJson: "not-json",
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_selected_rows");
  });

  it("rejects an empty selection array", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify([]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(400);
  });

  it("rejects a non-array selection value", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify({ rowHash: "x" }),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(400);
  });

  it("rejects more than 20 selected rows", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const tooMany = Array.from({ length: 21 }, () => "a".repeat(64));
    const response = await POST(buildRequest({
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify(tooMany),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(400);
  });

  it("rejects an invalid rowHash entry", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify(["not-a-hash"]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(400);
  });

  it("rejects a duplicate rowHash entry", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const h = preview.acceptedRows[0].rowHash!;
    const response = await POST(buildRequest({
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify([h, h]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(400);
  });

  it("rejects a selection that is not a subset of accepted rows", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify(["b".repeat(64)]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("selected_rows_not_subset");
  });

  it("rejects when confirmed is not the exact string true", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "false",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("confirmation_required");
  });

  it("rejects when warnings exist but are not accepted", async () => {
    const withWarnings = makeWorkbook([
      ["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"],
      ["B0TEST0002", null, "https://www.amazon.com/dp/B0TEST0002"],
    ]);
    const preview = validPreview(withWarnings);
    expect(preview.warnings.length).toBeGreaterThan(0);
    const response = await POST(buildRequest({
      file: withWarnings,
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
    }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("warnings_not_accepted");
  });

  it("rejects duplicate ASINs within one request before any write", async () => {
    const dup = makeWorkbook([
      ["B0DUPP0001", "Product A", "https://www.amazon.com/dp/B0DUPP0001"],
      ["B0DUPP0001", "Product A", "https://www.amazon.com/dp/B0DUPP0001"],
    ]);
    const preview = validPreview(dup);
    expect(preview.blockingErrors).toHaveLength(0);
    const hashes = preview.acceptedRows.map((row) => row.rowHash!);
    expect(hashes).toHaveLength(2);
    const response = await POST(buildRequest({
      file: dup,
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify(hashes),
      confirmed: "true",
      warningsAccepted: "true",
    }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("duplicate_selected_candidate_identity");
    expect(importCandidates).not.toHaveBeenCalled();
  });

  it("rejects a null Origin", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: issueToken(preview),
      selectedRowHashesJson: JSON.stringify([preview.acceptedRows[0].rowHash!]),
      confirmed: "true",
      warningsAccepted: "false",
      origin: "null",
    }));
    expect(response.status).toBe(403);
  });

  it("rejects an unauthenticated request", async () => {
    auth.mockReturnValue({ ok: false, status: 401, code: "invalid_access", message: "login required" });
    const response = await POST(buildRequest());
    expect(response.status).toBe(401);
    expect(importCandidates).not.toHaveBeenCalled();
  });

  it("returns no-store on every error response", async () => {
    const preview = validPreview(makeWorkbook([["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]]));
    const response = await POST(buildRequest({
      previewToken: "bad",
      selectedRowHashesJson: "bad",
      confirmed: "false",
      warningsAccepted: "false",
    }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
