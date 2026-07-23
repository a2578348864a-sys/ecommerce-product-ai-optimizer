import { act, createElement } from "react";
import type { ComponentType } from "react";
import type { Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";
import { saveAccessToken } from "@/lib/client/accessToken";
import {
  findAll,
  findByText,
  installTestDom,
  setNativeValue,
  TestEvent,
  type TestDom,
  type TestElement,
} from "@/tests/helpers/minimal-react-dom";

type OpportunitiesFormProps = NonNullable<Parameters<typeof OpportunitiesForm>[0]>;
const OpportunitiesFormComponent = OpportunitiesForm as ComponentType<OpportunitiesFormProps>;

const SYNTHETIC_ACCESS = "phase3a-preview-test-access";
const SOURCE_URL = "https://example.com/feed.xml";
const SOURCE_INPUT_PLACEHOLDER_PREFIX = "https://example.com/rss";

const sourceEvidence = {
  version: "candidate-source-v2" as const,
  evidenceId: "phase3a-preview-evidence",
  origin: "public_url" as const,
  capturedAt: "2026-07-23T12:00:00.000Z",
  submittedUrl: SOURCE_URL,
  finalUrl: SOURCE_URL,
  candidateUrl: "https://example.com/products/widget",
  sourceRelation: "document_item" as const,
  sourceHost: "example.com",
  sourceType: "rss" as const,
  transportSecurity: "https" as const,
  retrieval: {
    status: "retrieved" as const,
    httpStatus: 200,
    contentType: "application/rss+xml",
    robots: "allowed" as const,
    redirectCount: 0,
  },
  observations: {
    title: "Widget Stand",
    categoryHint: "Desk accessories",
    signalText: "Portable stand",
    priceText: null,
    hasImage: null,
  },
  extractionSignals: ["rss_item"],
};

const ruleAssessment = {
  version: "candidate-rule-v1" as const,
  algorithm: "radar-evidence-v2",
  evidenceHash: "a".repeat(64),
  computedAt: "2026-07-23T12:00:00.000Z",
  candidateType: "product_candidate",
  scores: {
    demandSignal: 82,
    supplyEase: 74,
    risk: 31,
    beginnerFit: 88,
    final: 79,
  },
  riskFlags: [] as string[],
  reasons: ["规则评分"],
  queueSuggestion: "review" as const,
};

function candidate(title: string) {
  return {
    title,
    sourceUrl: "https://example.com/products/widget",
    sourceType: "rss",
    sourceHost: "example.com",
    categoryHint: "Desk accessories",
    keyword: "desk",
    riskHint: "",
    riskLevel: "green",
    summaryLabel: "候选可评估",
    score: 79,
    demandSignalScore: 82,
    supplyEaseScore: 74,
    riskScore: 31,
    beginnerFitScore: 88,
    candidateType: "product_candidate",
    sourceEvidence,
    ruleAssessment,
    sourceProof: "sourceproof_v1.synthetic.signature",
  };
}

function jsonResponse(
  payload: unknown,
  status = 200,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => payload,
  } as unknown as Response;
}

function nonJsonResponse(status: number): Response {
  return {
    ok: false,
    status,
    headers: { get: () => "text/html; charset=utf-8" },
    json: async () => {
      throw new Error("non_json_body_must_not_be_parsed");
    },
  } as unknown as Response;
}

function previewSuccess(
  candidates: readonly ReturnType<typeof candidate>[],
  warnings: readonly string[] = [],
) {
  return {
    ok: true,
    candidates: [...candidates],
    summary: {
      totalUrls: 1,
      okUrls: candidates.length > 0 ? 1 : 0,
      failedUrls: candidates.length > 0 ? 0 : 1,
      totalCandidates: candidates.length,
    },
    warnings: [...warnings],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("OpportunitiesForm source preview command", () => {
  let dom: TestDom;
  let container: TestElement;
  let root: Root | null;

  beforeEach(() => {
    dom = installTestDom();
    saveAccessToken(SYNTHETIC_ACCESS, "owner");
    container = dom.document.createElement("div");
    dom.document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dom.restore();
  });

  async function mountUnlocked(
    surface: "legacy_default" | "advanced_import" = "legacy_default",
  ) {
    const fetchMock = vi.fn().mockRejectedValue(new Error("phase3a_isolated_network"));
    vi.stubGlobal("fetch", fetchMock);
    const localStorageWrite = vi.spyOn(dom.localStorage, "setItem");
    const sessionStorageWrite = vi.spyOn(dom.sessionStorage, "setItem");
    const client = await import("react-dom/client");
    root = client.createRoot(container as unknown as Element);

    await act(async () => {
      root?.render(createElement(OpportunitiesFormComponent, { surface }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsyncWork();

    fetchMock.mockReset();
    localStorageWrite.mockClear();
    sessionStorageWrite.mockClear();
    await act(async () => findByText(container, "button", "添加候选").click());

    return { fetchMock, localStorageWrite, sessionStorageWrite };
  }

  function sourceInput() {
    const input = findAll(
      container,
      (element) => element.localName === "textarea"
        && element.getAttribute("placeholder")?.startsWith(SOURCE_INPUT_PLACEHOLDER_PREFIX) === true,
    )[0];
    if (!input) throw new Error("source_preview_input_not_found");
    return input;
  }

  async function enterSourceUrl(value = SOURCE_URL) {
    const input = sourceInput();
    setNativeValue(input, value);
    await act(async () => input.dispatchEvent(new TestEvent("input")));
  }

  function previewButton(text = "抓取公开来源") {
    return findByText(container, "button", text);
  }

  async function submitPreview(
    fetchMock: ReturnType<typeof vi.fn>,
    response: Response | Error,
    value = SOURCE_URL,
  ) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
    await enterSourceUrl(value);
    await act(async () => previewButton().click());
    await flushAsyncWork();
  }

  async function startTwoSameTurnPreviews(
    fetchMock: ReturnType<typeof vi.fn>,
  ) {
    const older = deferred<Response>();
    const newer = deferred<Response>();
    fetchMock
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    await enterSourceUrl();
    const button = previewButton();
    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    return { older, newer };
  }

  it.each(["legacy_default", "advanced_import"] as const)(
    "[MOUNTED_BEHAVIOR] keeps empty source input locally blocked on %s",
    async (surface) => {
      const monitors = await mountUnlocked(surface);

      const button = previewButton();
      await act(async () => button.click());

      expect(monitors.fetchMock).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("抓取中");
      expect(container.textContent).not.toContain("请输入至少 1 个公开 URL。");
      expect(monitors.localStorageWrite).not.toHaveBeenCalled();
      expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();
    },
  );

  it.each(["legacy_default", "advanced_import"] as const)(
    "[MOUNTED_BEHAVIOR] keeps whitespace-only source input locally blocked on %s",
    async (surface) => {
      const monitors = await mountUnlocked(surface);

      await enterSourceUrl(" \n\t ");
      await act(async () => previewButton().click());

      expect(monitors.fetchMock).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("抓取中");
      expect(container.textContent).not.toContain("请输入至少 1 个公开 URL。");
      expect(monitors.localStorageWrite).not.toHaveBeenCalled();
      expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["non-URL text", "not-a-url"],
    [
      "special URL input",
      "https://例子.测试/路径?q=空 格#片段\nhttps://example.com/feed.xml?tag=a%2Fb",
    ],
  ] as const)(
    "[REQUEST_CONTRACT][MOUNTED_BEHAVIOR] preserves %s without adding client URL validation",
    async (_label, value) => {
      const monitors = await mountUnlocked();
      await submitPreview(
        monitors.fetchMock,
        jsonResponse(previewSuccess([])),
        value,
      );

      expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
      const requestBody = JSON.parse(
        String((monitors.fetchMock.mock.calls[0]?.[1] as RequestInit).body),
      ) as { input: string; accessPassword: string };
      expect(requestBody).toEqual({
        input: value.trim(),
        accessPassword: SYNTHETIC_ACCESS,
      });
    },
  );

  it.each(["legacy_default", "advanced_import"] as const)(
    "[MOUNTED_BEHAVIOR] keeps the source preview command absent while %s is locked",
    async (surface) => {
      dom.sessionStorage.clear();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const client = await import("react-dom/client");
      root = client.createRoot(container as unknown as Element);

      await act(async () => {
        root?.render(createElement(OpportunitiesFormComponent, { surface }));
        await Promise.resolve();
        await Promise.resolve();
      });
      await flushAsyncWork();

      expect(container.textContent).not.toContain("抓取公开来源");
      expect(findAll(
        container,
        (element) => element.localName === "textarea"
          && element.getAttribute("placeholder")?.startsWith(SOURCE_INPUT_PLACEHOLDER_PREFIX) === true,
      )).toHaveLength(0);
      expect(fetchMock.mock.calls.filter(
        ([url]) => url === "/api/opportunities/source-import",
      )).toHaveLength(0);
    },
  );

  it.each(["legacy_default", "advanced_import"] as const)(
    "[REQUEST_CONTRACT][MOUNTED_BEHAVIOR] preserves the preview request and success contract on %s",
    async (surface) => {
      const monitors = await mountUnlocked(surface);
      await submitPreview(
        monitors.fetchMock,
        jsonResponse(previewSuccess([candidate("Widget Stand")])),
        `  ${SOURCE_URL}\n  `,
      );

      expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
      expect(monitors.fetchMock).toHaveBeenCalledWith(
        "/api/opportunities/source-import",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-access-token": SYNTHETIC_ACCESS,
            "x-access-password": SYNTHETIC_ACCESS,
          },
          body: JSON.stringify({
            input: SOURCE_URL,
            accessPassword: SYNTHETIC_ACCESS,
          }),
        },
      );
      const requestInit = monitors.fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(requestInit.credentials).toBeUndefined();
      expect(requestInit.signal).toBeUndefined();
      expect(container.textContent).toContain("已提取 1 个候选品");
      expect(container.textContent).toContain("Widget Stand");
      expect(container.textContent).not.toContain("抓取中");
      expect(monitors.localStorageWrite).not.toHaveBeenCalled();
      expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();
    },
  );

  it("[MOUNTED_BEHAVIOR] preserves empty-result summary, warning, and error presentation", async () => {
    const monitors = await mountUnlocked();
    await submitPreview(
      monitors.fetchMock,
      jsonResponse(previewSuccess([], ["https://example.com/feed: timeout [timeout]"])),
    );

    expect(container.textContent).toContain(
      "抓取成功，但未提取到候选品。请尝试 RSS 或 Sitemap 格式的链接。",
    );
    expect(container.textContent).toContain("请求超时");
    expect(container.textContent).toContain("https://example.com/feed: timeout");
    expect(container.textContent).not.toContain("[timeout]");
    expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["demo_access_expired", "演示访问已过期。", 403, "演示访问已过期。"],
    ["demo_access_inactive", "演示访问已停用。", 403, "演示访问已停用。"],
    ["demo_action_forbidden", "当前访客不能执行来源预览。", 403, "当前访客不能执行来源预览。"],
    ["demo_ai_quota_exceeded", "当前访客配额已用完。", 429, "当前访客配额已用完。"],
    ["invalid_access", "后端原始错误不应展示。", 401, "访问已失效，请重新输入访问密码。"],
    ["unauthorized", "后端原始错误不应展示。", 403, "访问已失效，请重新输入访问密码。"],
    ["too_many_urls", "公开 URL 最多 5 个。", 429, "公开 URL 最多 5 个。"],
    ["no_valid_urls", "没有可抓取的公开 URL。", 400, "没有可抓取的公开 URL。"],
    ["upstream_failed", "来源服务暂时不可用。", 500, "来源服务暂时不可用。"],
  ] as const)(
    "[MOUNTED_BEHAVIOR] preserves business error %s at HTTP %i",
    async (code, message, status, expectedMessage) => {
      const monitors = await mountUnlocked();
      await submitPreview(
        monitors.fetchMock,
        jsonResponse({ ok: false, error: { code, message } }, status),
      );

      expect(container.textContent).toContain(expectedMessage);
      expect(container.textContent).not.toContain("抓取中");
      expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [200, "服务返回异常（200），请稍后重试。"],
    [204, "服务返回异常（204），请稍后重试。"],
    [401, "访问已失效，请重新输入访问密码。"],
    [403, "访问已失效，请重新输入访问密码。"],
    [404, "服务返回异常（404），请稍后重试。"],
    [429, "服务返回异常（429），请稍后重试。"],
    [500, "服务返回异常（500），请稍后重试。"],
    [502, "服务返回异常（502），请稍后重试。"],
  ] as const)(
    "[MOUNTED_BEHAVIOR] preserves non-JSON HTTP %i handling",
    async (status, expectedMessage) => {
      const monitors = await mountUnlocked();
      await submitPreview(monitors.fetchMock, nonJsonResponse(status));

      expect(container.textContent).toContain(expectedMessage);
      expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("[MOUNTED_BEHAVIOR] preserves warning order and duplicate warnings", async () => {
    const monitors = await mountUnlocked();
    const firstWarning = "first warning";
    const secondWarning = "second warning";
    await submitPreview(
      monitors.fetchMock,
      jsonResponse(previewSuccess(
        [candidate("Warnings Candidate")],
        [firstWarning, firstWarning, secondWarning],
      )),
    );

    const text = container.textContent;
    expect(text.match(new RegExp(firstWarning, "g"))).toHaveLength(2);
    expect(text.indexOf(firstWarning)).toBeLessThan(text.indexOf(secondWarning));
  });

  it("[TIMING_BEHAVIOR] clears an old warning and preview result when a new request starts", async () => {
    const monitors = await mountUnlocked();
    await submitPreview(
      monitors.fetchMock,
      jsonResponse(previewSuccess(
        [candidate("Old Candidate")],
        ["https://example.com/old: timeout [timeout]"],
      )),
    );
    expect(container.textContent).toContain("Old Candidate");
    expect(container.textContent).toContain("请求超时");

    const pending = deferred<Response>();
    monitors.fetchMock.mockImplementationOnce(() => pending.promise);
    await enterSourceUrl("https://example.com/new.xml");
    await act(async () => previewButton().click());

    expect(container.textContent).toContain("抓取中");
    expect(container.textContent).not.toContain("Old Candidate");
    expect(container.textContent).not.toContain("请求超时");

    pending.resolve(jsonResponse(previewSuccess([candidate("New Candidate")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("New Candidate");
  });

  it("[TIMING_BEHAVIOR] clears an old error when a new request starts", async () => {
    const monitors = await mountUnlocked();
    await submitPreview(
      monitors.fetchMock,
      jsonResponse({
        ok: false,
        error: { code: "upstream_failed", message: "Old request failed." },
      }, 500),
    );
    expect(container.textContent).toContain("Old request failed.");

    const pending = deferred<Response>();
    monitors.fetchMock.mockImplementationOnce(() => pending.promise);
    await enterSourceUrl("https://example.com/retry.xml");
    await act(async () => previewButton().click());

    expect(container.textContent).toContain("抓取中");
    expect(container.textContent).not.toContain("Old request failed.");

    pending.resolve(jsonResponse(previewSuccess([candidate("Retry Candidate")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("Retry Candidate");
  });

  it("[MOUNTED_BEHAVIOR] preserves invalid JSON handling", async () => {
    const monitors = await mountUnlocked();
    const response = {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    } as unknown as Response;

    await submitPreview(monitors.fetchMock, response);

    expect(container.textContent).toContain("服务返回了不可识别的数据，请稍后重试。");
    expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new Error("Failed to fetch"), "网络连接失败，请检查网络后重试。"],
    [new Error("NetworkError when attempting to fetch resource."), "网络连接失败，请检查网络后重试。"],
    [
      Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
      "This operation was aborted",
    ],
    [new Error("custom preview failure"), "custom preview failure"],
  ] as const)(
    "[MOUNTED_BEHAVIOR] preserves rejected-fetch handling for %s",
    async (error, expectedMessage) => {
      const monitors = await mountUnlocked();
      await submitPreview(monitors.fetchMock, error);

      expect(container.textContent).toContain(expectedMessage);
      expect(container.textContent).not.toContain("抓取中");
      expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("[TIMING_BEHAVIOR] ignores request A success while request B is pending", async () => {
    const monitors = await mountUnlocked();
    const { older, newer } = await startTwoSameTurnPreviews(monitors.fetchMock);

    older.resolve(jsonResponse(previewSuccess([candidate("Request A Result")])));
    await flushAsyncWork();

    expect(container.textContent).not.toContain("Request A Result");
    expect(container.textContent).toContain("抓取中");

    newer.resolve(jsonResponse(previewSuccess([candidate("Request B Result")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("Request B Result");
    expect(container.textContent).not.toContain("抓取中");
  });

  it("[TIMING_BEHAVIOR] ignores request A failure while request B is pending", async () => {
    const monitors = await mountUnlocked();
    const { older, newer } = await startTwoSameTurnPreviews(monitors.fetchMock);

    older.reject(new Error("Request A failed."));
    await flushAsyncWork();

    expect(container.textContent).not.toContain("Request A failed.");
    expect(container.textContent).toContain("抓取中");

    newer.resolve(jsonResponse(previewSuccess([candidate("Request B Result")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("Request B Result");
    expect(container.textContent).not.toContain("抓取中");
  });

  it("[TIMING_BEHAVIOR] keeps request B success when request A later succeeds", async () => {
    const monitors = await mountUnlocked();
    const { older, newer } = await startTwoSameTurnPreviews(monitors.fetchMock);

    newer.resolve(jsonResponse(previewSuccess([candidate("Request B Result")])));
    await flushAsyncWork();
    older.resolve(jsonResponse(previewSuccess([candidate("Request A Result")])));
    await flushAsyncWork();

    expect(container.textContent).toContain("Request B Result");
    expect(container.textContent).not.toContain("Request A Result");
  });

  it("[TIMING_BEHAVIOR] keeps request B success when request A later fails", async () => {
    const monitors = await mountUnlocked();
    const { older, newer } = await startTwoSameTurnPreviews(monitors.fetchMock);

    newer.resolve(jsonResponse(previewSuccess([candidate("Request B Result")])));
    await flushAsyncWork();
    older.reject(new Error("Request A failed."));
    await flushAsyncWork();

    expect(container.textContent).toContain("Request B Result");
    expect(container.textContent).not.toContain("Request A failed.");
  });

  it("[TIMING_BEHAVIOR] keeps request B failure when request A later succeeds", async () => {
    const monitors = await mountUnlocked();
    const { older, newer } = await startTwoSameTurnPreviews(monitors.fetchMock);

    newer.reject(new Error("Request B failed."));
    await flushAsyncWork();
    older.resolve(jsonResponse(previewSuccess([candidate("Request A Result")])));
    await flushAsyncWork();

    expect(container.textContent).toContain("Request B failed.");
    expect(container.textContent).not.toContain("Request A Result");
  });

  it("[TIMING_BEHAVIOR] keeps only request B failure when request A later fails", async () => {
    const monitors = await mountUnlocked();
    const { older, newer } = await startTwoSameTurnPreviews(monitors.fetchMock);

    newer.reject(new Error("Request B failed."));
    await flushAsyncWork();
    older.reject(new Error("Request A failed."));
    await flushAsyncWork();

    expect(container.textContent).toContain("Request B failed.");
    expect(container.textContent).not.toContain("Request A failed.");
  });

  it("[TIMING_BEHAVIOR] stale finally does not close request B loading", async () => {
    const monitors = await mountUnlocked();
    const { older, newer } = await startTwoSameTurnPreviews(monitors.fetchMock);

    older.resolve(jsonResponse(previewSuccess([candidate("Stale Result")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("抓取中");

    newer.resolve(jsonResponse(previewSuccess([candidate("Latest Result")])));
    await flushAsyncWork();
    expect(container.textContent).not.toContain("抓取中");
  });

  it("[TIMING_BEHAVIOR] request A success then request B failure leaves only B error", async () => {
    const monitors = await mountUnlocked();
    const { older, newer } = await startTwoSameTurnPreviews(monitors.fetchMock);

    older.resolve(jsonResponse(previewSuccess(
      [candidate("Request A Result")],
      ["request A warning"],
    )));
    await flushAsyncWork();
    newer.reject(new Error("Request B failed."));
    await flushAsyncWork();

    expect(container.textContent).not.toContain("Request A Result");
    expect(container.textContent).not.toContain("request A warning");
    expect(container.textContent).toContain("Request B failed.");
  });

  it("[TIMING_BEHAVIOR] request A failure then request B success leaves only B result", async () => {
    const monitors = await mountUnlocked();
    const { older, newer } = await startTwoSameTurnPreviews(monitors.fetchMock);

    older.reject(new Error("Request A failed."));
    await flushAsyncWork();
    newer.resolve(jsonResponse(previewSuccess([candidate("Request B Result")])));
    await flushAsyncWork();

    expect(container.textContent).not.toContain("Request A failed.");
    expect(container.textContent).toContain("Request B Result");
  });

  it("[TIMING_BEHAVIOR] repeated same URL previews use start order rather than input identity", async () => {
    const monitors = await mountUnlocked();
    const { older, newer } = await startTwoSameTurnPreviews(monitors.fetchMock);
    const inputs = monitors.fetchMock.mock.calls.map((call) => JSON.parse(
      String((call[1] as RequestInit).body),
    ).input);
    expect(inputs).toEqual([SOURCE_URL, SOURCE_URL]);

    newer.resolve(jsonResponse(previewSuccess([candidate("Latest Same URL")])));
    await flushAsyncWork();
    older.resolve(jsonResponse(previewSuccess([candidate("Stale Same URL")])));
    await flushAsyncWork();

    expect(container.textContent).toContain("Latest Same URL");
    expect(container.textContent).not.toContain("Stale Same URL");
  });

  it("[MOUNTED_BEHAVIOR] a different URL user action remains blocked while preview is loading", async () => {
    const monitors = await mountUnlocked();
    const pending = deferred<Response>();
    monitors.fetchMock.mockImplementationOnce(() => pending.promise);

    await enterSourceUrl("https://example.com/request-a.xml");
    await act(async () => previewButton().click());
    await flushAsyncWork();
    expect(container.textContent).toContain("抓取中");
    previewButton("抓取中…").click();

    expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
    pending.resolve(jsonResponse(previewSuccess([candidate("Request A Result")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("Request A Result");
  });

  it("[MOUNTED_BEHAVIOR] an invalid second user action cannot supersede an in-flight request", async () => {
    const monitors = await mountUnlocked();
    const pending = deferred<Response>();
    monitors.fetchMock.mockImplementationOnce(() => pending.promise);

    await enterSourceUrl();
    await act(async () => previewButton().click());
    await flushAsyncWork();
    expect(container.textContent).toContain("抓取中");
    previewButton("抓取中…").click();

    expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
    pending.resolve(jsonResponse(previewSuccess([candidate("Only Started Result")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("Only Started Result");
  });

  it("[MOUNTED_BEHAVIOR] allows two same-turn previews and lets only the newer request settle loading", async () => {
    const monitors = await mountUnlocked();
    const first = deferred<Response>();
    const second = deferred<Response>();
    monitors.fetchMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    await enterSourceUrl();
    const button = previewButton();
    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    expect(monitors.fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("抓取中");

    first.resolve(jsonResponse(previewSuccess([candidate("First Result")])));
    await flushAsyncWork();

    expect(container.textContent).not.toContain("First Result");
    expect(container.textContent).toContain("抓取中");

    second.resolve(jsonResponse(previewSuccess([candidate("Second Result")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("Second Result");
    expect(container.textContent).not.toContain("First Result");
    expect(container.textContent).not.toContain("抓取中");
  });

  it("[MOUNTED_BEHAVIOR] ignores an older response after a newer error", async () => {
    const monitors = await mountUnlocked();
    const older = deferred<Response>();
    const newer = deferred<Response>();
    monitors.fetchMock
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    await enterSourceUrl();
    const button = previewButton();
    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    newer.resolve(jsonResponse({
      ok: false,
      error: { code: "upstream_failed", message: "Newer request failed." },
    }, 500));
    await flushAsyncWork();
    expect(container.textContent).toContain("Newer request failed.");

    older.resolve(jsonResponse(previewSuccess(
      [candidate("Older Result")],
      ["https://example.com/older: timeout [timeout]"],
    )));
    await flushAsyncWork();

    expect(container.textContent).not.toContain("Older Result");
    expect(container.textContent).not.toContain("请求超时");
    expect(container.textContent).toContain("Newer request failed.");
  });

  it("[TIMING_BEHAVIOR] prevents an older same-URL response from overwriting a newer success", async () => {
    const monitors = await mountUnlocked();
    const older = deferred<Response>();
    const newer = deferred<Response>();
    monitors.fetchMock
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    await enterSourceUrl();
    const button = previewButton();
    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    expect(monitors.fetchMock).toHaveBeenCalledTimes(2);

    newer.resolve(jsonResponse(previewSuccess([candidate("Newer Result")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("Newer Result");

    older.resolve(jsonResponse(previewSuccess([candidate("Older Result")])));
    await flushAsyncWork();
    expect(container.textContent).not.toContain("Older Result");
    expect(container.textContent).toContain("Newer Result");
  });

  it("[TIMING_BEHAVIOR] ignores request A success when request B later fails", async () => {
    const monitors = await mountUnlocked();
    const requestA = deferred<Response>();
    const requestB = deferred<Response>();
    monitors.fetchMock
      .mockImplementationOnce(() => requestA.promise)
      .mockImplementationOnce(() => requestB.promise);

    const requestAInput = SOURCE_URL;
    const requestBInput = SOURCE_URL;
    await enterSourceUrl(requestAInput);
    const button = previewButton();
    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    expect(monitors.fetchMock).toHaveBeenCalledTimes(2);
    expect(monitors.fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/opportunities/source-import",
      "/api/opportunities/source-import",
    ]);
    expect(monitors.fetchMock.mock.calls.map((call) => JSON.parse(
      String((call[1] as RequestInit).body),
    ).input)).toEqual([requestAInput, requestBInput]);
    expect(container.textContent).toContain("抓取中");

    requestA.resolve(jsonResponse(previewSuccess(
      [candidate("Request A Result")],
      ["request A warning"],
    )));
    await flushAsyncWork();

    expect(container.textContent).not.toContain("Request A Result");
    expect(container.textContent).not.toContain("request A warning");
    expect(container.textContent).toContain("抓取中");
    expect(container.textContent).not.toContain("Request B failed.");

    requestB.resolve(jsonResponse({
      ok: false,
      error: { code: "upstream_failed", message: "Request B failed." },
    }, 500));
    await flushAsyncWork();

    expect(container.textContent).not.toContain("Request A Result");
    expect(container.textContent).not.toContain("request A warning");
    expect(container.textContent).toContain("Request B failed.");
    expect(container.textContent).not.toContain("抓取中");
    expect(monitors.fetchMock.mock.calls.filter(
      ([url]) => url === "/api/opportunity-candidates" || String(url).startsWith("/api/tasks"),
    )).toHaveLength(0);
    expect(monitors.localStorageWrite).not.toHaveBeenCalled();
    expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();
  });

  it("[TIMING_BEHAVIOR] keeps a newer success and ignores an older same-URL error", async () => {
    const monitors = await mountUnlocked();
    const older = deferred<Response>();
    const newer = deferred<Response>();
    monitors.fetchMock
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    await enterSourceUrl();
    const button = previewButton();
    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    newer.resolve(jsonResponse(previewSuccess([candidate("Newer Success")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("Newer Success");

    older.resolve(jsonResponse({
      ok: false,
      error: { code: "upstream_failed", message: "Older request failed." },
    }, 500));
    await flushAsyncWork();

    expect(container.textContent).toContain("Newer Success");
    expect(container.textContent).not.toContain("Older request failed.");
  });

  it("[TIMING_BEHAVIOR] blocks a different-URL user request while the first preview is loading", async () => {
    const monitors = await mountUnlocked();
    const pending = deferred<Response>();
    monitors.fetchMock.mockImplementationOnce(() => pending.promise);

    await enterSourceUrl("https://example.com/older.xml");
    await act(async () => previewButton().click());
    await enterSourceUrl("https://example.com/newer.xml");
    await act(async () => previewButton("抓取中…").click());

    expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(
      String((monitors.fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ).input).toBe("https://example.com/older.xml");

    pending.resolve(jsonResponse(previewSuccess([candidate("Only Result")])));
    await flushAsyncWork();
    expect(container.textContent).toContain("Only Result");
  });

  it("[MOUNTED_BEHAVIOR] does not abort an in-flight preview when the component unmounts", async () => {
    const monitors = await mountUnlocked();
    const pending = deferred<Response>();
    monitors.fetchMock.mockImplementationOnce(() => pending.promise);

    await enterSourceUrl();
    await act(async () => previewButton().click());
    const requestInit = monitors.fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit.signal).toBeUndefined();

    await act(async () => root?.unmount());
    root = null;
    pending.resolve(jsonResponse(previewSuccess([candidate("Unmounted Result")])));
    await flushAsyncWork();

    expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("");
  });

  it("[STRUCTURAL] routes only preview request and parsing through the client adapter", () => {
    const formSource = readFileSync(
      new URL("./OpportunitiesForm.tsx", import.meta.url),
      "utf8",
    );
    const adapterSource = readFileSync(
      new URL("../../lib/client/sourceImportPreview.ts", import.meta.url),
      "utf8",
    );

    expect(formSource.match(/requestSourceImportPreview\(/g)).toHaveLength(1);
    expect(formSource).not.toContain('fetch("/api/opportunities/source-import"');
    expect(formSource).toContain("}, [sourceImportUrls, accessPassword]);");
    expect(adapterSource.match(/fetch\("\/api\/opportunities\/source-import"/g)).toHaveLength(1);
    expect(adapterSource).not.toContain("/api/opportunity-candidates");
    expect(adapterSource).not.toContain("/api/tasks");
    expect(adapterSource).not.toMatch(/localStorage|sessionStorage|useState|useEffect|useCallback/);
  });
});
