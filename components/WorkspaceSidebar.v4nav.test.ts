import { describe, expect, it } from "vitest";
import { buildV4NavGroups, modeBadgeLabel } from "@/components/WorkspaceSidebar";

function labels(r: Parameters<typeof buildV4NavGroups>[0]) {
  const groups = buildV4NavGroups(r);
  return groups.map((g) => ({ label: g.label, items: g.items.map((i) => i.label + ":" + i.href) }));
}

describe("WorkspaceSidebar 导航矩阵（V4.1 C 端）", () => {
  it("本地：7 项主导航（工作台/发现/待研究/商品研究/研究记录/Listing/Image），无 V4 项/无案例回放", () => {
    const g = labels({ mode: "local_owner", v4Graph: true });
    expect(g[0].label).toBe("工作台");
    expect(g[0].items).toEqual(["工作台:/"]);
    expect(g[1].label).toBe("商品研究");
    expect(g[1].items).toEqual(["发现商品:/opportunities", "待研究商品:/opportunity-candidates", "商品研究:/research", "研究记录:/tasks"]);
    expect(g[2].items).toEqual(["Listing Studio:/listing-studio", "Image Studio:/image-studio"]);
    const all = g.flatMap((x) => x.items);
    expect(all.some((i) => i.includes("/v4/runs"))).toBe(false);
    expect(all.some((i) => i.includes("/replay"))).toBe(false);
  });
  it("本地 flag OFF 与 ON 相同（7 项）", () => {
    const g = labels({ mode: "local_owner", v4Graph: false });
    expect(g.flatMap((x) => x.items)).toEqual(g.flatMap((x) => x.items));
    expect(g[1].items.length).toBe(4);
  });
  it("SSR 初始 unknown：本地 7 项保守结构，无模式 Badge", () => {
    const g = labels({ mode: null, v4Graph: false });
    expect(g[1].items.length).toBe(4);
    expect(modeBadgeLabel({ mode: null, v4Graph: false })).toBe("");
  });
  it("公网：演示门户分组仅首页 + 完整商品案例（不恢复旧 V4 概览/内容工具/历史功能）", () => {
    const g = labels({ mode: "public_showcase", v4Graph: true });
    // 当前产品合同：一个"演示门户"分组，仅「首页」「完整商品案例」
    expect(g.length).toBe(1);
    expect(g[0].label).toBe("演示门户");
    expect(g[0].items).toEqual(["首页:/", "完整商品案例:/replay"]);
    // 不含研究/Studio/历史功能/V4 runs/GitHub
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
    // 普通本地页面不出现技术模式文案
    expect(modeBadgeLabel({ mode: "local_owner", v4Graph: true })).not.toContain("Local Live");
    expect(modeBadgeLabel({ mode: "local_owner", v4Graph: true })).not.toContain("V4");
  });
});
