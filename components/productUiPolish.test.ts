import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(resolve(__dirname, "..", relativePath), "utf8");
}

describe("Product UI polish v2", () => {
  const loginSource = readSource("components/LoginPage.tsx");
  const lockedPromptSource = readSource("components/WorkspaceLockedPrompt.tsx");
  const homeSource = readSource("components/HomeDashboardClient.tsx");
  const agentRunSource = readSource("components/agent/AgentRunClient.tsx");
  const historySource = readSource("components/TaskRecordsList.tsx");
  const detailSource = readSource("components/TaskRecordDetail.tsx");
  const layoutSource = readSource("app/layout.tsx");

  it("presents the public first screen as one five-step product journey", () => {
    expect(loginSource).toContain("AI 跨境商品研究工作台");
    expect(loginSource).toContain("轻选工作台");
    expect(loginSource).toContain('data-testid="login-product-journey"');
    expect(loginSource).toMatch(/number:\s*"01",\s*label:\s*"发现商品"/);
    expect(loginSource).toMatch(/number:\s*"02",\s*label:\s*"研究优先级"/);
    expect(loginSource).toMatch(/number:\s*"03",\s*label:\s*"AI 商品研究"/);
    expect(loginSource).toMatch(/number:\s*"04",\s*label:\s*"人工决策"/);
    expect(loginSource).toMatch(/number:\s*"05",\s*label:\s*"按需创作"/);
    expect(loginSource).not.toContain("跨境电商运营 Agent 工作台");
    expect(loginSource).not.toContain("商品分析完成");
    expect(loginSource).not.toContain("AI 复核通过");
    expect(loginSource).not.toContain("Owner 密码");
    expect(loginSource).not.toContain("进入商品研究助手");
    expect(lockedPromptSource).toContain("轻选工作台");
    expect(lockedPromptSource).not.toContain("跨境电商运营工作台");
    expect(lockedPromptSource).not.toContain("轻选 Agent");
  });

  it("puts the user journey before access and statistics on the signed-in home", () => {
    const journeyIndex = homeSource.indexOf('data-testid="home-workflow"');
    const passwordIndex = homeSource.indexOf('data-testid="home-password-entry"');
    const statisticsIndex = homeSource.indexOf("<StatCard", journeyIndex);

    expect(journeyIndex).toBeGreaterThan(-1);
    expect(passwordIndex).toBeGreaterThan(journeyIndex);
    expect(statisticsIndex).toBeGreaterThan(journeyIndex);
    expect(homeSource).toContain("当前状态");
    expect(homeSource).toContain("下一步入口");
    expect(homeSource).toMatch(/label:\s*"内容草稿"/);
    expect(homeSource).toContain("轻选工作台");
  });

  it("makes the research flow the first content section and hides technical panels", () => {
    const flowIndex = agentRunSource.indexOf('data-testid="agent-run-research-flow"');
    const inputIndex = agentRunSource.indexOf('id="product-research-input"');

    expect(flowIndex).toBeGreaterThan(-1);
    expect(inputIndex).toBeGreaterThan(flowIndex);
    // 极简收口：商品研究页不再渲染内部分析记录 / 技术详情入口
    expect(agentRunSource).not.toContain("内部分析记录");
    expect(agentRunSource).not.toContain("查看技术详情");
  });

  it("keeps history product-facing and titles details as a research result", () => {
    expect(historySource).toContain("商品");
    expect(historySource).toContain("研究状态");
    expect(historySource).toContain("当前决定");
    expect(historySource).toContain("历史成果");
    // Phase1：卡片级技术字段已从用户主流程移除
    expect(historySource).not.toContain("内部阶段");
    // R5：详情页标题按生命周期（active=商品研究 / historical=研究记录）
    expect(detailSource).toContain('isActiveResearchView ? "商品研究" : "研究记录"');
    // V3 Final R12：legacy 初始分析降级为折叠"历史初始分析"（当前结论以 EvidenceWorkbench 为准）
    expect(detailSource).toContain("历史初始分析");
    expect(detailSource).toContain("历史成果");
    // Phase 3：任务详情是研究记录，不再挂载五步推进工作台
    expect(detailSource).not.toContain("技术信息与原始数据");
    expect(detailSource).not.toContain("WorkflowStepWorkspace");
  });

  it("uses the converged product positioning in page metadata", () => {
    expect(layoutSource).toContain("轻选工作台");
    expect(layoutSource).toContain("AI 跨境商品研究工作台");
    expect(layoutSource).not.toContain("跨境电商运营全流程 Agent 工作台");
    expect(layoutSource).not.toContain("轻选 Agent");
  });
});
