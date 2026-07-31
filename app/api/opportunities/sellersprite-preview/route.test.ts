import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSellerSpritePreviewWorkbook,
  createSellerSpritePreviewWorkbookWithSheets,
} from "@/lib/upstream/sellersprite/previewTestFixtures";

const auth = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: auth,
}));

import { resetSellerSpritePreviewRateLimitForTest } from "@/lib/server/sellerSpritePreviewRateLimit";
import { generateSellerSpritePreviewImportToken } from "@/lib/server/sellerSpritePreviewImportToken";
import { POST } from "./route";

const headers = ["ASIN", "商品标题", "商品详情页链接"];
const source = createSellerSpritePreviewWorkbook({
  headers,
  rows: [["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]],
  extraEntries: [{
    name: "xl/worksheets/_rels/sheet1.xml.rels",
    content: [
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="synthetic-link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://example.com/ignored-route-link"/>',
      "</Relationships>",
    ].join(""),
  }],
});
const expectedOrigin = "http://localhost:3105";
const sameOriginReferer = `${expectedOrigin}/opportunities/sellersprite-preview`;

function authenticated(mode: "owner" | "demo", id = "visitor-a"): void {
  auth.mockReturnValue({
    ok: true,
    context: mode === "owner" ? { mode } : { mode, demoAccessId: id },
  });
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function requestFor(
  file: Uint8Array = source,
  options: {
    origin?: string | null;
    referer?: string | null;
    extraEntries?: Record<string, string>;
    filename?: string;
    mimeType?: string;
    contentLength?: number | null;
    host?: string | null;
  } = {},
): NextRequest {
  const form = new FormData();
  form.set("file", new File([asArrayBuffer(file)], options.filename ?? "seller-sprite.xlsx", {
    type: options.mimeType ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  for (const [key, value] of Object.entries(options.extraEntries ?? {})) form.set(key, value);
  const requestHeaders = new Headers({ "x-client-role": "owner" });
  if (options.host !== null) requestHeaders.set("host", options.host ?? new URL(expectedOrigin).host);
  if (options.origin !== null) requestHeaders.set("origin", options.origin ?? expectedOrigin);
  if (options.referer !== undefined && options.referer !== null) requestHeaders.set("referer", options.referer);
  if (options.contentLength !== null) requestHeaders.set("content-length", String(options.contentLength ?? file.length + 512));
  return new NextRequest(`${expectedOrigin}/api/opportunities/sellersprite-preview`, {
    method: "POST",
    headers: requestHeaders,
    body: form,
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("POST /api/opportunities/sellersprite-preview", () => {
  beforeEach(() => {
    auth.mockReset();
    resetSellerSpritePreviewRateLimitForTest();
    vi.stubEnv("ACCESS_PASSWORD", "test-access-password-for-token-signing");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("allows exact Origin for Owner and Visitor through the same authenticated handler", async () => {
    authenticated("owner");
    const ownerResponse = await POST(requestFor());
    authenticated("demo", "visitor-a");
    const visitorResponse = await POST(requestFor());

    expect(ownerResponse.status).toBe(200);
    expect(visitorResponse.status).toBe(200);
    expect(ownerResponse.headers.get("cache-control")).toBe("no-store");
    const ownerJson = await ownerResponse.json();
    const visitorJson = await visitorResponse.json();
    expect(ownerJson.preview.importToken).toBeDefined();
    expect(visitorJson.preview.importToken).toBeDefined();
    expect(ownerJson.preview.importToken).toMatch(/^preview-import-v1\./);
    expect(visitorJson.preview.importToken).toMatch(/^preview-import-v1\./);
    // Structurally equivalent except importToken (different issuedAt)
    const { importToken: _ot, ...ownerRest } = ownerJson.preview as Record<string, unknown>;
    const { importToken: _vt, ...visitorRest } = visitorJson.preview as Record<string, unknown>;
    expect(visitorRest).toEqual(ownerRest);
  });

  it("allows the exact same-origin Referer fallback for both modes", async () => {
    authenticated("owner");
    const ownerResponse = await POST(requestFor(source, { origin: null, referer: sameOriginReferer }));
    authenticated("demo", "visitor-a");
    const visitorResponse = await POST(requestFor(source, { origin: null, referer: sameOriginReferer }));

    expect(ownerResponse.status).toBe(200);
    expect(visitorResponse.status).toBe(200);
    const ownerJson = await ownerResponse.json();
    const visitorJson = await visitorResponse.json();
    const { importToken: _ot, ...ownerRest } = ownerJson.preview as Record<string, unknown>;
    const { importToken: _vt, ...visitorRest } = visitorJson.preview as Record<string, unknown>;
    expect(visitorRest).toEqual(ownerRest);
  });

  it("uses standard URL origin normalization while retaining exact scheme, host, and port checks", async () => {
    authenticated("owner");
    const response = await POST(requestFor(source, {
      origin: "HTTP://LOCALHOST:3105",
      referer: "HTTP://LOCALHOST:3105/opportunities/sellersprite-preview",
    }));
    expect(response.status).toBe(200);
  });

  it("uses the current direct-request Host authority without treating localhost and 127.0.0.1 as aliases", async () => {
    authenticated("owner");
    const response = await POST(requestFor(source, {
      host: "127.0.0.1:3105",
      origin: "http://127.0.0.1:3105",
      referer: "http://127.0.0.1:3105/opportunities/sellersprite-preview",
    }));
    expect(response.status).toBe(200);

    const rejected = await POST(requestFor(source, {
      host: "127.0.0.1:3105",
      origin: expectedOrigin,
    }));
    expect(rejected.status).toBe(403);
  });

  it.each([
    ["cross-origin Origin despite same-origin Referer", { origin: "https://attacker.test", referer: sameOriginReferer }],
    ["same-origin Origin with cross-origin Referer", { origin: expectedOrigin, referer: "https://attacker.test/preview" }],
    ["both provenance headers missing", { origin: null, referer: null }],
    ["Origin null", { origin: "null" }],
    ["invalid Origin", { origin: "not a URL" }],
    ["Origin URL with a path", { origin: `${expectedOrigin}/unexpected-path` }],
    ["invalid Referer", { origin: null, referer: "not a URL" }],
    ["different scheme", { origin: "https://localhost:3105" }],
    ["different port", { origin: "http://localhost:3106" }],
    ["host suffix deception", { origin: "http://localhost:3105.evil.example" }],
  ])("rejects %s before authentication, multipart parsing, and XLSX decoding", async (_label, options) => {
    authenticated("owner");
    const request = requestFor(source, options);
    const formData = vi.spyOn(request, "formData");
    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(auth).not.toHaveBeenCalled();
    expect(formData).not.toHaveBeenCalled();
  });

  it("does not allow Owner or Visitor to bypass the same-origin rule", async () => {
    authenticated("owner");
    expect((await POST(requestFor(source, { origin: "https://attacker.test" }))).status).toBe(403);
    authenticated("demo", "visitor-a");
    expect((await POST(requestFor(source, { origin: "https://attacker.test" }))).status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated, forged-role, non-XLSX, missing-MIME, and invalid-magic requests", async () => {
    auth.mockReturnValue({ ok: false, status: 401, code: "invalid_access", message: "login required" });
    expect((await POST(requestFor())).status).toBe(401);

    authenticated("demo", "visitor-a");
    expect((await POST(requestFor(source, { extraEntries: { role: "owner" } }))).status).toBe(400);
    expect((await POST(requestFor(source, { filename: "seller-sprite.csv" }))).status).toBe(415);
    expect((await POST(requestFor(source, { mimeType: "application/octet-stream" }))).status).toBe(415);
    expect((await POST(requestFor(new TextEncoder().encode("not a ZIP")))).status).toBe(422);
  });

  it("rejects absent, invalid, oversized, and multi-file multipart requests", async () => {
    authenticated("owner");
    expect((await POST(requestFor(source, { contentLength: null }))).status).toBe(413);
    expect((await POST(requestFor(source, { contentLength: source.length + 9 * 1024 * 1024 }))).status).toBe(413);
    expect((await POST(requestFor(source, { extraEntries: { second: "not-a-file" } }))).status).toBe(400);
  });

  it("returns the same safe unsupported-XLSX reason to Owner and Visitor without leaking parser input", async () => {
    const marker = "synthetic-content-must-not-leak";
    const unsupported = createSellerSpritePreviewWorkbook({
      headers,
      rows: [],
      extraEntries: [{ name: "xl/vbaProject.bin", content: marker }],
    });

    authenticated("owner");
    const ownerResponse = await POST(requestFor(unsupported));
    authenticated("demo", "visitor-a");
    const visitorResponse = await POST(requestFor(unsupported));
    const ownerPayload = await json(ownerResponse);
    const visitorPayload = await json(visitorResponse);

    expect(ownerResponse.status).toBe(422);
    expect(visitorResponse.status).toBe(422);
    expect(ownerResponse.headers.get("cache-control")).toBe("no-store");
    expect(visitorPayload).toEqual(ownerPayload);
    expect(ownerPayload).toEqual({
      ok: false,
      error: {
        code: "unsupported_xlsx_feature",
        reasonCode: "macro_enabled_workbook",
        stage: "ooxml_package",
        message: "该 XLSX 包含当前安全解析器不支持的工作簿特征。",
      },
    });
    const serialized = JSON.stringify(ownerPayload);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain("vbaProject");
    expect(serialized.toLowerCase()).not.toContain("stack");
  });

  it("rejects an insecure hyperlink identically for Owner and Visitor without leaking the target", async () => {
    const marker = "unsafe-link-marker";
    const unsupported = createSellerSpritePreviewWorkbook({
      headers,
      rows: [],
      extraEntries: [{
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        content: [
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
          `<Relationship Id="synthetic-link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="http://example.com/${marker}"/>`,
          "</Relationships>",
        ].join(""),
      }],
    });

    authenticated("owner");
    const ownerResponse = await POST(requestFor(unsupported));
    authenticated("demo", "visitor-a");
    const visitorResponse = await POST(requestFor(unsupported));
    const ownerPayload = await json(ownerResponse);
    const visitorPayload = await json(visitorResponse);

    expect(ownerResponse.status).toBe(422);
    expect(visitorResponse.status).toBe(422);
    expect(visitorPayload).toEqual(ownerPayload);
    expect(ownerPayload).toEqual({
      ok: false,
      error: {
        code: "unsupported_xlsx_feature",
        reasonCode: "insecure_hyperlink_relationship_rejected",
        stage: "ooxml_package",
        message: "该 XLSX 包含当前安全解析器不支持的工作簿特征。",
      },
    });
    expect(JSON.stringify(ownerPayload)).not.toContain(marker);
  });

  it("keeps an unexpected upload-reader exception on the generic safe fallback", async () => {
    const marker = "unexpected-reader-detail-must-not-leak";
    vi.spyOn(File.prototype, "arrayBuffer").mockRejectedValueOnce(new Error(marker));
    authenticated("owner");

    const response = await POST(requestFor());
    const payload = await json(response);

    expect(response.status).toBe(422);
    expect(payload).toEqual({
      ok: false,
      error: {
        code: "invalid_xlsx",
        message: "无法安全解析 XLSX 文件。",
      },
    });
    expect(JSON.stringify(payload)).not.toContain(marker);
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("stack");
  });

  it("keeps preview request-scoped for distinct Visitor sessions and has no network side effect", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    authenticated("demo", "visitor-a");
    const first = await json(await POST(requestFor()));
    authenticated("demo", "visitor-b");
    const secondSource = createSellerSpritePreviewWorkbook({
      headers,
      rows: [["B0TEST0002", "Other", "https://www.amazon.com/dp/B0TEST0002"]],
    });
    const second = await json(await POST(requestFor(secondSource)));

    expect(JSON.stringify(first)).toContain("B0TEST0001");
    expect(JSON.stringify(second)).toContain("B0TEST0002");
    expect(JSON.stringify(second)).not.toContain("B0TEST0001");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the same session rate limit rule without persisting a preview", async () => {
    authenticated("demo", "visitor-a");
    for (let index = 0; index < 6; index += 1) {
      expect((await POST(requestFor())).status).toBe(200);
    }
    expect((await POST(requestFor())).status).toBe(429);
    authenticated("demo", "visitor-b");
    expect((await POST(requestFor())).status).toBe(200);
  });

  it("returns a white-listed Preview contract without old market artifacts or persistence integrations", async () => {
    authenticated("owner");
    const response = await POST(requestFor());
    const payload = await json(response);
    const serialized = JSON.stringify(payload);
    expect(response.status).toBe(200);
    expect(serialized).toContain("sellersprite_xlsx");
    for (const forbidden of ["extraRaw", "\"note\"", "\"brands\"", "\"sellers\"", "ranking", "marketSnapshot", "shadow", "opportunityScore", "candidateStatus"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }

    const sourceText = await readFile(new URL("./route.ts", import.meta.url), "utf8");
    expect(sourceText).toContain("requireAuthenticated");
    expect(sourceText).not.toContain("requireOwnerOnly");
    expect(sourceText).not.toContain("resetSellerSpritePreviewRateLimitForTest");
    expect(sourceText).not.toMatch(/prisma|opportunityCandidateService|Task|Evidence|aiClient|fetch\(/i);
    expect(sourceText).not.toMatch(/node:fs|writeFile|appendFile|mkdir|rename|unlink/i);
  });

  it("does not return importToken for HTTP 401", async () => {
    auth.mockReturnValue({ ok: false, status: 401, code: "invalid_access", message: "login required" });
    const response = await POST(requestFor());
    expect(response.status).toBe(401);
    const payload = await json(response);
    expect(payload.preview).toBeUndefined();
  });

  it("does not return importToken when blockingErrors exist", async () => {
    // Create a workbook with conflicting duplicate ASIN rows
    const conflictSource = createSellerSpritePreviewWorkbook({
      headers,
      rows: [
        ["B0CONFLICT", "Product A", "https://www.amazon.com/dp/B0CONFLICT"],
        ["B0CONFLICT", "Product B Different", "https://www.amazon.com/dp/B0CONFLICT"],
      ],
    });
    authenticated("owner");
    const response = await POST(requestFor(conflictSource));
    const payload = await json(response);
    expect(response.status).toBe(422);
    expect(payload.ok).toBe(true);
    const preview = payload.preview as Record<string, unknown>;
    expect((preview.blockingErrors as unknown[]).length).toBeGreaterThan(0);
    expect(preview.importToken).toBeUndefined();
  });

  it("does not return importToken when acceptedRows is empty", async () => {
    const emptySource = createSellerSpritePreviewWorkbook({
      headers,
      rows: [],
    });
    authenticated("owner");
    const response = await POST(requestFor(emptySource));
    const payload = await json(response);
    expect(response.status).toBe(422);
    expect(payload.ok).toBe(false);
    expect(payload.preview).toBeUndefined();
  });

  it("returns preview without importToken when secret is missing (fail-closed)", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    authenticated("owner");
    const response = await POST(requestFor());
    const payload = await json(response);
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    const preview = payload.preview as Record<string, unknown>;
    expect(preview.acceptedRowCount).toBe(1);
    expect(preview.importToken).toBeUndefined();
  });

  it("does not leak secret or stack trace in any error response", async () => {
    const secretMarker = SYNTHETIC_SECRET;
    authenticated("owner");
    // Invalid XLSX to trigger error path
    const response = await POST(requestFor(new TextEncoder().encode("not a ZIP")));
    const payload = await json(response);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(secretMarker);
    expect(serialized.toLowerCase()).not.toContain("stack");
    expect(serialized).not.toContain("ACCESS_PASSWORD");
  });

  it("Owner and Visitor tokens have different subjectScopeHash", async () => {
    authenticated("owner");
    const ownerResponse = await POST(requestFor());
    authenticated("demo", "visitor-a");
    const visitorResponse = await POST(requestFor());
    const ownerJson = await ownerResponse.json();
    const visitorJson = await visitorResponse.json();
    expect(ownerJson.preview.importToken).toBeDefined();
    expect(visitorJson.preview.importToken).toBeDefined();

    // Decode tokens and compare subjectScopeHash
    const ownerParts = (ownerJson.preview.importToken as string).split(".");
    const visitorParts = (visitorJson.preview.importToken as string).split(".");
    const ownerPayload = JSON.parse(Buffer.from(ownerParts[1], "base64url").toString("utf-8"));
    const visitorPayload = JSON.parse(Buffer.from(visitorParts[1], "base64url").toString("utf-8"));
    expect(ownerPayload.subjectScopeHash).not.toBe(visitorPayload.subjectScopeHash);
  });

  it("issues an importToken for a valid multi-sheet standard workbook", async () => {
    const multiSheetSource = createSellerSpritePreviewWorkbookWithSheets([
      { name: "Note", headers: ["Note"], rows: [["private"]] },
      { name: "US", headers, rows: [["B0TEST0001", "Test product", "https://www.amazon.com/dp/B0TEST0001"]] },
      { name: "Brands", headers: ["Brand"], rows: [["Brand A"]] },
      { name: "Sellers", headers: ["Seller"], rows: [["Seller X"]] },
    ]);
    authenticated("owner");
    const response = await POST(requestFor(multiSheetSource));
    expect(response.status).toBe(200);
    const payload = await json(response);
    const preview = payload.preview as Record<string, unknown>;
    expect(preview.acceptedRowCount).toBe(1);
    expect((preview.blockingErrors as unknown[]).length).toBe(0);
    expect(preview.importToken).toMatch(/^preview-import-v1\./);
  });
});

const SYNTHETIC_SECRET = "test-access-password-for-token-signing";
