import { describe, expect, it } from "vitest";
import {
  OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE,
} from "@/lib/opportunityDecisionDeskVisualFixture";
import {
  getDecisionDeskMarketPresentation,
  getDecisionDeskRiskPresentation,
  getDecisionDeskScorePresentation,
} from "@/lib/opportunityDecisionDesk";
import { getCandidateQueuePresentation } from "@/lib/opportunityCandidatePool";

describe("opportunity decision desk visual fixture", () => {
  it("covers every deployment-gate state without external data", () => {
    const marketLabels = new Set(OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE.map(
      (item) => getDecisionDeskMarketPresentation(item).label,
    ));
    const riskLabels = new Set(OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE.map(
      (item) => getDecisionDeskRiskPresentation(item).label,
    ));
    const processingLabels = new Set(OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE.map(
      (item) => getCandidateQueuePresentation(item.candidateStatus, Boolean(item.convertedTaskId)).label,
    ));

    expect(marketLabels).toEqual(new Set(["晋级", "观察", "拒绝", "数据不足", "尚未评估"]));
    expect(riskLabels).toContain("高风险");
    expect(riskLabels).toContain("未确认");
    expect(processingLabels).toContain("已转任务");
  });

  it("contains both a real zero and an unavailable score", () => {
    expect(OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE.map(getDecisionDeskScorePresentation)).toContain("0");
    expect(OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE.map(getDecisionDeskScorePresentation)).toContain("—");
  });

  it("uses only deterministic local fixture references", () => {
    expect(OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE.every((item) => (
      !item.link || item.link.startsWith("https://fixture.invalid/")
    ))).toBe(true);
  });
});
