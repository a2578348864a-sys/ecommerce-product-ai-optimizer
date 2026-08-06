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
    expect(loginSource).toContain("AI 跨境商品研究助手");
    expect(loginSource).toContain('data-testid="login-product-journey"');
    expect(loginSource).toMatch(/number:\s*"01",\s*label:\s*"发现商品"/);
    expect(loginSource).toMatch(/number:\s*"02",\s*label:\s*"商品研究"/);
    expect(loginSource).toMatch(/number:\s*"03",\s*label:\s*"Listing 准备"/);
    expect(loginSource).toMatch(/number:\s*"04",\s*label:\s*"图片创作"/);
    expect(loginSource).toMatch(/number:\s*"05",\s*label:\s*"人工确认"/);
    expect(loginSource).not.toContain("跨境电商运营 Agent 工作台");
    expect(loginSource).not.toContain("商品分析完成");
    expect(loginSource).not.toContain("AI 复核通过");
    expect(lockedPromptSource).toContain("AI 跨境商品研究助手");
    expect(lockedPromptSource).not.toContain("跨境电商运营工作台");
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
    expect(homeSource).toMatch(/label:\s*"人工确认"/);
    expect(homeSource).toContain("AI 辅助 · 人工确认");
  });

  it("makes the three-stage research flow the first content section", () => {
    const flowIndex = agentRunSource.indexOf('data-testid="agent-run-research-flow"');
    const inputIndex = agentRunSource.indexOf('id="product-research-input"');

    expect(flowIndex).toBeGreaterThan(-1);
    expect(inputIndex).toBeGreaterThan(flowIndex);
    expect(agentRunSource).toContain("内部分析记录");
  });

  it("keeps history product-facing and titles details as a research result", () => {
    expect(historySource).toContain("商品");
    expect(historySource).toContain("当前阶段");
    expect(historySource).toContain("已生成内容");
    expect(historySource).toContain("下一步");
    expect(historySource).toContain("技术状态与证据");
    expect(detailSource).toContain("商品研究结果");
    expect(detailSource).toContain("已有产物");
    // E：任务详情为步骤工作台，技术信息收进折叠区
    expect(detailSource).toContain("技术信息与原始数据");
    expect(detailSource).toContain("WorkflowStepWorkspace");
  });

  it("uses the converged product positioning in page metadata", () => {
    expect(layoutSource).toContain("AI 跨境商品研究助手");
    expect(layoutSource).not.toContain("跨境电商运营全流程 Agent 工作台");
  });
});
