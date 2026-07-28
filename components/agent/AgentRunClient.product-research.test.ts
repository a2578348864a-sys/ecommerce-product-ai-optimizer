import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/client/accessPassword", () => ({
  useAccessPassword: () => ["test-access", () => undefined, true],
}));

vi.mock("@/components/WorkspaceSidebar", () => ({
  WorkspaceSidebar: () => null,
  WorkspaceMobileNav: () => null,
}));

const { AgentRunClient, normalizeCachedStepStatuses } = await import("./AgentRunClient");
const clientSource = readFileSync(new URL("./AgentRunClient.tsx", import.meta.url), "utf8");

describe("商品研究三阶段主视图", () => {
  it("默认用三个用户阶段说明研究流程，并提供发现商品与研究历史入口", () => {
    const html = renderToStaticMarkup(
      createElement(AgentRunClient, { initialProductName: "桌面手机支架" }),
    );

    expect(html).toContain(">商品研究<");
    expect(html.match(/data-testid="agent-run-research-stage"/g)).toHaveLength(3);
    expect(html).toContain("商品理解");
    expect(html).toContain("市场研究");
    expect(html).toContain("创作准备");
    expect(html.match(/>已完成内容</g)).toHaveLength(3);
    expect(html).toContain(">填写商品信息<");
    expect(html).toContain(">开始市场研究<");
    expect(html).toContain(">打开 Listing Studio<");
    expect(html).toContain(">发现商品<");
    expect(html).toContain(">研究历史<");
    expect(html).not.toContain(">任务中心<");
  });

  it("把原八步和未验证事项放入默认关闭的详情，同时保留人工保存门禁", () => {
    expect(clientSource).toMatch(
      /<details(?=[^>]*data-testid="agent-run-technical-details")(?![^>]*\bopen(?:=|\s|>))[^>]*>/,
    );
    expect(clientSource).toContain("内部分析记录");
    expect(clientSource).toContain("不代表系统已经完成商业判断");
    expect(clientSource).toContain("最终需要人工确认");
    expect(clientSource).toContain("TIMELINE_STEPS.map");

    expect(clientSource).toMatch(
      /<details(?=[^>]*data-testid="agent-run-human-verification")(?![^>]*\bopen(?:=|\s|>))[^>]*>/,
    );
    expect(clientSource).toContain("待人工核验");
    expect(clientSource).toContain("供货与供应商");
    expect(clientSource).toContain("成本与利润");
    expect(clientSource).toContain("合规与知识产权");
    expect(clientSource).toContain("当前没有可靠供应商数据，需要人工寻找和确认。");
    expect(clientSource).toContain("需要补充采购、物流、平台费用和广告预算后才能计算。");
    expect(clientSource).toContain("不能替代专业合规或知识产权审核。");

    expect(clientSource).toContain("const manualReady = MANUAL_ITEMS.every");
    expect(clientSource).toContain("disabled={saving || !manualReady}");
    expect(clientSource).toContain("请先完成 4 项人工确认，再保存任务。");
    expect(clientSource).toContain("/api/workflows/product-analysis/save-task");
  });

  it("不使用计时器伪造完成状态，失败后也不会保留推测完成步骤", () => {
    expect(clientSource).not.toContain("window.setInterval");
    expect(clientSource).not.toContain("cursor += 1");
    expect(clientSource).toContain('setStepStatuses({ ...INITIAL_STATUSES, normalize: "failed" })');
  });

  it("即使 API 供货步骤成功，也只显示需人工确认而不是绿色已完成", () => {
    expect(clientSource).not.toContain(
      'sourcing: apiStatusToTimeline(getApiStep(workflowResult, "sourcing")?.status)',
    );
    expect(clientSource).toContain('sourcing: "needs_manual_review"');
  });

  it("恢复旧缓存时也不会把供货状态重新显示为绿色已完成", () => {
    const restored = normalizeCachedStepStatuses({
      normalize: "completed",
      market: "completed",
      sourcing: "completed",
      listing: "completed",
    });

    expect(restored).toMatchObject({
      normalize: "completed",
      market: "completed",
      sourcing: "needs_manual_review",
      listing: "completed",
    });
  });
});
