import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanSummary } from "./PlanSummary";
import { makeEvent, makeRun } from "./fixtures";

describe("PlanSummary", () => {
  it("shows plan revision and plan events", () => {
    const html = renderToStaticMarkup(
      createElement(PlanSummary, {
        run: makeRun({ planRevision: 2, automaticPlanRevisionCount: 1 }),
        events: [
          makeEvent({ seq: 1, type: "plan_created" }),
          makeEvent({ seq: 2, type: "plan_revised" }),
        ],
      }),
    );
    expect(html).toContain('data-testid="plan-summary"');
    expect(html).toContain("rev.2");
    expect(html).toContain("自动修订次数：1");
    expect(html).toContain("创建计划");
    expect(html).toContain("修订计划");
  });

  it("shows empty state when there are no plan events", () => {
    const html = renderToStaticMarkup(createElement(PlanSummary, { run: makeRun(), events: [] }));
    expect(html).toContain("暂无计划记录");
  });
});
