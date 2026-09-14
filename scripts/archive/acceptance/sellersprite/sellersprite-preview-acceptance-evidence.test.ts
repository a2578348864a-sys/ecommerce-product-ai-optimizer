import { describe, expect, it } from "vitest";
import { buildSellerSpritePreviewAcceptanceEvidence } from "./sellersprite-preview-acceptance-evidence.mjs";

const request = {
  url: "http://127.0.0.1:3115/api/opportunities/sellersprite-preview?do-not-report=this",
  method: "post",
  pageFinalUrl: "http://127.0.0.1:3115/opportunities/sellersprite-preview?do-not-report=this",
  startedAt: "2026-07-30T12:00:00.000Z",
  finishedAt: "2026-07-30T12:00:01.250Z",
  headers: {
    origin: "http://127.0.0.1:3115",
    referer: "http://127.0.0.1:3115/opportunities/sellersprite-preview?private-path=true",
    host: "127.0.0.1:3115",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "content-type": "multipart/form-data; boundary=never-report-this",
    cookie: "never-report-cookie",
    authorization: "never-report-authorization",
  },
};

function evidenceFor(status: number, options: {
  isJson?: boolean;
  json?: Record<string, unknown>;
  contentType?: string;
} = {}) {
  return buildSellerSpritePreviewAcceptanceEvidence({
    request: { ...request, body: "never-report-request-body" },
    response: {
      status,
      isJson: options.isJson ?? true,
      json: options.json,
      body: "never-report-response-body",
      headers: {
        "content-type": options.contentType ?? "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": "never-report-set-cookie",
      },
    },
  });
}

describe("SellerSprite Preview acceptance evidence allowlist", () => {
  it("extracts only safe 200 JSON metadata", () => {
    const result = evidenceFor(200, {
      json: {
        ok: true,
        preview: {
          acceptedRowCount: 2,
          rejectedRows: [{}],
          warnings: [{}],
          blockingErrors: [],
          acceptedRows: [{ title: "must-not-appear" }],
        },
      },
    });

    expect(result).toMatchObject({
      schemaVersion: "sellersprite_preview_acceptance_evidence_v1",
      request: {
        url: "http://127.0.0.1:3115/api/opportunities/sellersprite-preview",
        method: "POST",
        pageFinalUrl: "http://127.0.0.1:3115/opportunities/sellersprite-preview",
        origin: "http://127.0.0.1:3115",
        refererOrigin: "http://127.0.0.1:3115",
        authority: "127.0.0.1:3115",
        contentType: "multipart/form-data",
      },
      response: {
        status: 200,
        isJson: true,
        ok: true,
        blockingErrorCount: 0,
        warningCount: 1,
        validRows: 2,
        invalidRows: 1,
        classification: "preview_success",
      },
    });
  });

  it("classifies a controlled 422 blocking preview without product data", () => {
    const result = evidenceFor(422, {
      json: { ok: true, preview: { blockingErrors: [{ code: "duplicate_asin_conflict" }], warnings: [] } },
    });
    expect(result.response).toMatchObject({
      status: 422,
      ok: true,
      blockingErrorCount: 1,
      classification: "controlled_blocking_preview",
    });
  });

  it.each([
    [401, "authentication_failure"],
    [403, "origin_or_authorization_failure"],
    [415, "upload_contract_failure"],
    [500, "server_failure"],
  ])("classifies HTTP %i failures without raw server messages", (status, classification) => {
    const result = evidenceFor(status, {
      json: { ok: false, error: { code: "xlsx_required", message: "server-only detail must not appear" } },
    });
    expect(result.response.classification).toBe(classification);
    expect(result.response.errorCode).toBe("xlsx_required");
    expect(result.response.errorSummary).toBe("文件类型不符合要求。");
    expect(JSON.stringify(result)).not.toContain("server-only detail must not appear");
  });

  it("records a non-JSON response as a status-only safe failure", () => {
    const result = evidenceFor(502, { isJson: false, contentType: "text/html; charset=utf-8" });
    expect(result.response).toEqual(expect.objectContaining({
      status: 502,
      contentType: "other",
      isJson: false,
      ok: null,
      errorCode: null,
      errorSummary: null,
      classification: "non_json_response",
    }));
  });

  it.each([
    "external_hyperlink_relationship_rejected",
    "insecure_hyperlink_relationship_rejected",
    "local_hyperlink_target_rejected",
    "private_network_hyperlink_rejected",
    "invalid_hyperlink_target_rejected",
    "hyperlink_target_too_long",
  ])("records only allowlisted unsupported-XLSX reason metadata and replaces the raw message", (reasonCode) => {
    const result = evidenceFor(422, {
      json: {
        ok: false,
        error: {
          code: "unsupported_xlsx_feature",
          reasonCode,
          stage: "ooxml_package",
          message: "synthetic raw parser detail must not appear",
          internalPath: "must-not-appear",
          stack: "must-not-appear",
        },
      },
    });

    expect(result.response).toMatchObject({
      status: 422,
      ok: false,
      errorCode: "unsupported_xlsx_feature",
      reasonCode,
      stage: "ooxml_package",
      errorSummary: "该 XLSX 包含当前安全解析器不支持的工作簿特征。",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("synthetic raw parser detail");
    expect(serialized).not.toContain("internalPath");
    expect(serialized).not.toContain("stack");
  });

  it("drops unknown reason and stage values even when the top-level error is allowlisted", () => {
    const result = evidenceFor(422, {
      json: {
        ok: false,
        error: {
          code: "unsupported_xlsx_feature",
          reasonCode: "unrecognized-reason",
          stage: "unrecognized-stage",
          message: "must-not-appear",
        },
      },
    });
    expect(result.response).toMatchObject({
      errorCode: "unsupported_xlsx_feature",
      reasonCode: null,
      stage: null,
      errorSummary: "该 XLSX 包含当前安全解析器不支持的工作簿特征。",
    });
    expect(JSON.stringify(result)).not.toContain("unrecognized");
    expect(JSON.stringify(result)).not.toContain("must-not-appear");
  });

  it("never emits credentials, headers outside the allowlist, request bodies, or product rows", () => {
    const result = evidenceFor(403, {
      json: { ok: false, error: { code: "unknown_code", message: "never-report-unknown-message" } },
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "never-report-cookie",
      "never-report-set-cookie",
      "never-report-authorization",
      "never-report-request-body",
      "never-report-response-body",
      "never-report-unknown-message",
      "must-not-appear",
      "private-path",
      "boundary=",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(result.request).not.toHaveProperty("body");
    expect(result.response).not.toHaveProperty("body");
  });
});
