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
    expect(html).toContain(">保存后在任务详情准备<");
    expect(html).toContain(">发现商品<");
    expect(html).toContain(">研究历史<");
    expect(html).not.toContain(">任务中心<");
  });

  it("移除内部分析记录等技术入口，保留待人工核验与人工保存门禁", () => {
    // 极简收口：普通用户页面不再渲染内部分析记录 / 技术详情入口
    expect(clientSource).not.toContain("内部分析记录");
    expect(clientSource).not.toContain("查看技术详情");
    expect(clientSource).not.toContain("data-testid=\"agent-run-technical-details\"");
    expect(clientSource).not.toContain("TIMELINE_STEPS.map");

    // 待人工核验默认折叠，但展开状态受控于会话草稿（刷新恢复"当前展开区域"）
    expect(clientSource).toMatch(
      /<details(?=[^>]*data-testid="agent-run-human-verification")[^>]*open=\{humanVerificationOpen\}/,
    );
    expect(clientSource).toContain("const [humanVerificationOpen, setHumanVerificationOpen] = useState(false)");
    expect(clientSource).toContain("待人工核验");
    expect(clientSource).toContain("供货与供应商");
    expect(clientSource).toContain("成本与利润");
    expect(clientSource).toContain("合规与知识产权");
    expect(clientSource).toContain("当前没有可靠供应商数据，需要人工寻找和确认。");
    expect(clientSource).toContain("需要补充采购、物流、平台费用和广告预算后才能计算。");
    expect(clientSource).toContain("不能替代专业合规或知识产权审核。");

    expect(clientSource).toContain("const manualReady = MANUAL_ITEMS.every");
    expect(clientSource).toContain("以下是流程复核声明，不代表商品字段已被人工确认");
    expect(clientSource).toContain("const manualReviewGateSatisfied = !candidateMode");
    expect(clientSource).toContain(': productResearchDecisionStatus !== "creative_ready" || manualReady');
    expect(clientSource).toContain("disabled={saving || !manualReviewGateSatisfied || !candidateDecisionValid}");
    expect(clientSource).toContain("进入创作准备前，请先完成 4 项人工确认。");
    expect(clientSource).toContain("/api/workflows/product-analysis/save-task");
    expect(clientSource).toContain("productResearchDecision:");
    expect(clientSource).toContain('value: "creative_ready"');
    expect(clientSource).toContain('value: "needs_information"');
    expect(clientSource).toContain('value: "abandoned"');
    expect(clientSource).toContain("researchDecisionIdRef.current = createBrowserUuid()");
    expect(clientSource).toContain('result.status === "partial_failed" && option.value !== "needs_information"');
    expect(clientSource).toContain('partial_failed 可在未完成四项流程复核时保存为“待补信息”');
    expect(clientSource).toContain("不会自动创建 Listing、图片或发布任务");
  });

  it("不使用计时器伪造完成状态，失败后也不会保留推测完成步骤", () => {
    expect(clientSource).not.toContain("window.setInterval");
    expect(clientSource).not.toContain("cursor += 1");
    expect(clientSource).toContain('setStepStatuses({ ...INITIAL_STATUSES, normalize: "failed" })');
  });

  it("Phase 1 商品研究请求显式关闭 Listing 步骤", () => {
    expect(clientSource).toContain("options: { runListing: false }");
  });

  it("商品研究使用安全 JSON 边界且不显示原始解析异常", () => {
    expect(clientSource).toContain("readJsonApiResponse(response)");
    expect(clientSource).toContain("商品研究服务暂时异常，请稍后重试。");
    expect(clientSource).not.toContain("runError instanceof Error ? runError.message");
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

  it("Candidate 授权完成前不渲染 URL 伪造的商品上下文", () => {
    const html = renderToStaticMarkup(
      createElement(AgentRunClient, {
        candidateMode: true,
        candidateId: "sandbox_candidate_a",
      }),
    );

    expect(html).toContain("正在验证候选商品");
    expect(html).not.toContain("Visitor A secret product");
    expect(html).not.toContain("A-SECRET-ASIN");
    expect(html).not.toContain("visitor-a-batch");
    expect(clientSource).toContain("candidate_context_loading");
    expect(clientSource).toContain("candidate_context_ready");
    expect(clientSource).toContain("candidate_context_invalid");
    expect(clientSource).toContain("候选不存在或不属于当前访问身份，请返回发现商品重新选择。");
    expect(clientSource).toContain("/api/opportunity-candidates/research-context");
    expect(clientSource).toContain("ResearchProductImage");
    expect(clientSource).toContain("商品图片来自已验证并缓存的 Candidate 快照。");
    expect(clientSource).toContain("updateDemoAccessSnapshot");
  });
});
