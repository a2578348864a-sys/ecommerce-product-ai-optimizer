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

import {
  buildLocalProductProjects,
  collectPagedTasks,
  HomeDashboardClient,
  loadWorkbenchTasks,
  resolveStartResearchHref,
  type LocalTaskItem,
} from "@/components/HomeDashboardClient";
import { projectTaskResultForBrowser } from "@/lib/productResearchPublicDto";
import { computeResearchEvidenceHash } from "@/lib/productResearchRecord";

function listTask(input: Partial<LocalTaskItem> & Pick<LocalTaskItem, "id" | "updatedAt">): LocalTaskItem {
  return {
    id: input.id,
    createdAt: input.createdAt ?? input.updatedAt,
    updatedAt: input.updatedAt,
    type: input.type ?? "workflow",
    decisionStatus: input.decisionStatus ?? "pending",
    title: input.title ?? "同名商品 商品研究",
    materialText: input.materialText ?? "",
    oneLineSummary: input.oneLineSummary ?? "",
    result: input.result ?? {},
    productImage: input.productImage ?? null,
    productProjectKey: input.productProjectKey ?? `ppk_task_${input.id}`,
    aiRunStatus: input.aiRunStatus,
    runUpdatedAt: input.runUpdatedAt,
  };
}

function savedResearchRecord() {
  const researchHash = "a".repeat(64);
  const latestDecision = {
    decisionId: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    status: "creative_ready",
    reason: "已保存人工决定",
    nextAction: null,
    researchHash,
    decidedAt: "2026-08-20T00:00:00.000Z",
    actor: { mode: "owner", actorRef: "owner:v1" },
  };
  return {
    schema: "product-research-record.v1",
    revision: 1,
    researchHash,
    candidateId: "candidate-private",
    runId: "run-private",
    contextHash: "b".repeat(64),
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    latestDecision,
    decisionEvents: [latestDecision],
  };
}

function listProjection(raw: Record<string, unknown>, oneLineSummary = "") {
  return projectTaskResultForBrowser(raw, "list", {
    id: "task-projected",
    type: "workflow",
    title: "同名商品 商品研究",
    oneLineSummary,
    decisionStatus: "pending",
  });
}

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
    expect(html).toContain("正在确认可研究商品");
    expect(html).toContain("需要我处理");
    expect(html).toContain("AI 研究中");
    expect(html).toContain("已完成");
    expect(html).not.toContain("失败待处理");
    // 初始为读取中（诚实加载态）
    expect(html).toContain("正在读取商品项目…");

    // 正式工作台只能进入正式路由，不能把原型入口冒充完成。
    // 轮 7：首屏“正在确认可研究商品”（确认后进入 startable / 发现商品，见 resolveStartResearchHref 测试）
    expect(html).not.toContain("/prototype");

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
    expect(html).not.toContain("开始研究一个商品");
    expect(html).not.toContain("需要我处理");
  });

  it("aggregates only by the real list DTO productProjectKey and keeps same-name products separate", () => {
    const projected = (candidateId: string) => projectTaskResultForBrowser({
      productName: "同名商品",
      sourceMeta: { source: "opportunity", candidateId },
      candidateToTask: { version: 1, candidateId },
    }, "list", { type: "workflow", title: "同名商品 商品研究", decisionStatus: "pending" });
    const tasks = [
      listTask({ id: "task-old", updatedAt: "2026-08-20T00:00:00.000Z", productProjectKey: "ppk_product_a", result: projected("candidate-a") }),
      listTask({ id: "task-new", updatedAt: "2026-08-21T00:00:00.000Z", productProjectKey: "ppk_product_a", result: projected("candidate-a") }),
      listTask({ id: "task-other", updatedAt: "2026-08-19T00:00:00.000Z", productProjectKey: "ppk_product_b", result: projected("candidate-b") }),
    ];

    expect(JSON.stringify(tasks)).not.toContain("candidateId");
    expect(JSON.stringify(tasks)).not.toContain("sourceMeta");
    expect(JSON.stringify(tasks)).not.toContain("candidateToTask");

    const projects = buildLocalProductProjects(tasks);

    expect(projects).toHaveLength(2);
    expect(projects[0]).toMatchObject({ key: "ppk_product_a", taskCount: 2, task: { id: "task-new" } });
    expect(projects[1]).toMatchObject({ key: "ppk_product_b", taskCount: 1, task: { id: "task-other" } });
  });

  it("只使用服务端 aiRunStatus 分组：运行中/失败/取消/等待的正式状态优先级正确", () => {
    const staleBase: Record<string, unknown> = {
      productName: "已过期商品",
      browserEvidence: { schema: "browser-evidence.v1", snapshots: [{ fields: { asin: { value: "B0STALE" } } }] },
      researchRecord: savedResearchRecord(),
    };
    const completionHash = computeResearchEvidenceHash(staleBase)!;
    const staleRaw = {
      ...staleBase,
      researchCompletion: {
        schema: "research-completion.v1",
        status: "completed",
        completedAt: "2026-08-20T01:00:00.000Z",
        decisionId: "11111111-1111-4111-8111-111111111111",
        revision: 1,
        finalStatus: "creative_ready",
        evidenceHash: completionHash,
      },
      sourcingEvidence: { schema: "sourcing-evidence.v1", candidates: [] },
    };
    const projects = buildLocalProductProjects([
      listTask({ id: "missing", updatedAt: "2026-08-22T01:00:00.000Z", result: listProjection({ productName: "OXO Steel 11-in Whisk" }) }),
      listTask({ id: "failed-recoverable", updatedAt: "2026-08-22T02:00:00.000Z", aiRunStatus: "failed_recoverable", result: listProjection({ productName: "可恢复失败商品" }) }),
      listTask({ id: "failed-terminal", updatedAt: "2026-08-22T02:30:00.000Z", aiRunStatus: "failed_terminal", result: listProjection({ productName: "终态失败商品" }) }),
      listTask({ id: "cancelled", updatedAt: "2026-08-22T02:40:00.000Z", aiRunStatus: "cancelled", result: listProjection({ productName: "已取消商品" }) }),
      listTask({ id: "waiting", updatedAt: "2026-08-22T02:50:00.000Z", aiRunStatus: "waiting", result: listProjection({ productName: "等待中商品" }) }),
      listTask({ id: "running", updatedAt: "2026-08-22T04:00:00.000Z", aiRunStatus: "running", result: listProjection({ productName: "运行商品" }) }),
      listTask({ id: "stale", updatedAt: "2026-08-22T06:00:00.000Z", decisionStatus: "continue", aiRunStatus: "research_stale", result: listProjection(staleRaw) }),
      listTask({ id: "completed", updatedAt: "2026-08-22T07:00:00.000Z", decisionStatus: "continue", result: listProjection({ productName: "完成商品", researchRecord: savedResearchRecord() }) }),
    ]);
    const byId = new Map(projects.map((project) => [project.task.id, project]));

    expect(byId.get("missing")!).toMatchObject({ group: "needs_action", statusLabel: "研究记录待补充", nextLabel: "补充研究资料" });
    for (const id of ["failed-recoverable", "failed-terminal"]) {
      expect(byId.get(id)!).toMatchObject({ group: "needs_action", statusLabel: "研究失败，待处理", nextLabel: "补充研究资料" });
    }
    expect(byId.get("cancelled")!).toMatchObject({ group: "needs_action", statusLabel: "研究已取消，待处理", nextLabel: "重新发起研究" });
    expect(byId.get("waiting")!).toMatchObject({ group: "needs_action", statusLabel: "研究等待处理", nextLabel: "查看研究进度" });
    expect(byId.get("running")!).toMatchObject({ group: "researching", statusLabel: "AI 正在研究", nextLabel: "查看研究进度" });
    expect(byId.get("stale")!).toMatchObject({ group: "needs_action", statusLabel: "研究资料需重新确认", nextLabel: "重新确认研究资料" });
    expect(byId.get("completed")!).toMatchObject({ group: "completed", statusLabel: "研究已完成", nextLabel: "查看研究结果" });
  });

  it("终态失败/取消优先于已完成：即使有完整研究与人工决定，也不落入已完成", () => {
    const record = savedResearchRecord();
    const completeResult = listProjection({ productName: "完成但失败的商品", researchRecord: record });
    const projects = buildLocalProductProjects([
      listTask({ id: "t1", updatedAt: "2026-08-22T01:00:00.000Z", aiRunStatus: "failed_terminal", decisionStatus: "continue", result: completeResult }),
      listTask({ id: "t2", updatedAt: "2026-08-22T02:00:00.000Z", aiRunStatus: "failed_recoverable", decisionStatus: "continue", result: completeResult }),
      listTask({ id: "t3", updatedAt: "2026-08-22T03:00:00.000Z", aiRunStatus: "cancelled", decisionStatus: "continue", result: completeResult }),
      listTask({ id: "t4", updatedAt: "2026-08-22T04:00:00.000Z", decisionStatus: "continue", result: completeResult }),
    ]);
    const byId = new Map(projects.map((project) => [project.task.id, project]));
    expect(byId.get("t1")!.group).toBe("needs_action");
    expect(byId.get("t2")!.group).toBe("needs_action");
    expect(byId.get("t3")!.group).toBe("needs_action");
    expect(byId.get("t4")!.group).toBe("completed");
  });



  it("同一商品多任务：项目状态以最新研究尝试（runUpdatedAt）为准，不因较新 task.updatedAt 隐藏运行中/等待中的当前研究", () => {
    const runA = listProjection({ productName: "同款商品", researchRecord: savedResearchRecord() });
    const runB = listProjection({ productName: "同款商品" });
    const projects = buildLocalProductProjects([
      // A：运行中，run 更新（runUpdatedAt 较大），task.updatedAt 较旧
      listTask({ id: "t-run-new", updatedAt: "2026-08-20T00:00:00.000Z", aiRunStatus: "running", runUpdatedAt: "2026-08-22T05:00:00.000Z", productProjectKey: "ppk_same", result: runA }),
      // B：已完成，task.updatedAt 较新但 run 更旧（没有 runUpdatedAt）
      listTask({ id: "t-done-old", updatedAt: "2026-08-21T00:00:00.000Z", aiRunStatus: "completed", productProjectKey: "ppk_same", result: runB }),
    ]);
    expect(projects).toHaveLength(1);
    // 规则：max(runUpdatedAt, updatedAt) 最大者为项目代表 → t-run-new 的 running 状态胜出
    expect(projects[0]!.task.id).toBe("t-run-new");
    expect(projects[0]!.group).toBe("researching");
  });

  it("规则反向：更新 run 已完成 + 更新 task → 代表为已完成，不因更晚的未运行记录改变", () => {
    const projects = buildLocalProductProjects([
      listTask({ id: "t-done-new", updatedAt: "2026-08-22T06:00:00.000Z", aiRunStatus: "completed", runUpdatedAt: "2026-08-22T05:00:00.000Z", productProjectKey: "ppk_same", result: listProjection({ productName: "同款", researchRecord: savedResearchRecord() }) }),
      listTask({ id: "t-quarter", updatedAt: "2026-08-21T00:00:00.000Z", aiRunStatus: "waiting", productProjectKey: "ppk_same", result: listProjection({ productName: "同款" }) }),
    ]);
    expect(projects[0]!.task.id).toBe("t-done-new");
    expect(projects[0]!.group).toBe("completed");
  });


  it("确定性排序 1：taskRecency 相同但 updatedAt 不同，反转输入顺序后代表仍选较新 updatedAt", () => {
    const make = (id: string, updatedAt: string) => listTask({
      id,
      updatedAt,
      aiRunStatus: "completed",
      runUpdatedAt: "2026-08-22T05:00:00.000Z", // 主导 recency，两者相同
      productProjectKey: "ppk_tie",
      result: listProjection({ productName: "平局商品", researchRecord: savedResearchRecord() }),
    });
    const older = make("t-older-updated", "2026-08-20T00:00:00.000Z");
    const newer = make("t-newer-updated", "2026-08-21T00:00:00.000Z");

    const forward = buildLocalProductProjects([older, newer]);
    const reversed = buildLocalProductProjects([newer, older]);

    for (const projects of [forward, reversed]) {
      expect(projects).toHaveLength(1);
      expect(projects[0]!.task.id).toBe("t-newer-updated");
    }
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it("确定性排序 2：taskRecency 与 updatedAt 都相同但 id 不同，反转输入后代表与分组顺序均按 id 字典序升序", () => {
    const make = (id: string) => listTask({
      id,
      updatedAt: "2026-08-21T00:00:00.000Z",
      aiRunStatus: "completed",
      runUpdatedAt: "2026-08-22T05:00:00.000Z",
      productProjectKey: "ppk_tie2",
      result: listProjection({ productName: "平局商品2", researchRecord: savedResearchRecord() }),
    });
    const zt = make("z-task");
    const at = make("a-task");

    const forward = buildLocalProductProjects([zt, at]);
    const reversed = buildLocalProductProjects([at, zt]);

    for (const projects of [forward, reversed]) {
      expect(projects).toHaveLength(1);
      expect(projects[0]!.task.id).toBe("a-task");
    }
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it("确定性排序 3：多项目分组内项目顺序与输入顺序无关（同排序规则，id 字典序兜底）", () => {
    const mk = (key: string, id: string, updatedAt: string) => listTask({
      id,
      updatedAt,
      productProjectKey: key,
      result: listProjection({ productName: key }),
    });
    // 三个项目：aa 最新、bb 次新、cc 最旧；输入故意乱序
    const tasks = [
      mk("ppk_cc", "t-cc", "2026-08-20T00:00:00.000Z"),
      mk("ppk_aa", "t-aa", "2026-08-22T00:00:00.000Z"),
      mk("ppk_bb", "t-bb", "2026-08-21T00:00:00.000Z"),
    ];
    const forward = buildLocalProductProjects(tasks);
    const reversed = buildLocalProductProjects([...tasks].reverse());
    expect(forward.map((p) => p.task.id)).toEqual(["t-aa", "t-bb", "t-cc"]);
    expect(reversed.map((p) => p.task.id)).toEqual(["t-aa", "t-bb", "t-cc"]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it("分页 fail-closed：首/中/末页失败都必须整体失败（不返回已收集部分）", async () => {
    const single = (id: string) => listTask({ id, updatedAt: "2026-08-22T00:00:00.000Z" });
    // 第一页失败
    await expect(collectPagedTasks<LocalTaskItem>(async () => null)).rejects.toThrow("product_research_tasks_unavailable");
    // 第二页失败（第一页成功后返回 null）
    await expect(collectPagedTasks<LocalTaskItem>(async (offset) => (
      offset === 0
        ? { items: [single("p0")], hasMore: true }
        : null
    ))).rejects.toThrow("product_research_tasks_unavailable");
    // 第三页失败（前两页成功后返回 null）
    await expect(collectPagedTasks<LocalTaskItem>(async (offset) => (
      offset < 100
        ? { items: [single("p" + offset)], hasMore: true }
        : null
    ))).rejects.toThrow("product_research_tasks_unavailable");
    // 非 2xx / ok=false / JSON 无效由 fetchPage 实现抛错（这里模拟 fetchPage 抛错）
    await expect(collectPagedTasks<LocalTaskItem>(async () => { throw new Error("http_500"); })).rejects.toThrow();
  });

  it("分页保护上限触发必须显式失败（不得静默截断）", async () => {
    const single = (id: string) => listTask({ id, updatedAt: "2026-08-22T00:00:00.000Z" });
    await expect(collectPagedTasks<LocalTaskItem>(async () => ({ items: [single("loop")], hasMore: true }))).rejects.toThrow("product_research_tasks_unavailable");
  });

  it("页面级：任何一页失败 → 工作台 unavailable（不显示残缺项目）", async () => {
    const single = (id: string) => listTask({ id, updatedAt: "2026-08-22T00:00:00.000Z" });
    // 第三页失败 → unavailable，而不是返回前两页部分数据
    const result = await loadWorkbenchTasks(async (offset) => (
      offset < 100
        ? { items: [single("p" + offset)], hasMore: true }
        : null
    ));
    expect(result).toEqual({ status: "unavailable" });

    // 三页全部成功 → ready 且只保留 workflow
    const ok = await loadWorkbenchTasks(async (offset) => ({
      items: offset < 100
        ? [single("w" + offset), { ...single("v" + offset), type: "viral" }]
        : [single("last")],
      hasMore: offset < 100,
    }));
    expect(ok.status).toBe("ready");
    if (ok.status === "ready") {
      expect(ok.tasks.length).toBeGreaterThan(0);
      expect(ok.tasks.every((task) => task.type === "workflow")).toBe(true);
    }
  });

  it("跨页完整读取：超过 50 条时同一商品跨页仍只形成一个项目，次数与三组数量正确", async () => {
    // 页面 1：50 条（其中商品 A 出现 2 次，商品 B 1 次，其余为 C…）；页面 2：50 条；页面 3：20 条（商品 B 再次出现）
    const makePage = (prefix: string, entries: Array<{ id: string; key: string }>) => entries.map(({ id, key }) => listTask({ id, updatedAt: "2026-08-22T00:00:00.000Z", productProjectKey: key, aiRunStatus: "not_started" }));
    const pe = (id: string, key: string) => ({ id, key });
    const page1: LocalTaskItem[] = makePage("p1", [
      pe("p1-a1", "ppk_A"), pe("p1-a2", "ppk_A"), pe("p1-b1", "ppk_B"),
      ...Array.from({ length: 47 }, (_, i) => pe(`p1-x${i}`, `ppk_X${i}`)),
    ]);
    const allItems: LocalTaskItem[] = [
      ...page1,
      ...makePage("p2", [...Array.from({ length: 50 }, (_, i) => pe(`p2-x${i}`, `ppk_X${i + 47}`))]),
      ...makePage("p3", [
        pe("p3-b2", "ppk_B"),
        ...Array.from({ length: 19 }, (_, i) => pe(`p3-x${i}`, `ppk_Z${i}`)),
      ]),
    ];
    let calls = 0;
    const collected = await collectPagedTasks<LocalTaskItem>(async (offset) => {
      calls += 1;
      const start = offset;
      const chunk = allItems.slice(start, start + 50);
      return { items: chunk, hasMore: start + 50 < allItems.length };
    });
    expect(calls).toBe(3);
    expect(collected).toHaveLength(allItems.length);

    const projects = buildLocalProductProjects(collected);
    const byKey = new Map(projects.map((project) => [project.key, project]));
    expect(projects.filter((project) => project.key === "ppk_A")[0]!.taskCount).toBe(2);
    expect(byKey.get("ppk_B")!.taskCount).toBe(2);
    // 去重后的项目数：A(1) + B(1) + 首次 47 个 + 后续 50 + 19 = 118 任务 → 项目数
    expect(projects).toHaveLength(1 + 1 + 47 + 50 + 19);
    // 三组使用新的服务端投影状态
    expect(byKey.get("ppk_A")!.group).toBe("needs_action");
  });

  it("服务端 data 域过滤：非 workflow 任务不进入三组", () => {
    const projects = buildLocalProductProjects([
      listTask({ id: "formal", updatedAt: "2026-08-22T01:00:00.000Z", type: "workflow", productProjectKey: "ppk_formal" }),
      listTask({ id: "viral", updatedAt: "2026-08-22T02:00:00.000Z", type: "viral", productProjectKey: "ppk_viral" }),
    ]);
    const visible = projects.filter((project) => project.task.type === "workflow");
    expect(visible).toHaveLength(1);
  });

  it("uses the first conclusion from the real safe list projection before oneLineSummary", () => {
    const result = listProjection({
      productName: "有结论商品",
      finalReport: { finalVerdict: "正式安全投影中的第一条研究结论" },
    }, "较低优先级的一句话摘要");
    const [project] = buildLocalProductProjects([
      listTask({
        id: "conclusion",
        updatedAt: "2026-08-22T00:00:00.000Z",
        oneLineSummary: "较低优先级的一句话摘要",
        result,
      }),
    ]);

    expect((result.legacyListSummary as any).presentation.researchConclusions[0]).toBe("正式安全投影中的第一条研究结论");
    expect(project.conclusion).toBe("正式安全投影中的第一条研究结论");
  });
});


describe("轮 7 首页研究入口路由", () => {
  it(">0 → startable；=0 → 发现商品；未知(null) → 不可用", () => {
    expect(resolveStartResearchHref(1).href).toBe("/opportunity-candidates?view=startable");
    expect(resolveStartResearchHref(101).href).toBe("/opportunity-candidates?view=startable");
    expect(resolveStartResearchHref(0)).toEqual({ href: "/opportunities", unavailable: false });
    expect(resolveStartResearchHref(null).unavailable).toBe(true);
    expect(resolveStartResearchHref(undefined).href).toBeNull();
  });
  it("converted 不计入可用（0 个可研究 → 发现商品）", () => {
    expect(resolveStartResearchHref(0).href).toBe("/opportunities");
  });
  it("首屏加载中：按钮不冒充跳转（显示确认中）", () => {
    const html = renderLocal(true);
    expect(html).toContain("正在确认可研究商品");
  });
});
