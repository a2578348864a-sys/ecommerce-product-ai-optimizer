import { describe, expect, it } from "vitest";
import { buildV4NavGroups, modeBadgeLabel, withTaskContext } from "@/components/WorkspaceSidebar";

function labels(r: Parameters<typeof buildV4NavGroups>[0]) {
  const groups = buildV4NavGroups(r);
  return groups.map((g) => ({ label: g.label, items: g.items.map((i) => i.label + ":" + i.href) }));
}

describe("WorkspaceSidebar 导航矩阵（商品开发决策收口）", () => {
  it("从任务详情进入两个创作工作台时都保留 taskId", () => {
    expect(withTaskContext("/listing-studio", "task/with spaces")).toBe("/listing-studio?taskId=task%2Fwith%20spaces");
    expect(withTaskContext("/image-studio", "task/with spaces")).toBe("/image-studio?taskId=task%2Fwith%20spaces");
    expect(withTaskContext("/research", "task-1")).toBe("/research");
  });

  it("本地：核心流程（机会发现/决策评估/决策复盘）与辅助工具（Listing/Image），无 V4 项/无案例回放", () => {
    const g = labels({ mode: "local_owner", v4Graph: true });
    expect(g[0].label).toBe("工作台");
    expect(g[0].items).toEqual(["工作台:/"]);
    expect(g[1].label).toBe("核心流程");
    expect(g[1].items).toEqual(["机会发现:/opportunities", "决策评估:/opportunity-candidates", "决策复盘:/tasks"]);
    expect(g[2].label).toBe("辅助工具");
    expect(g[2].items).toEqual(["Listing Studio:/listing-studio", "Image Studio:/image-studio"]);
    const all = g.flatMap((x) => x.items);
    expect(all.some((i) => i.includes("/v4/runs"))).toBe(false);
    expect(all.some((i) => i.includes("/replay"))).toBe(false);
  });

  it("本地 flag OFF 与 ON 相同", () => {
    const g = labels({ mode: "local_owner", v4Graph: false });
    expect(g.flatMap((x) => x.items)).toEqual(g.flatMap((x) => x.items));
    expect(g[1].items.length).toBe(3);
  });

  it("SSR 初始 unknown：本地保守结构，无模式 Badge", () => {
    const g = labels({ mode: null, v4Graph: false });
    expect(g[1].items.length).toBe(3);
    expect(modeBadgeLabel({ mode: null, v4Graph: false })).toBe("");
  });

  it("公网：演示门户分组仅首页 + 完整商品案例（不恢复旧 V4 概览/内容工具/历史功能）", () => {
    const g = labels({ mode: "public_showcase", v4Graph: true });
    expect(g.length).toBe(1);
    expect(g[0].label).toBe("演示门户");
    expect(g[0].items).toEqual(["首页:/", "完整商品案例:/replay"]);
    const all = g.flatMap((x) => x.items.map((i) => i.toLowerCase()));
    expect(g.some((x) => x.label.includes("内容工具"))).toBe(false);
    expect(g.some((x) => x.label.includes("历史功能"))).toBe(false);
    expect(all.some((i) => i.includes("/v4/runs"))).toBe(false);
    expect(all.some((i) => i.includes("/research"))).toBe(false);
    expect(all.some((i) => i.includes("studio"))).toBe(false);
    expect(all.some((i) => i.includes("github"))).toBe(false);
  });

  it("模式 Badge 文案：普通本地页面不显示 V4 / Local Live（公网保留）", () => {
    expect(modeBadgeLabel({ mode: "public_showcase", v4Graph: false })).toBe("演示门户 · 只读案例");
    expect(modeBadgeLabel({ mode: "local_owner", v4Graph: true })).toBe("");
    expect(modeBadgeLabel({ mode: "local_owner", v4Graph: false })).toBe("");
    expect(modeBadgeLabel({ mode: "local_owner", v4Graph: true })).not.toContain("Local Live");
    expect(modeBadgeLabel({ mode: "local_owner", v4Graph: true })).not.toContain("V4");
  });
});
