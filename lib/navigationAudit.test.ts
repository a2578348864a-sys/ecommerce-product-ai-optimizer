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

  it("main navigation only highlights the three current workflow entries", () => {
    const mainNavBlock = extractConstBlock(sidebarSource, "workspaceNavItems");
    const mainLabels = extractNavLabels(mainNavBlock);
    expect(mainLabels).toEqual(["机会雷达", "Agent 主链路", "任务中心"]);
    expect(mainNavBlock).toMatch(/\/opportunities/);
    expect(mainNavBlock).toMatch(/\/agent\/run/);
    expect(mainNavBlock).toMatch(/\/tasks/);
    expect(mainNavBlock).not.toMatch(/\/workflow\/batch/);
    expect(mainNavBlock).not.toMatch(/label:\s*"工作台"/);
  });

  it("marks batch analysis as advanced Alpha instead of a main nav entry", () => {
    const advancedBlock = extractConstBlock(sidebarSource, "advancedNavItems");
    expect(advancedBlock).toMatch(/批量分析（高级 \/ Alpha）/);
    expect(advancedBlock).toMatch(/\/workflow\/batch/);
    expect(sidebarSource).toMatch(/高级 \/ Alpha/);
    expect(sidebarSource).toMatch(/当前主流程仍以单个商品推进为主/);
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

  it("shows Agent 主链路 as the main sidebar entry", () => {
    // Phase Direction-Recovery.3: /agent/run is the sole external-facing Gen2 Agent main flow entry.
    // "Agent 主流程（备用）" is permanently removed.
    expect(sidebarSource).not.toMatch(/Agent 主流程（备用）/);
    expect(sidebarSource).toMatch(/Agent 主链路/);
    expect(sidebarSource).toMatch(/\/agent\/run/);
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

// ── /agent archive page ───────────────────────────

describe("/agent archive page", () => {
  const agentSource = readComponentSource("app/agent/page.tsx");

  it("shows archive message", () => {
    expect(agentSource).toMatch(/Agent 路线图已归档/);
  });

  it("provides CTA to /agent/run as the sole external-facing entry", () => {
    // Phase Direction-Recovery.3: /agent/run is the sole external-facing 8-step Agent main flow entry.
    // /workflow redirects to /agent/run.
    expect(agentSource).toMatch(/进入 Agent 主链路/);
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

  it("shows three main CTAs: 找机会, Agent 主链路, 任务中心", () => {
    expect(homeSource).toMatch(/找机会/);
    expect(homeSource).toMatch(/Agent 主链路/);
    expect(homeSource).toMatch(/任务中心/);
  });

  it("points to /agent/run for the Agent main flow step", () => {
    expect(homeSource).toMatch(/\/agent\/run/);
  });

  it("states the three-step workflow and links to each primary route", () => {
    const workflowStepsSection = homeSource.match(/workflowSteps[\s\S]*?\] as const/);
    expect(workflowStepsSection?.[0]).toMatch(/机会雷达/);
    expect(workflowStepsSection?.[0]).toMatch(/Agent 主链路/);
    expect(workflowStepsSection?.[0]).toMatch(/任务中心/);
    expect(workflowStepsSection?.[0]).toMatch(/href:\s*"\/opportunities"/);
    expect(workflowStepsSection?.[0]).toMatch(/href:\s*"\/agent\/run"/);
    expect(workflowStepsSection?.[0]).toMatch(/href:\s*"\/tasks"/);
    expect(homeSource).toMatch(/轻选 Agent 是一个跨境电商运营 Agent 工作台/);
    expect(homeSource).toMatch(/商品线索、AI 分析、Listing 准备和任务推进串成一条可复核流程/);
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

  it("uses 受控自动化 and 人工复核 copy", () => {
    expect(homeSource).toMatch(/受控自动化/);
    expect(homeSource).toMatch(/人工复核/);
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

  it("describes task center as an operations follow-up surface, not a report archive", () => {
    expect(tasksSource).toMatch(/任务中心用于跟进商品从候选、分析、Listing 准备到人工决策的状态/);
    expect(tasksSource).toMatch(/不只是 AI 报告仓库/);
  });
});

// ── HR demo banner regression ─────────────────────

describe("HR demo sandbox banner copy", () => {
  const bannerSource = readComponentSource("components/DemoAccessBanner.tsx");

  it("keeps the sandbox isolation message", () => {
    expect(bannerSource).toMatch(/HR 演示沙盒/);
    expect(bannerSource).toMatch(/正式数据只读/);
    expect(bannerSource).toMatch(/新增\/修改仅保存到演示沙盒/);
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
