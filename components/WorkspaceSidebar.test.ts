import { describe, expect, it } from "vitest";
import {
  buildV4NavGroups,
  isTaskActiveResearchHighlight,
  modeBadgeLabel,
  type SidebarRuntime,
} from "@/components/WorkspaceSidebar";

describe("WorkspaceSidebar 导航一致性", () => {
  it("活动研究详情高亮商品研究：直接打开/刷新 URL 也一致（不依赖 from=research 参数）", () => {
    // 数据驱动：/tasks/<active-id> + 生命周期=active → 商品研究高亮
    expect(isTaskActiveResearchHighlight("/tasks/active-id", "", true)).toBe(true);
    // 历史记录详情 → 研究记录高亮
    expect(isTaskActiveResearchHighlight("/tasks/hist-id", "", false)).toBe(false);
    // /research 本身 → 商品研究高亮
    expect(isTaskActiveResearchHighlight("/research", "", true)).toBe(true);
    // 读取中（null）不抢高亮；/tasks 列表页 → 研究记录
    expect(isTaskActiveResearchHighlight("/tasks/task-id", "", null)).toBe(false);
    expect(isTaskActiveResearchHighlight("/tasks", "", null)).toBe(false);
  });

  it("本地导航不出现 V4 概览/案例回放（公网 showcase 保留）", () => {
    const local = buildV4NavGroups({ mode: "local_owner", v4Graph: true });
    const flat = local.flatMap((group) => group.items.map((item) => item.href));
    expect(flat).toContain("/research");
    expect(flat).toContain("/tasks");
    expect(flat).not.toContain("/replay");

    const showcase = buildV4NavGroups({ mode: "public_showcase", v4Graph: true });
    const showcaseFlat = showcase.flatMap((group) => group.items.map((item) => item.href));
    expect(showcaseFlat).toContain("/replay");
  });

  it("普通本地页面不显示 V4 / Local Live 技术模式文案（公网保留）", () => {
    expect(modeBadgeLabel({ mode: "local_owner", v4Graph: true })).toBe("");
    expect(modeBadgeLabel({ mode: "local_owner", v4Graph: false })).toBe("");
    expect(modeBadgeLabel({ mode: "public_showcase", v4Graph: true })).toContain("Public Replay");
  });

  it("导航分组只含现有路径，无原型/占位条目", () => {
    const runtime: SidebarRuntime = { mode: "local_owner", v4Graph: true };
    const flat = buildV4NavGroups(runtime).flatMap((group) => group.items);
    expect(flat.length).toBeGreaterThan(0);
    for (const item of flat) expect(item.href).not.toContain("prototype");
  });
});
