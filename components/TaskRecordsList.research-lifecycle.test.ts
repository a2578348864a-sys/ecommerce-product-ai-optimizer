import { describe, expect, it } from "vitest";
import {
  getResearchLifecycleLabel,
  getResearchLifecycleTitle,
} from "@/components/TaskRecordsList";
import type { ResearchLifecycleSnapshot } from "@/lib/server/researchLifecycleReader";

/**
 * Bridge V1：TaskRecordsList 研究主生命周期标签。
 * 标签只消费 task.researchLifecycle（同一 Reader 快照），与详情页同语义。
 */

function snapshot(overrides: Partial<ResearchLifecycleSnapshot>): ResearchLifecycleSnapshot {
  return {
    phase: "created",
    collectionStatus: "not_started",
    confirmationStatus: "none",
    decisionStatus: "none",
    completionStatus: "not_completed",
    creativeReadiness: "not_ready",
    stale: false,
    blockers: [],
    nextAction: "开始补齐研究资料。",
    contractMode: "modern",
    ...overrides,
  };
}

describe("TaskRecordsList research lifecycle labels (Bridge V1)", () => {
  it("case 1: created → 尚未开始研究", () => {
    expect(getResearchLifecycleLabel(snapshot({ phase: "created" }))).toBe("尚未开始研究");
  });

  it("collecting → 资料采集中（与详情页同语义）", () => {
    expect(getResearchLifecycleLabel(snapshot({ phase: "collecting" }))).toBe("资料采集中");
  });

  it("case 2: awaiting_confirmation → 等待确认", () => {
    expect(getResearchLifecycleLabel(snapshot({ phase: "awaiting_confirmation" }))).toBe("等待确认");
  });

  it("case 3: awaiting_decision → 等待人工决定", () => {
    expect(getResearchLifecycleLabel(snapshot({ phase: "awaiting_decision" }))).toBe("待人工决定");
  });

  it("case 4: ready_to_complete → 待完成研究（不得显示研究完成）", () => {
    const label = getResearchLifecycleLabel(snapshot({ phase: "ready_to_complete" }));
    expect(label).toBe("待完成研究");
    expect(label).not.toContain("研究已完成");
  });

  it("case 5: completed + ready → 研究已完成", () => {
    expect(getResearchLifecycleLabel(snapshot({ phase: "completed", creativeReadiness: "ready" }))).toBe("研究已完成");
  });

  it("case 6: completed + blocked 仍显示研究已完成（不退回未完成）", () => {
    const label = getResearchLifecycleLabel(snapshot({
      phase: "completed",
      creativeReadiness: "blocked",
      blockers: ["candidate_binding_unverified"],
    }));
    expect(label).toContain("研究已完成");
  });

  it("case 7: completed + stale 同时保留研究完成与重新确认", () => {
    const label = getResearchLifecycleLabel(snapshot({ phase: "completed", stale: true }));
    expect(label).toContain("研究已完成");
    expect(label).toContain("需重新确认");
  });

  it("case 8: abandoned → 已放弃", () => {
    expect(getResearchLifecycleLabel(snapshot({ phase: "abandoned" }))).toBe("已放弃");
  });

  it("case 9: legacy 追加旧版标记且永不显示研究已完成", () => {
    expect(getResearchLifecycleLabel(snapshot({ phase: "created", contractMode: "legacy" }))).toContain("旧版");
    expect(getResearchLifecycleLabel(snapshot({ phase: "awaiting_decision", contractMode: "legacy" }))).toContain("旧版");
    expect(getResearchLifecycleLabel(snapshot({ phase: "created", contractMode: "legacy" }))).not.toContain("研究已完成");
  });

  it("case 10: invalid blocked → 状态异常", () => {
    expect(getResearchLifecycleLabel(snapshot({ phase: "blocked", contractMode: "invalid" }))).toBe("状态异常");
  });

  it("blocked（modern，如采集失败）→ 研究受阻", () => {
    expect(getResearchLifecycleLabel(snapshot({ phase: "blocked", contractMode: "modern" }))).toBe("研究受阻");
  });

  it("title 透出 phase/contract/blockers/nextAction 供排查", () => {
    const title = getResearchLifecycleTitle(snapshot({
      phase: "completed",
      stale: true,
      blockers: ["research_stale_requires_reconfirmation"],
      nextAction: "重新确认研究结论。",
    }));
    expect(title).toContain("phase=completed");
    expect(title).toContain("research_stale_requires_reconfirmation");
    expect(title).toContain("重新确认研究结论。");
  });
});
