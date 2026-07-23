import { act, createElement } from "react";
import type { ComponentType } from "react";
import type { Root } from "react-dom/client";
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

type AccessMode = "owner" | "demo";
type Surface = "legacy_default" | "advanced_import";
type CapturedRequest = {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly credentials: RequestCredentials | undefined;
  readonly body: string | undefined;
};

const OWNER_ACCESS = "phase3c-owner-placeholder";
const VISITOR_ACCESS = "phase3c-visitor-placeholder";
const SOURCE_URL = "https://example.com/feed.xml";
const SOURCE_INPUT_PLACEHOLDER_PREFIX = "https://example.com/rss";

const sourceEvidence = {
  version: "candidate-source-v2" as const,
  evidenceId: "phase3c-confirm-evidence",
  origin: "public_url" as const,
  capturedAt: "2026-07-24T00:00:00.000Z",
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

const reviewAssessment = {
  version: "candidate-rule-v1" as const,
  algorithm: "radar-evidence-v2",
  evidenceHash: "a".repeat(64),
  computedAt: "2026-07-24T00:00:00.000Z",
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

function previewCandidate(overrides: Record<string, unknown> = {}) {
  return {
    title: "Widget Stand",
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
    ruleAssessment: reviewAssessment,
    sourceProof: "sourceproof_v1.phase3c.synthetic",
    ...overrides,
  };
}

function previewSuccess(
  candidates: readonly ReturnType<typeof previewCandidate>[],
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

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => payload,
  } as unknown as Response;
}

function nonJsonBodyResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "text/html; charset=utf-8" },
    json: async () => {
      throw new Error("phase3c_non_json_body");
    },
  } as unknown as Response;
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

function requestHeaders(init?: RequestInit): Readonly<Record<string, string>> {
  if (!init?.headers) return {};
  return Object.fromEntries(new Headers(init.headers).entries());
}

function createFetchHarness() {
  type Planned = {
    readonly method: string;
    readonly url: string;
    readonly respond: () => Response | Promise<Response>;
  };
  const planned: Planned[] = [];
  const requests: CapturedRequest[] = [];
  const unregistered: CapturedRequest[] = [];

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const captured: CapturedRequest = {
      url,
      method,
      headers: requestHeaders(init),
      credentials: init?.credentials,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    requests.push(captured);
    const index = planned.findIndex((entry) => entry.method === method && entry.url === url);
    if (index < 0) {
      unregistered.push(captured);
      throw new Error(`phase3c_unregistered_request:${method}:${url}`);
    }
    const [entry] = planned.splice(index, 1);
    return entry.respond();
  });

  return {
    fetchMock,
    requests,
    unregistered,
    plan(method: string, url: string, response: Response | Promise<Response>) {
      planned.push({
        method,
        url,
        respond: () => response,
      });
    },
    planFactory(method: string, url: string, respond: () => Response | Promise<Response>) {
      planned.push({ method, url, respond });
    },
    requestsFor(method: string, url?: string) {
      return requests.filter((request) => (
        request.method === method && (url === undefined || request.url === url)
      ));
    },
    pendingPlans() {
      return planned.map((entry) => `${entry.method}:${entry.url}`);
    },
  };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("OpportunitiesForm source confirm command", () => {
  let dom: TestDom;
  let container: TestElement;
  let root: Root | null;
  let harness: ReturnType<typeof createFetchHarness>;
  let localStorageWrite: ReturnType<typeof vi.spyOn>;
  let sessionStorageWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dom = installTestDom();
    Object.defineProperty(dom.document.body, "classList", {
      configurable: true,
      value: {
        add: vi.fn(),
        remove: vi.fn(),
      },
    });
    container = dom.document.createElement("div");
    dom.document.body.appendChild(container);
    root = null;
    harness = createFetchHarness();
    vi.stubGlobal("fetch", harness.fetchMock);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    expect(harness.unregistered).toEqual([]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dom.restore();
  });

  function installSyntheticAccess(mode: AccessMode) {
    if (mode === "owner") {
      saveAccessToken(OWNER_ACCESS, "owner");
      return OWNER_ACCESS;
    }
    saveAccessToken(VISITOR_ACCESS, "demo", {
      id: "phase3c-demo-access",
      label: "Phase 3C Visitor",
      expiresAt: null,
      maxAiCalls: 0,
      usedAiCalls: 0,
      remainingAiCalls: 0,
    });
    return VISITOR_ACCESS;
  }

  async function mountUnlocked(options: {
    readonly mode?: AccessMode;
    readonly surface?: Surface;
    readonly initialPool?: readonly Record<string, unknown>[];
    readonly initialPoolFailure?: Error;
  } = {}) {
    const mode = options.mode ?? "owner";
    const surface = options.surface ?? "legacy_default";
    installSyntheticAccess(mode);
    if (options.initialPoolFailure) {
      harness.planFactory(
        "GET",
        "/api/opportunity-candidates?limit=100",
        () => Promise.reject(options.initialPoolFailure),
      );
    } else {
      harness.plan("GET", "/api/opportunity-candidates?limit=100", jsonResponse({
        ok: true,
        items: [...(options.initialPool ?? [])],
      }));
      harness.plan("GET", "/api/tasks?limit=50", jsonResponse({ ok: true, records: [] }));
    }
    localStorageWrite = vi.spyOn(dom.localStorage, "setItem");
    sessionStorageWrite = vi.spyOn(dom.sessionStorage, "setItem");
    const client = await import("react-dom/client");
    root = client.createRoot(container as unknown as Element);

    await act(async () => {
      root?.render(createElement(OpportunitiesFormComponent, { surface }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(harness.requestsFor("GET", "/api/opportunity-candidates?limit=100")).toHaveLength(1);
    expect(harness.requestsFor("GET", "/api/tasks?limit=50")).toHaveLength(
      options.initialPoolFailure ? 0 : 1,
    );
    localStorageWrite.mockClear();
    sessionStorageWrite.mockClear();
    await act(async () => findByText(container, "button", "添加候选").click());
    return { mode, surface };
  }

  async function mountLocked(surface: Surface = "legacy_default") {
    localStorageWrite = vi.spyOn(dom.localStorage, "setItem");
    sessionStorageWrite = vi.spyOn(dom.sessionStorage, "setItem");
    const client = await import("react-dom/client");
    root = client.createRoot(container as unknown as Element);
    await act(async () => {
      root?.render(createElement(OpportunitiesFormComponent, { surface }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsyncWork();
    localStorageWrite.mockClear();
    sessionStorageWrite.mockClear();
  }

  function sourceInput() {
    const input = findAll(
      container,
      (element) => element.localName === "textarea"
        && element.getAttribute("placeholder")?.startsWith(SOURCE_INPUT_PLACEHOLDER_PREFIX) === true,
    )[0];
    if (!input) throw new Error("source_confirm_input_not_found");
    return input;
  }

  async function preparePreview(
    candidates: readonly ReturnType<typeof previewCandidate>[] = [previewCandidate()],
    warnings: readonly string[] = [],
  ) {
    harness.plan(
      "POST",
      "/api/opportunities/source-import",
      jsonResponse(previewSuccess(candidates, warnings)),
    );
    const input = sourceInput();
    setNativeValue(input, SOURCE_URL);
    await act(async () => input.dispatchEvent(new TestEvent("input")));
    await act(async () => findByText(container, "button", "抓取公开来源").click());
    await flushAsyncWork();
    localStorageWrite.mockClear();
    sessionStorageWrite.mockClear();
  }

  async function preparePreviewPayload(payload: unknown) {
    harness.plan(
      "POST",
      "/api/opportunities/source-import",
      jsonResponse(payload),
    );
    const input = sourceInput();
    setNativeValue(input, SOURCE_URL);
    await act(async () => input.dispatchEvent(new TestEvent("input")));
    await act(async () => findByText(container, "button", "抓取公开来源").click());
    await flushAsyncWork();
    localStorageWrite.mockClear();
    sessionStorageWrite.mockClear();
  }

  function confirmButton(count = 1) {
    return findByText(container, "button", `确认导入候选池（${count}）`);
  }

  function clickAsBrowser(element: TestElement) {
    if (!element.hasAttribute("disabled")) element.click();
  }

  function expectNoUnrelatedWrites() {
    expect(harness.requestsFor("POST", "/api/opportunities")).toHaveLength(0);
    expect(harness.requestsFor("POST", "/api/opportunity-candidates/import-local")).toHaveLength(0);
    expect(harness.requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
    expect(harness.requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
    expect(harness.requests.filter((request) => (
      request.method !== "GET" && request.url.startsWith("/api/tasks")
    ))).toHaveLength(0);
    expect(sessionStorageWrite).not.toHaveBeenCalled();
  }

  function expectPreviewStateRetained(title = "Widget Stand") {
    expect(container.textContent).toContain(title);
    expect(container.textContent).toContain("已提取 1 个候选品");
    expect(confirmButton()).not.toBeNull();
  }

  function serverCandidate(id = "candidate-owner-001") {
    return {
      id,
      name: "Widget Stand",
      status: "pending",
      score: 79,
      source: "RSS抓取 · example.com",
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
  }

  async function startTwoSameTurnConfirms() {
    const first = deferred<Response>();
    const second = deferred<Response>();
    harness.plan("POST", "/api/opportunity-candidates", first.promise);
    harness.plan("POST", "/api/opportunity-candidates", second.promise);
    const button = confirmButton();

    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(1);
    return { first, second };
  }

  it.each([
    ["owner", "legacy_default", OWNER_ACCESS],
    ["demo", "advanced_import", VISITOR_ACCESS],
  ] as const)(
    "[REQUEST_CONTRACT][AUTHORIZATION_BEHAVIOR] submits the existing authoritative Candidate payload for %s on %s",
    async (mode, surface, accessToken) => {
      await mountUnlocked({ mode, surface });
      await preparePreview([previewCandidate()], ["phase3c retained success warning"]);
      harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
        ok: true,
        created: 1,
        unchanged: 0,
      }));
      harness.plan("GET", "/api/opportunity-candidates?limit=100", jsonResponse({
        ok: true,
        items: [serverCandidate(`candidate-${mode}-001`)],
      }));

      const button = confirmButton();
      await act(async () => {
        button.click();
        button.click();
        await Promise.resolve();
      });
      await flushAsyncWork();

      const confirmRequests = harness.requestsFor("POST", "/api/opportunity-candidates");
      expect(confirmRequests).toHaveLength(1);
      expect(confirmRequests[0]).toEqual({
        url: "/api/opportunity-candidates",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-access-password": accessToken,
          "x-access-token": accessToken,
        },
        credentials: undefined,
        body: JSON.stringify({
          items: [{
            name: "Widget Stand",
            rawInput: "Widget Stand",
            link: "https://example.com/products/widget",
            score: 79,
            source: "RSS抓取 · example.com",
            keyword: "desk",
            riskLevel: "green",
            riskLabel: "低风险",
            summaryLabel: "候选可评估",
            sourceEvidence,
            ruleAssessment: reviewAssessment,
            sourceProof: "sourceproof_v1.phase3c.synthetic",
          }],
        }),
      });
      expect(harness.requestsFor("GET", "/api/opportunity-candidates?limit=100")).toHaveLength(2);
      expect(container.textContent).toContain("已导入候选池：新增 1 个，已有相同来源 0 个。");
      expect(container.textContent).toContain("Widget Stand");
      expect(container.textContent).toContain("phase3c retained success warning");
      expectPreviewStateRetained();
      expect(localStorageWrite).toHaveBeenCalled();
      expectNoUnrelatedWrites();
    },
  );

  it.each(["legacy_default", "advanced_import"] as const)(
    "[AUTHORIZATION_BEHAVIOR] keeps Confirm unavailable while the %s surface is locked",
    async (surface) => {
      await mountLocked(surface);

      expect(container.textContent).not.toContain("确认导入候选池");
      expect(harness.requests).toHaveLength(0);
      expect(localStorageWrite).not.toHaveBeenCalled();
      expect(sessionStorageWrite).not.toHaveBeenCalled();
    },
  );

  it("[MOUNTED_BEHAVIOR] exposes no Confirm action before a preview exists", async () => {
    await mountUnlocked();

    expect(container.textContent).not.toContain("确认导入候选池");
    expect(harness.requestsFor("POST")).toHaveLength(0);

    await preparePreview();
    harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
      ok: false,
      error: { message: "valid after missing preview" },
    }, 409));
    await act(async () => confirmButton().click());
    await flushAsyncWork();

    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(1);
    expect(container.textContent).toContain("valid after missing preview");
    expectNoUnrelatedWrites();
  });

  it("[MOUNTED_BEHAVIOR] blocks Confirm when the server Candidate pool is unavailable", async () => {
    await mountUnlocked({ initialPoolFailure: new Error("synthetic pool failure") });
    await preparePreview();

    expect(confirmButton().hasAttribute("disabled")).toBe(true);
    await act(async () => clickAsBrowser(confirmButton()));
    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(0);
    expect(container.textContent).toContain("候选池服务端读取失败");
    expectNoUnrelatedWrites();
  });

  it("[MOUNTED_BEHAVIOR] keeps a saveable watch Candidate unselected until the user checks it", async () => {
    await mountUnlocked();
    await preparePreview([previewCandidate({
      ruleAssessment: {
        ...reviewAssessment,
        queueSuggestion: "watch",
      },
    })]);

    expect(confirmButton(0).hasAttribute("disabled")).toBe(true);
    const checkbox = findAll(
      container,
      (element) => element.localName === "input" && element.type === "checkbox",
    )[0];
    if (!checkbox) throw new Error("source_confirm_checkbox_not_found");
    expect(checkbox.hasAttribute("disabled")).toBe(false);
    await act(async () => checkbox.click());
    expect(confirmButton().hasAttribute("disabled")).toBe(false);
    harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
      ok: false,
      error: { message: "valid after selection" },
    }, 409));
    await act(async () => confirmButton().click());
    await flushAsyncWork();
    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(1);
    expect(container.textContent).toContain("valid after selection");
    expectNoUnrelatedWrites();
  });

  it("[MOUNTED_BEHAVIOR] rejects a non-saveable preview Candidate before Confirm", async () => {
    await mountUnlocked();
    await preparePreview([previewCandidate({
      ruleAssessment: {
        ...reviewAssessment,
        queueSuggestion: "reject",
      },
    })]);

    expect(confirmButton(0).hasAttribute("disabled")).toBe(true);
    const checkbox = findAll(
      container,
      (element) => element.localName === "input" && element.type === "checkbox",
    )[0];
    if (!checkbox) throw new Error("source_confirm_checkbox_not_found");
    expect(checkbox.hasAttribute("disabled")).toBe(true);
    await act(async () => clickAsBrowser(confirmButton(0)));
    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(0);
    expectNoUnrelatedWrites();
  });

  it("[REQUEST_CONTRACT] preserves the current nullable source URL in Confirm input", async () => {
    await mountUnlocked();
    await preparePreview([previewCandidate({ sourceUrl: "" })]);
    harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
      ok: true,
      created: 1,
      unchanged: 0,
    }));
    harness.plan("GET", "/api/opportunity-candidates?limit=100", jsonResponse({
      ok: true,
      items: [serverCandidate()],
    }));

    await act(async () => confirmButton().click());
    await flushAsyncWork();

    const body = JSON.parse(
      harness.requestsFor("POST", "/api/opportunity-candidates")[0].body ?? "{}",
    ) as { items?: Array<{ link?: unknown }> };
    expect(body.items?.[0]?.link).toBeNull();
    expect(container.textContent).toContain("已导入候选池：新增 1 个");
    expectNoUnrelatedWrites();
  });

  it("[MOUNTED_BEHAVIOR] exposes no Confirm action when a malformed success omits summary", async () => {
    await mountUnlocked();
    await preparePreviewPayload({
      ok: true,
      candidates: [previewCandidate()],
      warnings: [],
    });

    expect(container.textContent).not.toContain("确认导入候选池");
    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(0);
    expectNoUnrelatedWrites();
  });

  it("[MOUNTED_BEHAVIOR] treats missing success counters and unrelated payload fields as zero", async () => {
    await mountUnlocked();
    await preparePreview();
    harness.plan("POST", "/api/opportunity-candidates", jsonResponse({ ok: true }));
    harness.plan("GET", "/api/opportunity-candidates?limit=100", jsonResponse({
      ok: true,
      items: [serverCandidate()],
    }));

    await act(async () => confirmButton().click());
    await flushAsyncWork();

    expect(container.textContent).toContain("已导入候选池：新增 0 个，已有相同来源 0 个。");
    expectPreviewStateRetained();
    expectNoUnrelatedWrites();
  });

  it("[MOUNTED_BEHAVIOR] reports an unchanged server Candidate as a successful Confirm", async () => {
    await mountUnlocked();
    await preparePreview();
    harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
      ok: true,
      created: 0,
      unchanged: 1,
    }));
    harness.plan("GET", "/api/opportunity-candidates?limit=100", jsonResponse({
      ok: true,
      items: [serverCandidate("candidate-existing-001")],
    }));

    await act(async () => confirmButton().click());
    await flushAsyncWork();

    expect(container.textContent).toContain("候选已在池中，来源一致，无需重复导入。");
    expect(harness.requestsFor("GET", "/api/opportunity-candidates?limit=100")).toHaveLength(2);
    expectNoUnrelatedWrites();
  });

  it("[MOUNTED_BEHAVIOR] keeps the preview and success fact when refresh returns an empty pool", async () => {
    await mountUnlocked();
    await preparePreview();
    harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
      ok: true,
      created: 1,
      unchanged: 0,
    }));
    harness.plan("GET", "/api/opportunity-candidates?limit=100", jsonResponse({
      ok: true,
      items: [],
    }));

    await act(async () => confirmButton().click());
    await flushAsyncWork();

    expect(container.textContent).toContain("已导入候选池：新增 1 个，已有相同来源 0 个。");
    expectPreviewStateRetained();
    expect(container.textContent).toContain("还没有候选品");
    expectNoUnrelatedWrites();
  });

  it.each([
    ["HTTP failure", () => jsonResponse({ ok: false, error: { message: "refresh failed" } }, 500)],
    ["network failure", () => Promise.reject(new Error("refresh network failed"))],
    ["non-JSON failure", () => nonJsonBodyResponse(502)],
  ] as const)(
    "[MOUNTED_BEHAVIOR] preserves the write-success fact after refresh %s",
    async (_label, refreshResponse) => {
      await mountUnlocked();
      await preparePreview();
      harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
        ok: true,
        created: 1,
        unchanged: 0,
      }));
      harness.planFactory(
        "GET",
        "/api/opportunity-candidates?limit=100",
        refreshResponse,
      );

      await act(async () => confirmButton().click());
      await flushAsyncWork();

      expect(container.textContent).toContain(
        "已导入服务端，但刷新候选池失败，请手动刷新页面查看。",
      );
      expect(container.textContent).not.toContain("导入失败，请稍后重试。");
      expectPreviewStateRetained();
      expect(confirmButton().hasAttribute("disabled")).toBe(false);
      expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(1);

      harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
        ok: false,
        error: { message: "retry after refresh failure" },
      }, 409));
      await act(async () => confirmButton().click());
      await flushAsyncWork();

      expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(2);
      expect(container.textContent).toContain("retry after refresh failure");
      expectNoUnrelatedWrites();
    },
  );

  const confirmErrorCases = [
    {
      label: "200 business error",
      respond: () => jsonResponse({ ok: false, error: { message: "business rejected" } }),
      expected: "business rejected",
    },
    {
      label: "200 empty payload",
      respond: () => jsonResponse(null),
      expected: "导入失败，请稍后重试。",
    },
    {
      label: "200 non-JSON",
      respond: () => nonJsonBodyResponse(200),
      expected: "导入失败，请稍后重试。",
    },
    {
      label: "204",
      respond: () => jsonResponse(null, 204),
      expected: "导入失败，请稍后重试。",
    },
    ...[400, 401, 403, 404, 409, 422, 429, 500, 502].map((status) => ({
      label: String(status),
      respond: () => jsonResponse({
        ok: false,
        error: { message: `confirm status ${status}` },
      }, status),
      expected: `confirm status ${status}`,
    })),
    {
      label: "network rejection",
      respond: () => Promise.reject(new TypeError("Failed to fetch")),
      expected: "Failed to fetch",
    },
    {
      label: "ordinary Error",
      respond: () => Promise.reject(new Error("synthetic confirm failure")),
      expected: "synthetic confirm failure",
    },
    {
      label: "AbortError",
      respond: () => Promise.reject(new DOMException("synthetic confirm abort", "AbortError")),
      expected: "synthetic confirm abort",
    },
  ];

  it.each(confirmErrorCases)(
    "[REQUEST_CONTRACT] freezes the current Confirm error fallback for $label",
    async ({ respond, expected }) => {
      await mountUnlocked();
      await preparePreview([previewCandidate()], ["phase3c retained warning"]);
      harness.planFactory("POST", "/api/opportunity-candidates", respond);

      await act(async () => confirmButton().click());
      await flushAsyncWork();

      expect(container.textContent).toContain(expected);
      expect(container.textContent).toContain("phase3c retained warning");
      expectPreviewStateRetained();
      expect(confirmButton().hasAttribute("disabled")).toBe(false);
      expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(1);
      expect(harness.requestsFor("GET", "/api/opportunity-candidates?limit=100")).toHaveLength(1);
      expect(localStorageWrite).not.toHaveBeenCalled();

      harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
        ok: false,
        error: { message: "retry after confirm failure" },
      }, 409));
      await act(async () => confirmButton().click());
      await flushAsyncWork();

      expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(2);
      expect(container.textContent).toContain("retry after confirm failure");
      expectNoUnrelatedWrites();
    },
  );

  it("[TIMING_BEHAVIOR] allows only one Candidate write for two same-turn public button clicks", async () => {
    await mountUnlocked();
    await preparePreview([previewCandidate()], ["phase3d retained warning"]);
    const first = deferred<Response>();
    const second = deferred<Response>();
    harness.plan("POST", "/api/opportunity-candidates", first.promise);
    harness.plan("POST", "/api/opportunity-candidates", second.promise);

    const button = confirmButton();
    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    const candidatePostCount = harness.requestsFor("POST", "/api/opportunity-candidates").length;
    expect(container.textContent).toContain("phase3d retained warning");
    expect(container.textContent).toContain("Widget Stand");
    expect(container.textContent).toContain("已提取 1 个候选品");
    expect(findAll(
      container,
      (element) => element.localName === "input" && element.type === "checkbox",
    )[0]?.checked).toBe(true);
    expect(localStorageWrite).not.toHaveBeenCalled();
    first.resolve(jsonResponse({ ok: false, error: { message: "first failed" } }, 409));
    second.resolve(jsonResponse({ ok: false, error: { message: "second failed" } }, 409));
    await flushAsyncWork();
    expect(candidatePostCount).toBe(1);
    expect(container.textContent).toContain("first failed");
    expectNoUnrelatedWrites();
  });

  it("[TIMING_BEHAVIOR] blocks another public click after the saving state reaches the DOM", async () => {
    await mountUnlocked();
    await preparePreview();
    const pending = deferred<Response>();
    harness.plan("POST", "/api/opportunity-candidates", pending.promise);

    const button = confirmButton();
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    const savingButton = findByText(container, "button", "导入中…");
    expect(savingButton.hasAttribute("disabled")).toBe(true);
    await act(async () => clickAsBrowser(savingButton));
    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(1);

    pending.resolve(jsonResponse({ ok: false, error: { message: "controlled failure" } }, 409));
    await flushAsyncWork();
    expect(confirmButton().hasAttribute("disabled")).toBe(false);
    expect(container.textContent).toContain("controlled failure");
    expectNoUnrelatedWrites();
  });

  it("[TIMING_BEHAVIOR] releases single-flight after a successful write and refresh", async () => {
    await mountUnlocked();
    await preparePreview();
    harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
      ok: true,
      created: 1,
      unchanged: 0,
    }));
    harness.plan("GET", "/api/opportunity-candidates?limit=100", jsonResponse({
      ok: true,
      items: [serverCandidate("candidate-first-success")],
    }));

    await act(async () => confirmButton().click());
    await flushAsyncWork();
    expect(confirmButton().hasAttribute("disabled")).toBe(false);
    expect(container.textContent).toContain("已导入候选池：新增 1 个");

    harness.plan("POST", "/api/opportunity-candidates", jsonResponse({
      ok: false,
      error: { message: "second controlled failure" },
    }, 409));
    await act(async () => confirmButton().click());
    await flushAsyncWork();

    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(2);
    expect(container.textContent).toContain("second controlled failure");
    expectNoUnrelatedWrites();
  });

  const sameTurnSingleFlightCases = [
    { first: "success", blocked: "success", order: ["first", "blocked"] },
    { first: "success", blocked: "success", order: ["blocked", "first"] },
    { first: "success", blocked: "failure", order: ["first", "blocked"] },
    { first: "success", blocked: "failure", order: ["blocked", "first"] },
    { first: "failure", blocked: "success", order: ["first", "blocked"] },
    { first: "failure", blocked: "success", order: ["blocked", "first"] },
    { first: "failure", blocked: "failure", order: ["first", "blocked"] },
    { first: "failure", blocked: "failure", order: ["blocked", "first"] },
  ] as const;

  it.each(sameTurnSingleFlightCases)(
    "[TIMING_BEHAVIOR] keeps same-turn first=$first authoritative and blocked=$blocked inert with $order resolution",
    async ({ first: firstOutcome, blocked: blockedOutcome, order }) => {
      await mountUnlocked();
      await preparePreview();
      const pending = await startTwoSameTurnConfirms();
      if (firstOutcome === "success") {
        harness.plan("GET", "/api/opportunity-candidates?limit=100", jsonResponse({
          ok: true,
          items: [serverCandidate("candidate-first-race")],
        }));
      }
      const outcomes = { first: firstOutcome, blocked: blockedOutcome } as const;
      const controls = {
        first: pending.first,
        blocked: pending.second,
      };

      for (const key of order) {
        const outcome = outcomes[key];
        if (outcome === "success") {
          controls[key].resolve(jsonResponse({
            ok: true,
            created: 1,
            unchanged: 0,
          }));
        } else {
          controls[key].resolve(jsonResponse({
            ok: false,
            error: { message: `${key} race failure` },
          }, 409));
        }
        await flushAsyncWork();
      }

      if (firstOutcome === "success") {
        expect(container.textContent).toContain("已导入候选池：新增 1 个");
      } else {
        expect(container.textContent).toContain("first race failure");
      }
      expect(container.textContent).not.toContain("blocked race failure");
      expect(confirmButton().hasAttribute("disabled")).toBe(false);
      expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(1);
      expect(harness.requestsFor("GET", "/api/opportunity-candidates?limit=100")).toHaveLength(
        1 + Number(firstOutcome === "success"),
      );
      expect(harness.pendingPlans()).toContain("POST:/api/opportunity-candidates");
      expectNoUnrelatedWrites();
    },
  );

  it("[TIMING_BEHAVIOR] blocks another Confirm while the first write is waiting for refresh", async () => {
    await mountUnlocked();
    await preparePreview();
    const pending = await startTwoSameTurnConfirms();
    const firstRefresh = deferred<Response>();
    harness.plan("GET", "/api/opportunity-candidates?limit=100", firstRefresh.promise);

    pending.first.resolve(jsonResponse({ ok: true, created: 1, unchanged: 0 }));
    await flushAsyncWork();
    expect(harness.requestsFor("GET", "/api/opportunity-candidates?limit=100")).toHaveLength(2);
    expect(container.textContent).not.toContain("已导入候选池：新增 1 个");

    pending.second.resolve(jsonResponse({
      ok: false,
      error: { message: "blocked failed while first refreshes" },
    }, 409));
    await flushAsyncWork();
    expect(findByText(container, "button", "导入中…").hasAttribute("disabled")).toBe(true);
    expect(container.textContent).not.toContain("blocked failed while first refreshes");
    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(1);

    firstRefresh.resolve(jsonResponse({
      ok: true,
      items: [serverCandidate("candidate-first-refresh")],
    }));
    await flushAsyncWork();
    expect(container.textContent).toContain("已导入候选池：新增 1 个");
    expect(confirmButton().hasAttribute("disabled")).toBe(false);
    expectNoUnrelatedWrites();
  });

  it("[TIMING_BEHAVIOR] prevents a blocked duplicate from starting a competing refresh", async () => {
    await mountUnlocked();
    await preparePreview();
    const pending = await startTwoSameTurnConfirms();
    const firstRefresh = deferred<Response>();
    harness.plan("GET", "/api/opportunity-candidates?limit=100", firstRefresh.promise);

    pending.first.resolve(jsonResponse({ ok: true, created: 1, unchanged: 0 }));
    await flushAsyncWork();
    pending.second.resolve(jsonResponse({ ok: true, created: 1, unchanged: 0 }));
    await flushAsyncWork();

    firstRefresh.reject(new Error("first refresh failed"));
    await flushAsyncWork();
    expect(container.textContent).toContain(
      "已导入服务端，但刷新候选池失败，请手动刷新页面查看。",
    );
    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(1);
    expect(harness.requestsFor("GET", "/api/opportunity-candidates?limit=100")).toHaveLength(2);
    expectNoUnrelatedWrites();
  });

  it("[TIMING_BEHAVIOR] does not abort Confirm and still starts refresh after unmount", async () => {
    await mountUnlocked();
    await preparePreview();
    const pending = deferred<Response>();
    harness.plan("POST", "/api/opportunity-candidates", pending.promise);
    harness.plan("GET", "/api/opportunity-candidates?limit=100", jsonResponse({
      ok: true,
      items: [serverCandidate("candidate-after-unmount")],
    }));

    await act(async () => confirmButton().click());
    await act(async () => root?.unmount());
    root = null;
    pending.resolve(jsonResponse({ ok: true, created: 1, unchanged: 0 }));
    await flushAsyncWork();

    expect(harness.requestsFor("POST", "/api/opportunity-candidates")).toHaveLength(1);
    expect(harness.requestsFor("GET", "/api/opportunity-candidates?limit=100")).toHaveLength(2);
    expectNoUnrelatedWrites();
  });
});
