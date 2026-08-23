import { describe, expect, it } from "vitest";
import { buildV4NavGroups } from "./WorkspaceSidebar";

describe("侧栏导航（公网演示收口）", () => {
  it("public_showcase 只显示 首页 + 完整商品案例", () => {
    const groups = buildV4NavGroups({ mode: "public_showcase", v4Graph: false });
    const items = groups.flatMap((g) => g.items.map((i) => ({ label: i.label, href: i.href })));
    expect(items).toEqual([
      { label: "首页", href: "/" },
      { label: "完整商品案例", href: "/replay" },
    ]);
  });
  it("公网导航不出现密码锁/旧工具入口", () => {
    const groups = buildV4NavGroups({ mode: "public_showcase", v4Graph: false });
    const labels = groups.flatMap((g) => g.items.map((i) => i.label)).join(",");
    for (const banned of ["商品研究", "研究记录", "待研究商品", "发现商品", "Listing Studio", "Image Studio", "案例回放", "V4 概览"]) {
      expect(labels).not.toContain(banned);
    }
  });
  it("local_owner 保持原有工作台导航（无回归）", () => {
    const groups = buildV4NavGroups({ mode: "local_owner", v4Graph: false });
    const labels = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("商品研究");
    expect(labels).toContain("研究记录");
    expect(labels).not.toContain("完整商品案例");
  });
});
