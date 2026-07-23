import { act, createElement } from "react";
import type { ComponentType } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";
import { OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE } from "@/lib/opportunityDecisionDeskVisualFixture";
import type {
  CandidateStatus,
  OpportunityCandidatePoolItem,
} from "@/lib/opportunityCandidatePool";
import {
  findAll,
  installTestDom,
  setNativeValue,
  TestEvent,
  type TestDom,
  type TestElement,
} from "@/tests/helpers/minimal-react-dom";

type OpportunitiesFormProps = NonNullable<Parameters<typeof OpportunitiesForm>[0]>;
const OpportunitiesFormComponent = OpportunitiesForm as ComponentType<OpportunitiesFormProps>;

function candidate(
  id: string,
  candidateStatus: CandidateStatus,
  score: number,
  updatedAt: number,
  overrides: Partial<OpportunityCandidatePoolItem> = {},
): OpportunityCandidatePoolItem {
  return {
    ...OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE[0],
    id,
    name: id,
    candidateStatus,
    convertedTaskId: null,
    score,
    updatedAt,
    ...overrides,
  };
}

const MIXED_FIXTURE: OpportunityCandidatePoolItem[] = [
  candidate("pending-b", "pending", 70, 1_000, { name: "并列候选" }),
  candidate("worth-high", "worth_analyzing", 95, 500),
  candidate("converted", "analyzed", 85, 800, { convertedTaskId: "task-001" }),
  candidate("pending-a", "pending", 70, 1_000, { name: "并列候选" }),
  candidate("analyzed", "analyzed", 90, 900),
  candidate("paused", "paused", 80, 1_100),
  candidate("rejected", "rejected", 60, 1_200),
  candidate("unknown", "unknown_status" as CandidateStatus, 100, 1_300),
  candidate("worth-low", "worth_analyzing", 50, 1_400),
];

const DEFAULT_UPDATED_ORDER = [
  "worth-low",
  "unknown",
  "rejected",
  "paused",
  "pending-b",
  "pending-a",
  "analyzed",
  "converted",
  "worth-high",
];

const SCORE_ORDER = [
  "unknown",
  "worth-high",
  "analyzed",
  "converted",
  "paused",
  "pending-b",
  "pending-a",
  "rejected",
  "worth-low",
];

describe("OpportunitiesForm visible Candidate filtering and sorting", () => {
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
    visualFixture: OpportunityCandidatePoolItem[] = MIXED_FIXTURE,
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

  function visibleIds() {
    return findAll(
      container,
      (element) => element.getAttribute("data-testid")?.startsWith("decision-row-") === true,
    ).map((row) => row.getAttribute("data-testid")?.replace("decision-row-", ""));
  }

  function filterButton(label: string) {
    const button = findAll(
      container,
      (element) => element.localName === "button" && element.textContent.trim().startsWith(label),
    )[0];
    if (!button) throw new Error(`candidate_filter_button_not_found:${label}`);
    return button;
  }

  async function selectSort(value: "updated" | "score") {
    const select = findAll(
      container,
      (element) => element.localName === "select" && element.getAttribute("aria-label") === "候选品排序",
    )[0];
    if (!select) throw new Error("candidate_sort_select_not_found");

    await act(async () => {
      setNativeValue(select, value);
      select.dispatchEvent(new TestEvent("change"));
    });
  }

  it.each([
    "legacy_default",
    "advanced_import",
  ] as const)("[MOUNTED_BEHAVIOR] preserves default sort, every filter, combinations, and restore on %s", async (surface) => {
    const monitors = await mountFixture(surface);

    expect(visibleIds()).toEqual(DEFAULT_UPDATED_ORDER);

    const filters = [
      ["待查看 2", ["pending-b", "pending-a"]],
      ["待分析 2", ["worth-low", "worth-high"]],
      ["分析中 1", ["analyzed"]],
      ["待查看（历史暂缓） 1", ["paused"]],
      ["已放弃 1", ["rejected"]],
    ] as const;

    for (const [label, expectedIds] of filters) {
      await act(async () => filterButton(label).click());
      expect(visibleIds()).toEqual(expectedIds);
    }

    await act(async () => filterButton("全部 9").click());
    expect(visibleIds()).toEqual(DEFAULT_UPDATED_ORDER);

    await selectSort("score");
    expect(visibleIds()).toEqual(SCORE_ORDER);

    await act(async () => filterButton("待分析 2").click());
    expect(visibleIds()).toEqual(["worth-high", "worth-low"]);

    await selectSort("updated");
    expect(visibleIds()).toEqual(["worth-low", "worth-high"]);

    expect(monitors.fetchMock).not.toHaveBeenCalled();
    expect(monitors.localStorageWrite).not.toHaveBeenCalled();
    expect(monitors.sessionStorageWrite).not.toHaveBeenCalled();
  });

  it("[MOUNTED_BEHAVIOR] excludes converted analyzed and direct unknown statuses only from legal filters", async () => {
    await mountFixture("legacy_default");

    await act(async () => filterButton("分析中 1").click());
    expect(visibleIds()).toEqual(["analyzed"]);

    await act(async () => filterButton("全部 9").click());
    expect(visibleIds()).toContain("converted");
    expect(visibleIds()).toContain("unknown");

    for (const label of ["待查看 2", "待分析 2", "分析中 1", "待查看（历史暂缓） 1", "已放弃 1"]) {
      await act(async () => filterButton(label).click());
      expect(visibleIds()).not.toContain("unknown");
      expect(visibleIds()).not.toContain("converted");
    }
  });

  it("[MOUNTED_BEHAVIOR] preserves stable input order when every explicit tie-breaker is equal", async () => {
    const tied = [
      candidate("tie-second", "pending", 70, 1_000, { name: "同名候选" }),
      candidate("tie-first", "pending", 70, 1_000, { name: "同名候选" }),
    ];

    await mountFixture("legacy_default", tied);
    expect(visibleIds()).toEqual(["tie-second", "tie-first"]);

    await selectSort("score");
    expect(visibleIds()).toEqual(["tie-second", "tie-first"]);
  });

  it("[MOUNTED_BEHAVIOR] preserves the current fallback ordering for missing sort fields", async () => {
    const missingUpdated = candidate("missing-updated", "pending", 70, 0, {
      updatedAt: undefined as unknown as number,
    });
    const validUpdated = candidate("valid-updated", "pending", 60, 100);
    const missingScore = candidate("missing-score", "pending", 0, 200, {
      score: undefined as unknown as number,
    });
    const validScore = candidate("valid-score", "pending", 50, 100);

    await mountFixture("legacy_default", [validUpdated, missingUpdated]);
    expect(visibleIds()).toEqual(["missing-updated", "valid-updated"]);

    await act(async () => {
      root?.render(createElement(OpportunitiesFormComponent, {
        surface: "legacy_default",
        visualFixture: [validScore, missingScore],
      }));
    });
    await selectSort("score");
    expect(visibleIds()).toEqual(["missing-score", "valid-score"]);
  });

  it("[MOUNTED_BEHAVIOR] reaches filter_empty and restores the original visible set", async () => {
    await mountFixture("advanced_import", [
      candidate("only-pending", "pending", 70, 1_000),
    ]);

    await act(async () => filterButton("已放弃 0").click());
    expect(container.textContent).toContain("当前筛选下没有候选品。");
    expect(visibleIds()).toHaveLength(0);

    await act(async () => filterButton("全部 1").click());
    expect(container.textContent).not.toContain("当前筛选下没有候选品。");
    expect(visibleIds()).toEqual(["only-pending"]);
  });
});
