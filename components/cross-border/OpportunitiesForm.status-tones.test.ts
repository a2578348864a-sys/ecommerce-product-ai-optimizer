import { act, createElement } from "react";
import type { ComponentType } from "react";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
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
  type TestDom,
  type TestElement,
} from "@/tests/helpers/minimal-react-dom";

type OpportunitiesFormProps = NonNullable<Parameters<typeof OpportunitiesForm>[0]>;
const OpportunitiesFormComponent = OpportunitiesForm as ComponentType<OpportunitiesFormProps>;

const TONE_CASES = [
  {
    queueState: "pending_review",
    candidateStatus: "pending",
    convertedTaskId: null,
    label: "待查看",
    tone: "border-slate-200 bg-slate-50 text-slate-700",
  },
  {
    queueState: "pending_analysis",
    candidateStatus: "worth_analyzing",
    convertedTaskId: null,
    label: "待分析",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  {
    queueState: "analyzing",
    candidateStatus: "analyzed",
    convertedTaskId: null,
    label: "分析中",
    tone: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  {
    queueState: "converted",
    candidateStatus: "analyzed",
    convertedTaskId: "task-status-tone",
    label: "已转任务",
    tone: "border-teal-200 bg-teal-50 text-teal-700",
  },
  {
    queueState: "rejected",
    candidateStatus: "rejected",
    convertedTaskId: null,
    label: "已放弃",
    tone: "border-rose-200 bg-rose-50 text-rose-700",
  },
] as const satisfies readonly {
  readonly queueState: string;
  readonly candidateStatus: CandidateStatus;
  readonly convertedTaskId: string | null;
  readonly label: string;
  readonly tone: string;
}[];

const SURFACES = ["legacy_default", "advanced_import"] as const;
const LIST_BASE_CLASS = "inline-flex w-fit rounded-full border px-2 py-1 text-[11px] font-semibold";
const DETAIL_BASE_CLASS = "rounded-full border px-2.5 py-1 text-xs font-bold";

function fixtureFor(
  queueState: string,
  candidateStatus: CandidateStatus,
  convertedTaskId: string | null,
): OpportunityCandidatePoolItem {
  return {
    ...OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE[0],
    id: `status-tone-${queueState}`,
    name: `状态色调 ${queueState}`,
    candidateStatus,
    convertedTaskId,
  };
}

function expectRenderedTone(
  root: TestElement,
  id: string,
  label: string,
  tone: string,
) {
  const row = findAll(
    root,
    (element) => element.getAttribute("data-testid") === `decision-row-${id}`,
  )[0];
  const detail = findAll(
    root,
    (element) => element.getAttribute("data-testid") === `decision-detail-${id}`,
  )[0];
  if (!row || !detail) throw new Error(`candidate_tone_surface_not_found:${id}`);

  const listBadge = findAll(
    row,
    (element) => element.localName === "span" && element.textContent.trim() === label,
  )[0];
  const detailBadge = findAll(
    detail,
    (element) => element.localName === "span" && element.textContent.trim() === `处理：${label}`,
  )[0];
  if (!listBadge || !detailBadge) throw new Error(`candidate_tone_badge_not_found:${id}`);

  expect(listBadge.getAttribute("class")).toBe(`${LIST_BASE_CLASS} ${tone}`);
  expect(detailBadge.getAttribute("class")).toBe(`${DETAIL_BASE_CLASS} ${tone}`);
  expect(listBadge.getAttribute("class")).toContain(tone);
  expect(detailBadge.getAttribute("class")).toContain(tone);
}

describe("OpportunitiesForm Candidate status tone consistency", () => {
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

  it.each(SURFACES)("[SSR_RENDERED] preserves all five Candidate status tones on %s", (surface) => {
    for (const toneCase of TONE_CASES) {
      const fixture = fixtureFor(
        toneCase.queueState,
        toneCase.candidateStatus,
        toneCase.convertedTaskId,
      );
      const markup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
        surface,
        visualFixture: [fixture],
      }));

      expect(markup).toContain(`data-testid="decision-row-${fixture.id}"`);
      expect(markup).toContain(`data-testid="decision-detail-${fixture.id}"`);
      expect(markup).toContain(`${LIST_BASE_CLASS} ${toneCase.tone}`);
      expect(markup).toContain(`${DETAIL_BASE_CLASS} ${toneCase.tone}`);
      expect(markup).toContain(`>${toneCase.label}</span>`);
      expect(markup).toContain(`>处理：${toneCase.label}</span>`);
    }
  });

  it.each(
    SURFACES.flatMap((surface) => TONE_CASES.map((toneCase) => ({ surface, toneCase }))),
  )(
    "[MOUNTED_BEHAVIOR] keeps $toneCase.queueState list/detail tones identical on $surface",
    async ({ surface, toneCase }) => {
      const fixture = fixtureFor(
        toneCase.queueState,
        toneCase.candidateStatus,
        toneCase.convertedTaskId,
      );
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const localStorageWrite = vi.spyOn(dom.localStorage, "setItem");
      const sessionStorageWrite = vi.spyOn(dom.sessionStorage, "setItem");
      const client = await import("react-dom/client");
      root = client.createRoot(container as unknown as Element);

      await act(async () => {
        root?.render(createElement(OpportunitiesFormComponent, {
          surface,
          visualFixture: [fixture],
        }));
        await Promise.resolve();
      });

      expectRenderedTone(container, fixture.id, toneCase.label, toneCase.tone);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(localStorageWrite).not.toHaveBeenCalled();
      expect(sessionStorageWrite).not.toHaveBeenCalled();
    },
  );

  it("[STRUCTURAL] routes exactly the list and detail consumers through the shared tone function", () => {
    const source = readFileSync(
      new URL("./OpportunitiesForm.tsx", import.meta.url),
      "utf8",
    );

    expect(source.match(/getCandidateStatusToneClass\(/g)).toHaveLength(2);
    expect(source).not.toContain("function candidateStatusClass");
    expect(source).not.toMatch(/\bcandidateStatusClass\(/);
  });
});
