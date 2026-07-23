import { afterEach, describe, expect, it, vi } from "vitest";

import { requestSourceImportPreview } from "@/lib/client/sourceImportPreview";

const SOURCE_INPUT = "https://example.com/feed.xml";
const ACCESS_PASSWORD = "phase3a-synthetic-access";
const ACCESS_HEADERS = Object.freeze({
  "x-access-token": "phase3a-synthetic-token",
  "x-access-password": "phase3a-synthetic-token",
});

function response(
  body: unknown,
  {
    status = 200,
    contentType = "application/json; charset=utf-8",
    jsonError,
  }: {
    status?: number;
    contentType?: string;
    jsonError?: Error;
  } = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => {
      if (jsonError) throw jsonError;
      return body;
    },
  } as unknown as Response;
}

function request() {
  return Object.freeze({
    input: SOURCE_INPUT,
    accessPassword: ACCESS_PASSWORD,
    accessHeaders: ACCESS_HEADERS,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("source-import preview request adapter", () => {
  it("[REQUEST_CONTRACT] assembles the current endpoint, method, headers, credentials, and body exactly", async () => {
    const payload = {
      ok: true,
      candidates: [],
      summary: { totalUrls: 1, okUrls: 0, failedUrls: 1, totalCandidates: 0 },
      warnings: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(response(payload));
    vi.stubGlobal("fetch", fetchMock);
    const input = request();

    const result = await requestSourceImportPreview(input);

    expect(result).toEqual({ kind: "json", status: 200, payload });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/opportunities/source-import",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": "phase3a-synthetic-token",
          "x-access-password": "phase3a-synthetic-token",
        },
        body: JSON.stringify({
          input: SOURCE_INPUT,
          accessPassword: ACCESS_PASSWORD,
        }),
      },
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBeUndefined();
    expect(init.signal).toBeUndefined();
    expect(input).toEqual(request());
    expect(input.accessHeaders).toEqual(ACCESS_HEADERS);
  });

  it("[REQUEST_CONTRACT] preserves candidate payloads and warning order without normalization", async () => {
    const warnings = [
      "https://example.com/a: timeout [timeout]",
      "第二条 warning",
      "https://example.com/b: forbidden [blocked]",
    ];
    const payload = {
      ok: true,
      candidates: [{ title: "Adapter Contract Candidate" }],
      summary: { totalUrls: 2, okUrls: 1, failedUrls: 1, totalCandidates: 1 },
      warnings,
      futureField: { preserved: true },
    };
    const fetchMock = vi.fn().mockResolvedValue(response(payload));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestSourceImportPreview(request());

    expect(result).toEqual({ kind: "json", status: 200, payload });
    if (result.kind !== "json") throw new Error("expected_json_result");
    expect(result.payload).toBe(payload);
    expect(result.payload.ok && result.payload.warnings).toEqual(warnings);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "invalid_access"],
    [403, "demo_action_forbidden"],
    [429, "too_many_urls"],
    [500, "upstream_failed"],
  ] as const)(
    "[REQUEST_CONTRACT] preserves JSON error payload and HTTP status %i",
    async (status, code) => {
      const payload = {
        ok: false,
        error: { code, message: `message:${code}` },
      };
      const fetchMock = vi.fn().mockResolvedValue(response(payload, { status }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(requestSourceImportPreview(request())).resolves.toEqual({
        kind: "json",
        status,
        payload,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403, 429, 500] as const)(
    "[REQUEST_CONTRACT] returns the current non-JSON discriminator for HTTP %i without parsing",
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(response(
        "<html>proxy error</html>",
        { status, contentType: "text/html; charset=utf-8" },
      ));
      vi.stubGlobal("fetch", fetchMock);

      await expect(requestSourceImportPreview(request())).resolves.toEqual({
        kind: "non_json",
        status,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("[REQUEST_CONTRACT] returns the current invalid-JSON discriminator", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(
      null,
      { jsonError: new SyntaxError("Unexpected token <") },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestSourceImportPreview(request())).resolves.toEqual({
      kind: "invalid_json",
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    new Error("Failed to fetch"),
    Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
  ])("[REQUEST_CONTRACT] preserves rejected fetch errors without remapping", async (error) => {
    const fetchMock = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestSourceImportPreview(request())).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("[REQUEST_CONTRACT] assembles consecutive requests deterministically and performs no Storage write", async () => {
    const payload = {
      ok: true,
      candidates: [],
      summary: { totalUrls: 1, okUrls: 0, failedUrls: 1, totalCandidates: 0 },
      warnings: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(payload))
      .mockResolvedValueOnce(response(payload));
    vi.stubGlobal("fetch", fetchMock);
    const localStorageWrite = vi.fn();
    const sessionStorageWrite = vi.fn();
    vi.stubGlobal("window", {
      localStorage: { setItem: localStorageWrite },
      sessionStorage: { setItem: sessionStorageWrite },
    });
    const input = request();

    const first = await requestSourceImportPreview(input);
    const second = await requestSourceImportPreview(input);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual(fetchMock.mock.calls[1]);
    expect(localStorageWrite).not.toHaveBeenCalled();
    expect(sessionStorageWrite).not.toHaveBeenCalled();
  });
});
