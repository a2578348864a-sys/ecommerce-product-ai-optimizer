import { act, createElement } from "react";
import type { ComponentType } from "react";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";
import { OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE } from "@/lib/opportunityDecisionDeskVisualFixture";
import {
  findAll,
  findByText,
  installTestDom,
  type TestDom,
  type TestElement,
} from "@/tests/helpers/minimal-react-dom";

type OpportunitiesFormProps = NonNullable<Parameters<typeof OpportunitiesForm>[0]>;
const OpportunitiesFormComponent = OpportunitiesForm as ComponentType<OpportunitiesFormProps>;

const POOL_EMPTY_TEXT = "还没有候选品。先在上方输入候选商品并手动分析，结果会自动进入候选品池。";
const FILTER_EMPTY_TEXT = "当前筛选下没有候选品。";

describe("OpportunitiesForm candidate pool empty-state behavior", () => {
  let dom: TestDom;
  let container: TestElement;
  let root: Root | null;

  beforeEach(() => {
    dom = installTestDom();
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

  async function mountFixture(
    surface: "legacy_default" | "advanced_import",
    visualFixture = OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE,
  ) {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const localStorageWrite = vi.spyOn(dom.localStorage, "setItem");
    const sessionStorageWrite = vi.spyOn(dom.sessionStorage, "setItem");
    const client = await import("react-dom/client");
    root = client.createRoot(container as unknown as Element);

    await act(async () => {
      root?.render(createElement(OpportunitiesFormComponent, { surface, visualFixture }));
      await Promise.resolve();
    });

    return { fetchMock, localStorageWrite, sessionStorageWrite };
  }

  function decisionRows() {
    return findAll(
      container,
      (element) => element.getAttribute("data-testid")?.startsWith("decision-row-") === true,
    );
  }

  it.each([
    ["legacy_default", ["机会雷达"]],
    ["advanced_import", ["高级工具", "手工导入外部来源"]],
  ] as const)("[MOUNTED] renders the pool-empty state on %s without I/O", async (surface, titleParts) => {
    const monitors = await mountFixture(surface, []);

    for (const titlePart of titleParts) expect(container.textContent).toContain(titlePart);
    expect(container.textContent).toContain(POOL_EMPTY_TEXT);
    expect(container.textContent).not.toContain(FILTER_EMPTY_TEXT);
    expect(decisionRows()).toHaveLength(0);
    expect(monitors.fetchMock).not.toHaveBeenCalled();
    expect(monitors.localStorageWrite).not.toHaveBeenCalled();
    expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();
  });

  it.each([
    "legacy_default",
    "advanced_import",
  ] as const)("[MOUNTED] preserves populated, filter-empty, and restored list order on %s", async (surface) => {
    const monitors = await mountFixture(surface);
    const expectedIds = [
      "decision-row-fixture-shortlisted",
      "decision-row-fixture-converted",
      "decision-row-fixture-high-risk",
      "decision-row-fixture-watch",
      "decision-row-fixture-rejected",
      "decision-row-fixture-insufficient",
      "decision-row-fixture-unknown-risk",
    ];

    expect(decisionRows().map((row) => row.getAttribute("data-testid"))).toEqual(expectedIds);
    expect(container.textContent).not.toContain(POOL_EMPTY_TEXT);
    expect(container.textContent).not.toContain(FILTER_EMPTY_TEXT);

    await act(async () => findByText(container, "button", "待查看（历史暂缓） 0").click());
    expect(container.textContent).toContain(FILTER_EMPTY_TEXT);
    expect(container.textContent).not.toContain(POOL_EMPTY_TEXT);
    expect(decisionRows()).toHaveLength(0);

    await act(async () => findByText(container, "button", "全部 7").click());
    expect(decisionRows().map((row) => row.getAttribute("data-testid"))).toEqual(expectedIds);
    expect(container.textContent).not.toContain(POOL_EMPTY_TEXT);
    expect(container.textContent).not.toContain(FILTER_EMPTY_TEXT);
    expect(monitors.fetchMock).not.toHaveBeenCalled();
    expect(monitors.localStorageWrite).not.toHaveBeenCalled();
    expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();
  });

  it("[RENDERED] keeps every candidate-pool state absent while the public surface is locked", () => {
    const defaultMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent));
    const advancedMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
      surface: "advanced_import",
    }));

    for (const markup of [defaultMarkup, advancedMarkup]) {
      expect(markup).toContain("功能预览");
      expect(markup).not.toContain(POOL_EMPTY_TEXT);
      expect(markup).not.toContain(FILTER_EMPTY_TEXT);
      expect(markup).not.toContain('data-testid="opportunity-decision-desk"');
    }
  });
});
