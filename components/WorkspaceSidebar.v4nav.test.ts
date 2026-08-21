/** V4.1 — 运行模式感知导航矩阵（UI Contract §2）。 */
import { describe, expect, it } from "vitest";
import { buildV4NavGroups, modeBadgeLabel } from "@/components/WorkspaceSidebar";

function labels(r: Parameters<typeof buildV4NavGroups>[0]) {
  const groups = buildV4NavGroups(r);
  return groups.map((g) => ({ label: g.label, items: g.items.map((i) => i.label + ":" + i.href) }));
}

describe("WorkspaceSidebar V4 导航矩阵", () => {
  it("Public Showcase：V4 工作台=案例回放（无研究任务）；内容工具；历史功能", () => {
    const g = labels({ mode: "public_showcase", v4Graph: false });
    expect(g[0].label).toBe("V4 工作台");
    expect(g[0].items).toEqual(["案例回放:/replay"]);
    expect(g[1].label).toBe("内容工具");
    expect(g[1].items).toEqual(["Listing Studio:/listing-studio", "Image Studio:/image-studio"]);
    expect(g[2].label).toBe("历史功能");
    expect(g[2].items[0]).toBe("发现商品:/opportunities");
  });

  it("Public 模式下即使 v4Graph 开启也不渲染研究任务（公网无 Live 入口）", () => {
    const g = labels({ mode: "public_showcase", v4Graph: true });
    expect(g[0].items).toEqual(["案例回放:/replay"]);
  });

  it("Local + flag ON：V4 工作台=研究任务 + 案例回放", () => {
    const g = labels({ mode: "local_owner", v4Graph: true });
    expect(g[0].items).toEqual(["研究任务:/v4/runs", "案例回放:/replay"]);
    expect(g[1].label).toBe("研究与决策");
    expect(g[2].label).toBe("内容准备");
  });

  it("Local + flag OFF：无研究任务，且案例回放仍在（不泄露 Live 入口）", () => {
    const g = labels({ mode: "local_owner", v4Graph: false });
    expect(g[0].items).toEqual(["案例回放:/replay"]);
  });

  it("SSR 初始 unknown：保守（同 flag OFF 结构），无模式 Badge", () => {
    const g = labels({ mode: null, v4Graph: false });
    expect(g[0].items).toEqual(["案例回放:/replay"]);
    expect(modeBadgeLabel({ mode: null, v4Graph: false })).toBe("");
  });

  it("模式 Badge 文案：Public / Local Live / Local 未启用", () => {
    expect(modeBadgeLabel({ mode: "public_showcase", v4Graph: false })).toBe("Public Replay · 只读脱敏案例");
    expect(modeBadgeLabel({ mode: "local_owner", v4Graph: true })).toBe("Local Live · 可执行研究流程");
    expect(modeBadgeLabel({ mode: "local_owner", v4Graph: false })).toBe("本地模式 · V4 未启用");
  });
});
