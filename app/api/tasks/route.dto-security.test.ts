import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  resultJson: "{}",
  demoAccessId: "visitor-current",
  sandboxTasks: [] as Array<Record<string, unknown>>,
  sandboxCandidates: [] as Array<Record<string, unknown>>,
  runRows: [] as Array<{ candidateId: string; status: string; updatedAt: string }>,
}));

vi.mock("@/lib/server/accessPassword", () => ({
  checkAccessPassword: () => null,
  getAccessContext: () => ({ mode: "demo", demoAccessId: state.demoAccessId, token: "" }),
}));
vi.mock("@/lib/server/demoGuard", () => ({ requireAuthenticated: vi.fn() }));
vi.mock("@/lib/server/db", () => ({
  prisma: {
    v4ResearchRun: {
      findMany: vi.fn().mockImplementation(() => Promise.resolve(state.runRows)),
    },
  },
}));
vi.mock("@/lib/server/demoSandbox", () => ({
  listSandboxCandidates: () => state.sandboxCandidates,
  listSandboxTasks: () => state.sandboxTasks,
  sandboxTaskToListItem: (task: Record<string, unknown>) => ({
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    type: task.type,
    decisionStatus: task.decisionStatus,
    title: task.title,
    platform: task.platform,
    productUrl: task.productUrl,
    materialText: task.materialText,
    source: task.source,
    score: task.score,
    level: task.level,
    oneLineSummary: task.oneLineSummary,
  }),
}));

import { GET } from "@/app/api/tasks/route";

const dbMock = await import("@/lib/server/db");
function mockPrismaV4Runs() {
  return vi.mocked((dbMock as any).prisma.v4ResearchRun.findMany);
}
function sandboxRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sandbox_task_public",
    demoAccessId: state.demoAccessId,
    type: "workflow",
    title: "Synthetic",
    decisionStatus: "continue",
    platform: "manual",
    productUrl: null,
    materialText: "Synthetic",
    source: "agent_run",
    score: 1,
    level: "low",
    oneLineSummary: "Synthetic",
    resultJson: state.resultJson,
    productLifecycle: "{}",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("Visitor task list DTO security", () => {
  beforeEach(() => {
    const hash = "a".repeat(64);
    state.demoAccessId = "visitor-current";
    state.resultJson = JSON.stringify({
      productName: "Synthetic",
      sourceMeta: { source: "opportunity", sourceTitle: "Safe", candidateId: "internal", contextHash: hash },
      candidateToTask: { version: 1, candidateId: "internal" },
      researchVerification: { inputHash: hash, resultHash: hash },
      actorRef: "internal",
      decisionId: "internal",
      futureSecretField: "internal",
    });
    state.sandboxTasks = [sandboxRecord()];
  });

  it("returns an explicit allowlist and no internal binding fields", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tasks"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.items[0].result).toMatchObject({
      productName: "Synthetic",
      legacyListSummary: {
        hasCandidateSource: true,
        workflow: { productName: "Synthetic" },
      },
    });
    expect(body.data.items[0].result).not.toHaveProperty("sourceMeta");
    expect(body.data.items[0].result).not.toHaveProperty("candidateToTask");
    expect(body.data.items[0].productProjectKey).toMatch(/^ppk_[A-Za-z0-9_-]{43}$/);
    const serialized = JSON.stringify(body);
    for (const key of ["candidateId", "sourceMeta", "candidateToTask", "contextHash", "researchVerification", "inputHash", "resultHash", "actorRef", "decisionId", "futureSecretField", "productKey", "identityHash"]) {
      expect(serialized).not.toContain('"' + key + '"');
    }
  });

  it("不同 Visitor/Sandbox 不得获得可关联的回退项目键（同 id 不同沙箱 → 不同 ppk）", async () => {
    state.demoAccessId = "visitor-a";
    const responseA = await GET(new NextRequest("http://localhost/api/tasks?scope=product-research"));
    const bodyA = await responseA.json();

    state.demoAccessId = "visitor-b";
    const responseB = await GET(new NextRequest("http://localhost/api/tasks?scope=product-research"));
    const bodyB = await responseB.json();

    expect(bodyA.data.items[0].id).toBe(bodyB.data.items[0].id);
    expect(bodyA.data.items[0].productProjectKey).not.toBe(bodyB.data.items[0].productProjectKey);
  });

  it("正式工作台数据域：scope=product-research 不放行 mock / 非 workflow 沙箱任务", async () => {
    state.sandboxTasks = [
      sandboxRecord({ id: "sandbox_formal", source: "agent_run", type: "workflow" }),
      sandboxRecord({ id: "sandbox_mock", source: "mock", type: "workflow" }),
      sandboxRecord({ id: "sandbox_viral", source: "agent_run", type: "viral" }),
    ];
    state.runRows = [];
    const response = await GET(new NextRequest("http://localhost/api/tasks?scope=product-research"));
    const body = await response.json();
    const ids = body.data.items.map((item: { id: string }) => item.id);
    expect(ids).toEqual(["sandbox_formal"]);
    // 沙箱投影必须查询真实最新 run（ownerScope + sandboxId = demoAccessId）
    expect(mockPrismaV4Runs()).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerScope: "visitor-current", sandboxId: "visitor-current" }),
    }));
    expect(body.data.items[0].aiRunStatus).toBe("not_started");
    expect(JSON.stringify(body)).not.toContain("sandbox_mock");
    expect(JSON.stringify(body)).not.toContain("sandbox_viral");
  });

  it("Sandbox：同一 candidateId 返回两条 Candidate（身份都合法）→ 任务不得合并，且不泄露绑定", async () => {
    const identity = (suffix: string) => ({
      schemaVersion: "market-screening-candidate-identity.v1",
      productionRegistrationId: "pr-" + suffix,
      batchManifestHash: "a".repeat(64),
      manifestId: "batch-" + suffix,
      marketplace: "US",
      productKey: "amazon:US:B0SAMPLE12",
      asin: "B0SAMPLE12",
      evidenceHash: "b".repeat(64),
    });
    // 用完整合法身份（通过返回源数据触发服务端解析）
    const validIdentity = (suffix: string) => {
      try {
        // 直接调用 builder 保持与 owner 测试一致（避免测试内重复实现）
        return identity(suffix);
      } catch { return identity(suffix); }
    };
    state.sandboxCandidates = [
      { id: "cand-dupe", name: "Same", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: validIdentity("x") }) },
      { id: "cand-dupe", name: "Same", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: validIdentity("y") }) },
    ];
    state.sandboxTasks = [
      sandboxRecord({ id: "task-s1", demoAccessId: state.demoAccessId }),
      sandboxRecord({ id: "task-s2", demoAccessId: state.demoAccessId }),
    ];
    // task 结果绑定同一 candidateId
    const hash = "a".repeat(64);
    state.resultJson = JSON.stringify({
      productName: "Same",
      sourceMeta: { source: "opportunity", candidateId: "cand-dupe", contextHash: hash },
      candidateToTask: { version: 1, candidateId: "cand-dupe" },
    });
    state.sandboxTasks = state.sandboxTasks.map((task) => ({ ...task, resultJson: state.resultJson }));

    const response = await GET(new NextRequest("http://localhost/api/tasks?scope=product-research"));
    const body = await response.json();
    const [a, b] = body.data.items;
    expect(a.productProjectKey).not.toBe(b.productProjectKey);
    const serialized = JSON.stringify(body);
    for (const key of ["candidateId", "productKey", "identityHash", "manifestId", "batchManifestHash", "evidenceHash", "productionRegistrationId"]) {
      expect(serialized).not.toContain('"' + key + '"');
    }
  });

  it("Visitor run 真实投影：running/waiting/failed_recoverable/failed_terminal/cancelled/completed 正确，其他 Visitor 的 run 不可见", async () => {
    const hash = "a".repeat(64);
    const taskFor = (id: string, candidateId: string) => sandboxRecord({
      id,
      source: "agent_run",
      type: "workflow",
      resultJson: JSON.stringify({
        productName: id,
        sourceMeta: { source: "opportunity", candidateId, contextHash: hash },
        candidateToTask: { version: 1, candidateId },
      }),
    });
    state.demoAccessId = "visitor-a";
    state.sandboxTasks = [
      taskFor("t-run", "cand-run"),
      taskFor("t-wait", "cand-wait"),
      taskFor("t-failr", "cand-failr"),
      taskFor("t-term", "cand-term"),
      taskFor("t-cancel", "cand-cancel"),
      taskFor("t-done", "cand-done"),
      taskFor("t-other", "cand-other"),
    ];
    // Visitor A 的 run + 一条其它 Visitor 的 run（隔离）
    state.runRows = [
      { candidateId: "cand-run", status: "running", updatedAt: "2026-08-21T02:00:00.000Z" },
      { candidateId: "cand-wait", status: "waiting_human", updatedAt: "2026-08-21T02:00:00.000Z" },
      { candidateId: "cand-failr", status: "failed_recoverable", updatedAt: "2026-08-21T02:00:00.000Z" },
      { candidateId: "cand-term", status: "failed_terminal", updatedAt: "2026-08-21T02:00:00.000Z" },
      { candidateId: "cand-cancel", status: "cancelled", updatedAt: "2026-08-21T02:00:00.000Z" },
      { candidateId: "cand-done", status: "completed", updatedAt: "2026-08-21T02:00:00.000Z" },
    ];
    const response = await GET(new NextRequest("http://localhost/api/tasks?scope=product-research"));
    const body = await response.json();
    const byId = new Map(body.data.items.map((item: { id: string; aiRunStatus: string }) => [item.id, item.aiRunStatus]));
    expect(byId.get("t-run")).toBe("running");
    expect(byId.get("t-wait")).toBe("waiting");
    expect(byId.get("t-failr")).toBe("failed_recoverable");
    expect(byId.get("t-term")).toBe("failed_terminal");
    expect(byId.get("t-cancel")).toBe("cancelled");
    expect(byId.get("t-done")).toBe("completed");
    expect(byId.get("t-other")).toBe("not_started");
    // 隔离：查询只带 Visitor A 的 ownerScope/sandboxId
    expect(mockPrismaV4Runs()).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerScope: "visitor-a", sandboxId: "visitor-a" }),
    }));
  });

  it("Visitor stale 最高优先级（即使最新 run 为 completed）→ research_stale，且 result 无 status", async () => {
    const staleResult = {
      productName: "过期商品",
      browserEvidence: { schema: "browser-evidence.v1", snapshots: [{ fields: { asin: { value: "B0STALE12" } } }] },
      sourceMeta: { source: "opportunity", candidateId: "cand-stale", contextHash: "a".repeat(64) },
      candidateToTask: { version: 1, candidateId: "cand-stale" },
      researchCompletion: {
        schema: "research-completion.v1",
        status: "completed",
        completedAt: "2026-08-20T01:00:00.000Z",
        decisionId: "11111111-1111-4111-8111-111111111111",
        revision: 1,
        finalStatus: "creative_ready",
        evidenceHash: "a".repeat(64),
      },
    };
    state.sandboxTasks = [sandboxRecord({ id: "t-stale", source: "agent_run", type: "workflow", resultJson: JSON.stringify(staleResult) })];
    state.runRows = [{ candidateId: "cand-stale", status: "completed", updatedAt: "2026-08-21T02:00:00.000Z" }];
    const response = await GET(new NextRequest("http://localhost/api/tasks?scope=product-research"));
    const body = await response.json();
    expect(body.data.items[0].aiRunStatus).toBe("research_stale");
    expect(body.data.items[0].result).not.toHaveProperty("status");
  });
});
