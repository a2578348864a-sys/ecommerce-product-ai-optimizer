import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";
import { OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE } from "@/lib/opportunityDecisionDeskVisualFixture";
import type {
  CandidateStatus,
  OpportunityCandidatePoolItem,
} from "@/lib/opportunityCandidatePool";

type OpportunitiesFormProps = NonNullable<Parameters<typeof OpportunitiesForm>[0]>;
const OpportunitiesFormComponent = OpportunitiesForm as ComponentType<OpportunitiesFormProps>;

type ExpectedPoolCounts = Readonly<{
  all: number;
  pending: number;
  worth_analyzing: number;
  analyzed: number;
  paused: number;
  rejected: number;
}>;

const COUNT_LABELS: Readonly<Record<keyof ExpectedPoolCounts, string>> = {
  all: "全部",
  pending: "待查看",
  worth_analyzing: "待分析",
  analyzed: "分析中",
  paused: "待查看（历史暂缓）",
  rejected: "已放弃",
};

function candidate(
  id: string,
  candidateStatus: CandidateStatus,
  convertedTaskId: string | null = null,
): OpportunityCandidatePoolItem {
  return {
    ...OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE[0],
    id,
    name: id,
    candidateStatus,
    convertedTaskId,
  };
}

function unknownStatusCandidate(id: string): OpportunityCandidatePoolItem {
  return candidate(id, "unknown_status" as CandidateStatus);
}

function renderPool(
  visualFixture: OpportunityCandidatePoolItem[],
  surface: "legacy_default" | "advanced_import" = "legacy_default",
) {
  return renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
    surface,
    visualFixture,
  }));
}

function expectPoolCounts(markup: string, expected: ExpectedPoolCounts) {
  for (const [key, label] of Object.entries(COUNT_LABELS) as [keyof ExpectedPoolCounts, string][]) {
    expect(markup).toContain(`>${label} ${expected[key]}</button>`);
  }
}

const EMPTY_COUNTS: ExpectedPoolCounts = {
  all: 0,
  pending: 0,
  worth_analyzing: 0,
  analyzed: 0,
  paused: 0,
  rejected: 0,
};

describe("OpportunitiesForm candidate pool count behavior", () => {
  it.each([
    ["empty", [], EMPTY_COUNTS],
    ["pending", [candidate("pending", "pending")], { ...EMPTY_COUNTS, all: 1, pending: 1 }],
    ["worth_analyzing", [candidate("worth", "worth_analyzing")], { ...EMPTY_COUNTS, all: 1, worth_analyzing: 1 }],
    ["analyzed", [candidate("analyzed", "analyzed")], { ...EMPTY_COUNTS, all: 1, analyzed: 1 }],
    ["paused", [candidate("paused", "paused")], { ...EMPTY_COUNTS, all: 1, paused: 1 }],
    ["rejected", [candidate("rejected", "rejected")], { ...EMPTY_COUNTS, all: 1, rejected: 1 }],
  ] as const)("[SSR_RENDERED] preserves the inline count contract for %s", (_name, fixture, expected) => {
    expectPoolCounts(renderPool([...fixture]), expected);
  });

  it("[SSR_RENDERED] counts a mixed pool by array element and keeps converted Candidates out of analyzed", () => {
    const fixture = [
      candidate("pending-1", "pending"),
      candidate("pending-2", "pending"),
      candidate("worth", "worth_analyzing"),
      candidate("analyzing", "analyzed"),
      candidate("converted", "analyzed", "task-001"),
      candidate("paused", "paused"),
      candidate("rejected", "rejected"),
    ];

    expectPoolCounts(renderPool(fixture), {
      all: 7,
      pending: 2,
      worth_analyzing: 1,
      analyzed: 1,
      paused: 1,
      rejected: 1,
    });
  });

  it("[SSR_RENDERED] leaves a direct unknown status in all without assigning a legal status bucket", () => {
    expectPoolCounts(renderPool([unknownStatusCandidate("unknown")]), {
      ...EMPTY_COUNTS,
      all: 1,
    });
  });

  it("[SSR_RENDERED] keeps counts stable when Candidate order changes", () => {
    const fixture = [
      candidate("pending", "pending"),
      candidate("worth", "worth_analyzing"),
      candidate("analyzed", "analyzed"),
      candidate("rejected", "rejected"),
    ];
    const expected = {
      ...EMPTY_COUNTS,
      all: 4,
      pending: 1,
      worth_analyzing: 1,
      analyzed: 1,
      rejected: 1,
    };

    expectPoolCounts(renderPool(fixture), expected);
    expectPoolCounts(renderPool([...fixture].reverse()), expected);
  });

  it("[SSR_RENDERED] shows identical counts on default and advanced_import surfaces", () => {
    const fixture = [
      candidate("pending", "pending"),
      candidate("worth", "worth_analyzing"),
      candidate("converted", "analyzed", "task-001"),
    ];
    const expected = {
      ...EMPTY_COUNTS,
      all: 3,
      pending: 1,
      worth_analyzing: 1,
    };

    expectPoolCounts(renderPool(fixture, "legacy_default"), expected);
    expectPoolCounts(renderPool(fixture, "advanced_import"), expected);
  });

  it("[SSR_RENDERED] keeps the locked surfaces free of pool counts and business requests", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      const defaultMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent));
      const advancedMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
        surface: "advanced_import",
      }));

      for (const markup of [defaultMarkup, advancedMarkup]) {
        expect(markup).toContain("功能预览");
        expect(markup).not.toContain(">全部 0</button>");
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
