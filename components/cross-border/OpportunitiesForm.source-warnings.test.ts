import { act, createElement } from "react";
import type { ComponentType } from "react";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";
import { setStoredAccessPassword } from "@/lib/client/accessPassword";
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

const WARNING_CARD_CLASS = "rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs";
const SOURCE_WARNINGS = [
  "https://example.com/feed: timeout [timeout]",
  "纯文本 warning",
  "https://example.com/odd: unusual response [nonexistent_reason]",
  "https://example.com/literal: original warning [unknown]",
  "中文与特殊字符 !@#$%^&*()",
] as const;

function jsonResponse(warnings: readonly string[]) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({
      ok: true,
      candidates: [],
      summary: {
        totalUrls: 1,
        okUrls: 0,
        failedUrls: 1,
        totalCandidates: 0,
      },
      warnings: [...warnings],
    }),
  };
}

describe("OpportunitiesForm source warning presentation", () => {
  let dom: TestDom;
  let container: TestElement;
  let root: Root | null;

  beforeEach(() => {
    dom = installTestDom();
    setStoredAccessPassword("phase2d-test-access");
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

  async function mountUnlocked(surface: "legacy_default" | "advanced_import") {
    const fetchMock = vi.fn().mockRejectedValue(new Error("phase2d_isolated_network"));
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
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fetchMock.mockReset();
    localStorageWrite.mockClear();
    sessionStorageWrite.mockClear();
    await act(async () => findByText(container, "button", "添加候选").click());

    return { fetchMock, localStorageWrite, sessionStorageWrite };
  }

  async function submitWarnings(
    fetchMock: ReturnType<typeof vi.fn>,
    warnings: readonly string[],
  ) {
    fetchMock.mockResolvedValueOnce(jsonResponse(warnings));
    const sourceInput = findAll(
      container,
      (element) => element.localName === "textarea"
        && element.getAttribute("placeholder")?.startsWith("https://example.com/rss") === true,
    )[0];
    if (!sourceInput) throw new Error("source_warning_input_not_found");

    setNativeValue(sourceInput, "https://example.com/feed");
    await act(async () => sourceInput.dispatchEvent(new TestEvent("input")));
    await act(async () => {
      findByText(container, "button", "抓取公开来源").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it.each(["legacy_default", "advanced_import"] as const)(
    "[MOUNTED_BEHAVIOR] preserves warning labels, fallback text, order, and no-link behavior on %s",
    async (surface) => {
      const monitors = await mountUnlocked(surface);
      await submitWarnings(monitors.fetchMock, SOURCE_WARNINGS);

      const cards = findAll(
        container,
        (element) => element.getAttribute("class") === WARNING_CARD_CLASS,
      );
      expect(cards).toHaveLength(SOURCE_WARNINGS.length);

      expect(cards[0].textContent).toContain("请求超时");
      expect(cards[0].textContent).toContain("来源响应过慢，超过当前等待限制。");
      expect(cards[0].textContent).toContain("建议换用响应更快的来源，或稍后重试。");
      expect(cards[0].textContent).toContain("https://example.com/feed: timeout");
      expect(cards[0].textContent).not.toContain("[timeout]");

      expect(cards[1].textContent).toBe("纯文本 warning");

      expect(cards[2].textContent).toContain("未知原因");
      expect(cards[2].textContent).toContain("https://example.com/odd: unusual response");
      expect(cards[2].textContent).not.toContain("[nonexistent_reason]");

      expect(cards[3].textContent).toBe(
        "https://example.com/literal: original warning [unknown]",
      );
      expect(cards[4].textContent).toBe("中文与特殊字符 !@#$%^&*()");

      for (const card of cards) {
        expect(findAll(card, (element) => element.localName === "a")).toHaveLength(0);
      }

      expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
      expect(monitors.fetchMock).toHaveBeenCalledWith(
        "/api/opportunities/source-import",
        expect.objectContaining({ method: "POST" }),
      );
      expect(monitors.localStorageWrite).not.toHaveBeenCalled();
      expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();
    },
  );

  it.each(["legacy_default", "advanced_import"] as const)(
    "[MOUNTED_BEHAVIOR] renders no warning cards when the response has no warnings on %s",
    async (surface) => {
      const monitors = await mountUnlocked(surface);
      await submitWarnings(monitors.fetchMock, []);

      expect(findAll(
        container,
        (element) => element.getAttribute("class") === WARNING_CARD_CLASS,
      )).toHaveLength(0);
      expect(monitors.fetchMock).toHaveBeenCalledTimes(1);
      expect(monitors.localStorageWrite).not.toHaveBeenCalled();
      expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();
    },
  );

  it("[SSR_RENDERED] keeps source warnings absent from the locked surfaces", () => {
    const defaultMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent));
    const advancedMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
      surface: "advanced_import",
    }));

    for (const markup of [defaultMarkup, advancedMarkup]) {
      expect(markup).not.toContain(WARNING_CARD_CLASS);
      expect(markup).not.toContain("请求超时");
    }
  });

  it("[STRUCTURAL] routes the sole warning consumer through the shared display model", () => {
    const source = readFileSync(
      new URL("./OpportunitiesForm.tsx", import.meta.url),
      "utf8",
    );

    expect(source.match(/buildSourceWarningDisplayModel\(/g)).toHaveLength(1);
    expect(source).not.toContain("const reasonKey = extractFailureReason(w)");
    expect(source).not.toContain("const urlMatch = w.match(");
    expect(source).not.toContain("const messageText = w.replace(");
  });
});
