import { act, createElement } from "react";
import type { ComponentType } from "react";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";
import { setStoredAccessPassword } from "@/lib/client/accessPassword";
import {
  findAll,
  findByText,
  installTestDom,
  type TestDom,
  type TestElement,
} from "@/tests/helpers/minimal-react-dom";

type OpportunitiesFormProps = NonNullable<Parameters<typeof OpportunitiesForm>[0]>;
const OpportunitiesFormComponent = OpportunitiesForm as ComponentType<OpportunitiesFormProps>;

const EXPECTED_TIER_TEXT = [
  "推荐来源 · 当前最稳定，可直接获取产品相关候选",
  "半可用来源 · 可提供榜单/类目/商品线索，可能含噪音需人工复核",
  "趋势参考来源 · 可作为趋势或话题信号，不是商品候选",
  "暂不支持来源 · 当前 Alpha 不处理，不建议继续尝试",
] as const;

describe("OpportunitiesForm source availability behavior", () => {
  let dom: TestDom;
  let container: TestElement;
  let root: Root | null;

  beforeEach(() => {
    dom = installTestDom();
    setStoredAccessPassword("phase1d-test-access");
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
    const fetchMock = vi.fn().mockRejectedValue(new Error("phase1d_isolated_network"));
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

    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockClear();
    localStorageWrite.mockClear();
    sessionStorageWrite.mockClear();
    return { fetchMock, localStorageWrite, sessionStorageWrite };
  }

  function expectAvailabilityContract(details: TestElement) {
    const text = details.textContent;
    let previousIndex = -1;
    for (const expected of EXPECTED_TIER_TEXT) {
      const index = text.indexOf(expected);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(text).toContain("优先使用，候选质量稳定，适合日常找品参考。");
    expect(text).toContain("仅适合了解趋势话题，不能直接生成商品候选。");
    expect(text).toContain("当前 Alpha 不会绕过。");
  }

  it.each([
    ["legacy_default", ["机会雷达"]],
    ["advanced_import", ["高级工具", "手工导入外部来源"]],
  ] as const)("mounts the collapsed disclosure on %s without business I/O", async (surface, titleParts) => {
    const monitors = await mountUnlocked(surface);
    for (const titlePart of titleParts) expect(container.textContent).toContain(titlePart);
    expect(container.textContent).not.toContain("来源可用性说明");

    await act(async () => findByText(container, "button", "添加候选").click());

    const details = findAll(container, (element) => element.localName === "details")[0];
    const summary = findByText(container, "summary", "来源可用性说明");
    expect(details).toBeDefined();
    expect(details.hasAttribute("open")).toBe(false);
    expectAvailabilityContract(details);
    expect(monitors.fetchMock).not.toHaveBeenCalled();
    expect(monitors.localStorageWrite).not.toHaveBeenCalled();
    expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();

    await act(async () => summary.click());
    expect(details.hasAttribute("open")).toBe(true);
    expect(monitors.fetchMock).not.toHaveBeenCalled();
    expect(monitors.localStorageWrite).not.toHaveBeenCalled();
    expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();

    await act(async () => summary.click());
    expect(details.hasAttribute("open")).toBe(false);
    expect(monitors.fetchMock).not.toHaveBeenCalled();
    expect(monitors.localStorageWrite).not.toHaveBeenCalled();
    expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();
  });

  it("keeps source availability absent from the locked public SSR surface", () => {
    const markup = renderToStaticMarkup(createElement(OpportunitiesFormComponent));
    expect(markup).toContain("功能预览");
    expect(markup).not.toContain("来源可用性说明");
  });
});
