import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Helpers ───────────────────────────────────────

function readComponentSource(filename: string): string {
  return readFileSync(resolve(__dirname, "..", filename), "utf-8");
}

function extractNavLabels(source: string): string[] {
  // Extract label values from nav item definitions
  const labels: string[] = [];
  const regex = /label:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    labels.push(match[1]);
  }
  return labels;
}

function extractConstBlock(source: string, constName: string): string {
  const match = source.match(new RegExp(`const ${constName} = \\[[\\s\\S]*?\\] as const;`));
  return match?.[0] || "";
}

// ── Sidebar / Navigation ──────────────────────────

describe("WorkspaceSidebar navigation", () => {
  const sidebarSource = readComponentSource("components/WorkspaceSidebar.tsx");

  it("exposes the six product-level destinations in the primary navigation", () => {
    const mainNavBlock = extractConstBlock(sidebarSource, "workspaceNavItems");
    const mainLabels = extractNavLabels(mainNavBlock);
    expect(mainLabels).toEqual([
      "工作台",
      "发现商品",
      "商品研究",
      "Listing Studio",
      "Image Studio",
      "研究历史",
    ]);
    expect(mainNavBlock).toMatch(/href:\s*"\/"/);
    expect(mainNavBlock).toMatch(/\/opportunities/);
    expect(mainNavBlock).toMatch(/\/agent\/run/);
    expect(mainNavBlock).toMatch(/\/listing-studio/);
    expect(mainNavBlock).toMatch(/\/image-studio/);
    expect(mainNavBlock).toMatch(/\/tasks/);
    expect(mainNavBlock).not.toMatch(/\/workflow\/batch/);
  });

  it("does not render an empty advanced section or expose legacy batch analysis", () => {
    const advancedBlock = extractConstBlock(sidebarSource, "advancedNavItems");
    expect(advancedBlock).toBe("");
    expect(sidebarSource).not.toMatch(/\/workflow\/batch/);
    expect(sidebarSource).not.toMatch(/高级 \/ Alpha/);
  });

  it("does not show old direction entries in navigation", () => {
    const navLabels = extractNavLabels(sidebarSource);
    // These should NOT appear as navigation labels
    expect(navLabels).not.toContain("能力路线图");
    expect(navLabels).not.toContain("Agent 路线图");
    expect(navLabels).not.toContain("辅助中心");
    expect(navLabels).not.toContain("爆款拆解");
    expect(navLabels).not.toContain("新品体检");
    expect(navLabels).not.toContain("小白结论");
    expect(navLabels).not.toContain("风险排查");
    expect(navLabels).not.toContain("货源判断");
    expect(navLabels).not.toContain("素材接入");
    expect(navLabels).not.toContain("素材接收");
  });

  it("no longer has the assistant tools group", () => {
    expect(sidebarSource).not.toMatch(/辅助工具/);
    expect(sidebarSource).not.toMatch(/assistantToolItems/);
  });

  it("no longer has the route map / 项目说明 entry", () => {
    expect(sidebarSource).not.toMatch(/routeMapItem/);
    expect(sidebarSource).not.toMatch(/项目说明/);
  });

  it("shows /agent/run as the primary product research destination", () => {
    const mainNavBlock = extractConstBlock(sidebarSource, "workspaceNavItems");
    const advancedBlock = extractConstBlock(sidebarSource, "advancedNavItems");
    expect(mainNavBlock).toMatch(/商品研究/);
    expect(mainNavBlock).toMatch(/\/agent\/run/);
    expect(advancedBlock).not.toMatch(/\/agent\/run/);
  });

  it("does not contain dangerous copy in nav labels", () => {
    const navLabels = extractNavLabels(sidebarSource);
    const dangerous = [
      "安全可卖",
      "无侵权风险",
      "已通过合规",
      "平台允许销售",
      "自动合规审核完成",
      "无需人工确认",
      "100% 安全",
      "全自动合规",
      "AI 已确认可卖",
      "可直接发布",
      "无需修改即可上架",
      "无人值守全自动",
      "全自动 Agent",
      "无人值守",
    ];
    for (const label of navLabels) {
      for (const d of dangerous) {
        expect(label).not.toContain(d);
      }
    }
  });
});

describe("legacy batch public entrance freeze", () => {
  it("removes ordinary links while preserving the direct route implementation", () => {
    for (const file of [
      "components/WorkspaceSidebar.tsx",
      "components/HomeDashboardClient.tsx",
      "components/cross-border/WorkflowClient.tsx",
      "components/TaskRecordsList.tsx",
      "components/TaskRecordDetail.tsx",
    ]) {
      expect(readComponentSource(file)).not.toMatch(/href=["{]?"\/workflow\/batch/);
    }
    expect(() => readFileSync(resolve(__dirname, "..", "app/workflow/batch/page.tsx"), "utf8")).not.toThrow();
    expect(() => readFileSync(resolve(__dirname, "..", "components/cross-border/WorkflowBatchClient.tsx"), "utf8")).not.toThrow();
  });
});

// ── /agent archive page ───────────────────────────

describe("/agent archive page", () => {
  const agentSource = readComponentSource("app/agent/page.tsx");

  it("shows archive message", () => {
    expect(agentSource).toMatch(/Agent 路线图已归档/);
  });

  it("provides a downgraded advanced CTA to /agent/run", () => {
    expect(agentSource).toMatch(/进入高级临时分析/);
    expect(agentSource).toMatch(/\/agent\/run/);
    expect(agentSource).not.toMatch(/\/workflow/);
  });

  it("provides CTA to /opportunities", () => {
    expect(agentSource).toMatch(/\/opportunities/);
  });

  it("provides CTA to /tasks", () => {
    expect(agentSource).toMatch(/\/tasks/);
  });

  it("does not show old roadmap big cards", () => {
    // The archive page mentions "规划中" in its explanation text,
    // but should not use it as a status indicator (⏸️ 规划中 badge)
    expect(agentSource).not.toMatch(/⏸️\s*规划中/);
    expect(agentSource).not.toMatch(/全自动 Agent 路线图/);
    expect(agentSource).not.toMatch(/暂不可用/);
    // Old planned abilities grid should be gone
    expect(agentSource).not.toMatch(/plannedAbilities/);
  });

  it("does not show old planned abilities grid", () => {
    expect(agentSource).not.toMatch(/plannedAbilities/);
  });

  it("metadata title is updated", () => {
    expect(agentSource).toMatch(/Agent 路线图已归档/);
  });

  it("does not contain dangerous promises", () => {
    const dangerous = [
      "安全可卖",
      "无侵权风险",
      "已通过合规",
      "平台允许销售",
      "无需人工确认",
      "100% 安全",
      "全自动合规",
      "AI 已确认可卖",
      "可直接发布",
      "无需修改即可上架",
      "无人值守全自动",
    ];
    for (const d of dangerous) {
      expect(agentSource).not.toMatch(new RegExp(d));
    }
  });
});

// ── Home page ─────────────────────────────────────

describe("HomeDashboardClient navigation", () => {
  const homeSource = readComponentSource("components/HomeDashboardClient.tsx");

  it("positions the product as an AI cross-border product research assistant", () => {
    expect(homeSource).toMatch(/AI 跨境商品研究助手/);
    expect(homeSource).toMatch(/辅助研究 · 人工确认/);
  });

  it("shows the five-stage user workflow and primary routes", () => {
    const workflowStepsSection = homeSource.match(/workflowSteps[\s\S]*?\] as const/);
    expect(workflowStepsSection?.[0]).toMatch(/发现商品/);
    expect(workflowStepsSection?.[0]).toMatch(/商品研究/);
    expect(workflowStepsSection?.[0]).toMatch(/Listing 准备/);
    expect(workflowStepsSection?.[0]).toMatch(/图片创作/);
    expect(workflowStepsSection?.[0]).toMatch(/人工确认/);
    expect(workflowStepsSection?.[0]).toMatch(/href:\s*"\/opportunities"/);
    expect(workflowStepsSection?.[0]).toMatch(/href:\s*"\/agent\/run"/);
    expect(workflowStepsSection?.[0]).toMatch(/href:\s*"\/listing-studio"/);
    expect(workflowStepsSection?.[0]).toMatch(/href:\s*"\/image-studio"/);
    expect(workflowStepsSection?.[0]).toMatch(/href:\s*"\/tasks"/);
    expect(homeSource).toMatch(/五步完成一次商品研究/);
    expect(homeSource).toMatch(/当前为人工复核版/);
  });

  it("does not show old direction entries as primary CTAs", () => {
    // Home page should not have 能力路线图 or 辅助中心 as main CTAs
    const workflowStepsSection = homeSource.match(/workflowSteps[\s\S]*?\] as const/);
    if (workflowStepsSection) {
      expect(workflowStepsSection[0]).not.toMatch(/能力路线图/);
      expect(workflowStepsSection[0]).not.toMatch(/辅助中心/);
      expect(workflowStepsSection[0]).not.toMatch(/辅助工具/);
    }
  });

  it("uses research assistance and human confirmation copy", () => {
    expect(homeSource).toMatch(/辅助研究/);
    expect(homeSource).toMatch(/人工确认/);
  });

  it("does not use 无人值守全自动", () => {
    expect(homeSource).not.toMatch(/无人值守全自动/);
    expect(homeSource).not.toMatch(/AI 自动完成所有商业动作/);
  });
});

// ── Agent run page ────────────────────────────────

describe("AgentRunClient main flow links", () => {
  const agentRunSource = readComponentSource("components/agent/AgentRunClient.tsx");

  it("does not guide users back to /workflow from the current Agent main flow", () => {
    expect(agentRunSource).not.toMatch(/<Link href="\/workflow"/);
    expect(agentRunSource).not.toMatch(/return `\/workflow/);
    expect(agentRunSource).not.toMatch(/返回单品分析页查看细节/);
  });

  it("shows the three research phases while preserving the old flow as technical detail", () => {
    expect(agentRunSource).toMatch(/三阶段商品研究/);
    expect(agentRunSource).toMatch(/商品理解/);
    expect(agentRunSource).toMatch(/市场研究/);
    expect(agentRunSource).toMatch(/创作准备/);
    expect(agentRunSource).toMatch(/内部分析记录/);
    expect(agentRunSource).toMatch(/agent-run-technical-details/);
    expect(agentRunSource).toMatch(/TIMELINE_STEPS\.map/);
    expect(agentRunSource).toMatch(/saveAgentRunCache/);
    expect(agentRunSource).toMatch(/loadAgentRunCache/);
    expect(agentRunSource).toMatch(/\/api\/workflows\/product-analysis/);
    expect(agentRunSource).toMatch(/\/api\/workflows\/product-analysis\/save-task/);
  });
});

// ── Workflow batch page ───────────────────────────

describe("WorkflowBatchClient advanced Alpha positioning", () => {
  const batchSource = readComponentSource("components/cross-border/WorkflowBatchClient.tsx");

  it("marks batch analysis as advanced Alpha and not the current main flow", () => {
    expect(batchSource).toMatch(/批量分析（高级 \/ Alpha）/);
    expect(batchSource).toMatch(/非当前主链路/);
    expect(batchSource).toMatch(/当前主流程仍以单个商品推进为主/);
  });
});

// ── Tasks page copy ───────────────────────────────

describe("TaskRecordsList operational positioning", () => {
  const tasksSource = readComponentSource("components/TaskRecordsList.tsx");

  it("describes the route as product research history", () => {
    expect(tasksSource).toMatch(/研究历史/);
    expect(tasksSource).toMatch(/按商品查看已经完成的研究、创作准备和人工结论/);
    expect(tasksSource).toMatch(/最终决定始终由你确认/);
  });

  it("shows product-facing fields and keeps operational evidence collapsed", () => {
    expect(tasksSource).toMatch(/deriveProductResearchPresentation/);
    expect(tasksSource).toMatch(/deriveTaskOperationSummary/);
    expect(tasksSource).toMatch(/当前阶段/);
    expect(tasksSource).toMatch(/已生成内容/);
    expect(tasksSource).toMatch(/最后更新/);
    expect(tasksSource).toMatch(/下一步/);
    expect(tasksSource).toMatch(/技术状态与证据/);
    expect(tasksSource).toMatch(/内部流水线、风险统计和优先处理建议，默认折叠/);
  });
});

describe("TaskRecordDetail operation overview", () => {
  const detailSource = readComponentSource("components/TaskRecordDetail.tsx");
  const heroSource = readComponentSource("components/TaskDecisionHero.tsx");

  it("retains all B1/B2/B3 sections and adds TaskDecisionHero", () => {
    // B3 operation overview retained (renamed to 运营推进与状态)
    expect(detailSource).toMatch(/deriveTaskOperationSummary/);
    expect(detailSource).toMatch(/运营推进与状态/);
    // B1/B2 sections retained
    expect(detailSource).toMatch(/AgentOutputSnapshotCard/);
    expect(detailSource).toMatch(/DecisionEvidencePanel/);
    expect(detailSource).toMatch(/来源证据/);
    expect(detailSource).toMatch(/agent-run-review/);
    // New IA: TaskDecisionHero with stage/blocker/review info
    expect(detailSource).toMatch(/TaskDecisionHero/);
    expect(heroSource).toMatch(/当前决策与下一步/);
    expect(heroSource).toMatch(/当前阶段/);
    // Process info collapsed by default
    expect(detailSource).toMatch(/过程与原始记录/);
  });
});

// ── HR demo banner regression ─────────────────────

describe("visitor experience copy", () => {
  const bannerSource = readComponentSource("components/DemoAccessBanner.tsx");
  const loginSource = readComponentSource("components/LoginPage.tsx");

  it("keeps the sandbox isolation message", () => {
    expect(bannerSource).toMatch(/访客体验/);
    expect(bannerSource).not.toMatch(/HR 演示/);
    expect(bannerSource).toMatch(/正式数据只读/);
    expect(bannerSource).toMatch(/新增\/修改仅保存到访客沙盒/);
    expect(loginSource).toMatch(/访客体验/);
    expect(loginSource).not.toMatch(/HR 演示/);
  });
});

describe("screening preview is internal-only", () => {
  const sidebarSource = readComponentSource("components/WorkspaceSidebar.tsx");
  const homeSource = readComponentSource("components/HomeDashboardClient.tsx");
  const agentRunSource = readComponentSource("components/agent/AgentRunClient.tsx");
  const previewSource = readComponentSource("app/opportunities/screening-preview/page.tsx");

  it("never links the diagnostic route from user-facing navigation or guidance", () => {
    expect(sidebarSource).not.toMatch(/screening-preview/);
    expect(homeSource).not.toMatch(/screening-preview/);
    expect(agentRunSource).not.toMatch(/screening-preview/);
  });

  it("is visibly internal and resolves a validated project materials root", () => {
    expect(previewSource).toMatch(/内部诊断 · 非正式导航/);
    expect(previewSource).toMatch(/environment:\s*"development"/);
    expect(previewSource).toMatch(/resolveProjectMaterialsRoot/);
    expect(previewSource).toMatch(/materialsRoot\.status === "ready"/);
  });
});

// ── Regression: key pages exist ───────────────────

describe("key page routes still exist", () => {
  const pageFiles = [
    "app/agent/page.tsx",
    "app/agent/run/page.tsx",
    "app/opportunities/page.tsx",
    "app/tasks/page.tsx",
    "app/workflow/page.tsx",
    "app/workflow/batch/page.tsx",
    "app/sourcing/page.tsx",
    "app/risk/page.tsx",
    "app/summary/page.tsx",
    "app/viral/page.tsx",
    "app/materials/page.tsx",
    "app/products/new/page.tsx",
  ];

  for (const file of pageFiles) {
    it(`${file} exists (direct route preserved)`, () => {
      expect(() => readFileSync(resolve(__dirname, "..", file), "utf-8")).not.toThrow();
    });
  }
});
