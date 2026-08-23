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

describe("/research 与工作台同一分类器（轮 6）", () => {
  it("标签：默认需要我处理，另有 AI 研究中/全部（不出现「进行中」）", () => {
    expect(deriveResearchViewTabs()).toEqual([
      { value: "needs", label: "需要我处理" },
      { value: "researching", label: "AI 研究中" },
      { value: "", label: "全部" },
    ]);
  });

  it("OXO-like（缺资料）与 BrüMate-like（有研究无决定）→ 需要我处理；running → AI 研究中；not_started≠研究中", () => {
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
    expect(needIds.sort()).toEqual(["brumate", "nostart", "oxo"]);
    expect(researchingIds).toEqual(["running-task"]);
    expect(groups).toHaveLength(4);
  });

  it("与共享分类器逐项一致（同一批数据同一结果）", async () => {
    const { deriveProductProjectGroup } = await import("@/lib/researchLifecycle");
    const items = [item("a", { result: { productResearchSummary: { schema: "product-research-record.v1", status: "creative_ready" } } })];
    const groups = deriveResearchViewGroups(items, { a: "completed" });
    expect(groups[0]!.view).toEqual(deriveProductProjectGroup({ aiRunStatus: "completed", decisionStatus: "pending", result: items[0]!.result, oneLineSummary: "" }));
    expect(groups[0]!.view.group).toBe("completed");
  });
});
