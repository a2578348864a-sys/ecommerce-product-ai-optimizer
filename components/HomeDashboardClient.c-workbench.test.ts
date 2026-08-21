import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string } & Record<string, unknown>) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/components/WorkspaceSidebar", () => ({
  WorkspaceSidebar: () => null,
  WorkspaceMobileNav: () => null,
}));

import { HomeDashboardClient } from "@/components/HomeDashboardClient";

function renderLocal(v4Graph: boolean) {
  return renderToStaticMarkup(createElement(HomeDashboardClient, {
    runtime: { mode: "local_owner", noAuthOwner: false, v4Graph },
  }));
}

describe("home dashboard C-end local workbench", () => {
  it("renders the workbench with Chinese-only user language (local flag on)", () => {
    const html = renderLocal(true);

    expect(html).toContain("工作台");
    expect(html).toContain("了解你的商品研究进度，下一步由你决定。");
    expect(html).toContain("开始商品研究");
    expect(html).toContain("等待我确认");
    expect(html).toContain("正在研究");
    expect(html).toContain("失败待处理");
    expect(html).toContain("最近完成");
    // 初始为读取中（诚实加载态）
    expect(html).toContain("正在读取研究记录…");

    // 普通页面不得出现内部英文枚举 / 技术标签
    expect(html).not.toContain("Evidence");
    expect(html).not.toContain("Gate");
    expect(html).not.toContain("blocked");
    expect(html).not.toContain("unknown");
    expect(html).not.toContain("revision");
    expect(html).not.toContain("approve_export");
    expect(html).not.toContain("hash");
    expect(html).not.toContain("token");
  });

  it("shows plain text guide instead of live data when the local flag is off", () => {
    const html = renderLocal(false);

    expect(html).toContain("本地研究能力未开启，请联系管理员开启后使用");
    expect(html).not.toContain("开始商品研究");
    expect(html).not.toContain("等待我确认");
  });
});
