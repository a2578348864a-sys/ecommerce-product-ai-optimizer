import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeDashboardClient } from "@/components/HomeDashboardClient";
import { LoginPage } from "@/components/LoginPage";
import { WorkspaceLockedPrompt } from "@/components/WorkspaceLockedPrompt";

describe("calm decision desk information architecture", () => {
  it("uses one focused access panel without decorative status noise", () => {
    const html = renderToStaticMarkup(createElement(LoginPage, {
      onSubmit: async () => undefined,
      error: "",
      loading: false,
    }));

    expect(html).toContain("先找候选，再决定要不要继续。");
    expect(html).toContain("我的工作台");
    expect(html).toContain("体验版");
    expect(html).toContain("访问密码");
    expect((html.match(/<form/gu) ?? [])).toHaveLength(1);
    expect(html).not.toContain("login-orb");
    expect(html).not.toContain("商品分析完成");
    expect(html).not.toContain("Listing 草稿就绪");
  });

  it("puts the recommended action before compact status and keeps one workflow explanation", () => {
    const html = renderToStaticMarkup(createElement(HomeDashboardClient));
    const recommendationIndex = html.indexOf("data-testid=\"dashboard-recommendation\"");
    const statsIndex = html.indexOf("data-testid=\"dashboard-stats\"");

    expect(recommendationIndex).toBeGreaterThan(-1);
    expect(statsIndex).toBeGreaterThan(recommendationIndex);
    expect(html).toContain("工作路径");
    expect(html).not.toContain("新手三步开始");
    expect(html).not.toContain("三步主路径");
  });

  it("keeps locked pages concise and directs the user back to the single unlock point", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceLockedPrompt, {
      pageName: "任务中心",
      returnUrl: "/tasks",
    }));

    expect(html).toContain("先解锁工作台");
    expect(html).toContain("任务中心需要访问密码");
    expect(html).toContain("解锁后会自动回到这里");
    expect(html).toContain("返回首页");
    expect(html).not.toContain("跨境电商运营工作台");
    expect(html).not.toContain("12 小时");
  });
});
