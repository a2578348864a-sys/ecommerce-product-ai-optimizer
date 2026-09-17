import { describe, expect, it } from "vitest";
import {
  deriveResearchViewGroups,
  deriveResearchViewTabs,
  type ResearchViewItem,
} from "@/components/TaskRecordsList";

function item(id: string, over: Partial<ResearchViewItem> = {}): ResearchViewItem {
  return {
    id,
    decisionStatus: "pending",
    result: {} as Record<string, unknown>,
    oneLineSummary: "",
    ...over,
  };
}

describe("/research 与工作台同一分类器（v11）", () => {
  it("标签：默认需要我处理，另有 AI 研究中/全部（不出现「进行中」）", () => {
    expect(deriveResearchViewTabs()).toEqual([
      { value: "needs", label: "需要我处理" },
      { value: "researching", label: "研究中" },
      { value: "", label: "全部" },
    ]);
  });

  it("OXO-like（缺资料）与 BrüMate-like（有研究无决定）→ 见 v11 断言；running → 研究中", () => {
    const items = [
      item("oxo", { result: {} as Record<string, unknown> }),
      item("brumate", { result: { finalReport: { finalVerdict: "x" } } }),
      item("running-task", { result: {} as Record<string, unknown> }),
      item("nostart", { result: {} as Record<string, unknown> }),
    ];
    const byId: Record<string, string> = { "running-task": "running", nostart: "not_started" };
    const groups = deriveResearchViewGroups(items, byId);
    const needIds = groups.filter((g) => g.view.group === "needs_action").map((g) => g.item.id);
    const researchingIds = groups.filter((g) => g.view.group === "researching").map((g) => g.item.id);
    // v11：running → 研究中；brumate/nostart/oxo → 需要我处理
    //（brumate 的 finalReport 是研究资料，但 deriveResearchHistoryStatus 将其归为"待人工决定"，
    //  因为无正式决定载体——组别为 needs_action，与详情页一致）
    expect(needIds.sort()).toEqual(["brumate", "nostart", "oxo"]);
    expect(researchingIds).toEqual(["running-task"]);
    expect(groups).toHaveLength(4);
  });

  it("与共享分类器逐项一致（同一批数据同一结果）", async () => {
    const { deriveProductProjectGroup } = await import("@/lib/researchLifecycle");
    const items = [item("a", { result: { productResearchSummary: { schema: "product-research-record.v1", status: "creative_ready" } } })];
    const groups = deriveResearchViewGroups(items, { a: "completed" });
    expect(groups[0]!.view).toEqual(deriveProductProjectGroup({ aiRunStatus: "completed", decisionStatus: "pending", result: items[0]!.result, oneLineSummary: "" }));
    // v11：productResearchSummary（creative_ready）= 等待人工决定，不是已完成
    expect(groups[0]!.view.group).toBe("needs_action");
  });
});
