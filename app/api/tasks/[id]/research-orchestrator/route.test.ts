import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerOnly: vi.fn(),
  requireAuthenticated: vi.fn(),
  orchestrateResearchCollection: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireOwnerOnly: mocks.requireOwnerOnly,
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: (id: string) => id.startsWith("demo-"),
}));

vi.mock("@/lib/server/researchCollectionOrchestrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/researchCollectionOrchestrator")>();
  return {
    ...actual,
    orchestrateResearchCollection: mocks.orchestrateResearchCollection,
  };
});

import { GET, POST } from "./route";
import { ResearchOrchestratorError } from "@/lib/server/researchCollectionOrchestrator";

function createRequest(options: {
  method?: string;
  url?: string;
  body?: unknown;
}) {
  const method = options.method ?? "POST";
  const url = options.url ?? "http://localhost:3000/api/tasks/task-001/research-orchestrator";
  return {
    method,
    url,
    headers: new Headers({
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "content-type": "application/json",
    }),
    json: async () => options.body ?? {},
  } as never;
}

function createContext(id = "task-001") {
  return {
    params: Promise.resolve({ id }),
  };
}

describe("POST /api/tasks/[id]/research-orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireOwnerOnly.mockReturnValue({
      ok: true,
      context: { mode: "owner" },
    });

    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "demo-user-1" },
    });
  });

  describe("Authentication & Authorization", () => {
    it("未授权时返回拒绝响应（401 / 403）", async () => {
      mocks.requireOwnerOnly.mockReturnValue({
        ok: false,
        status: 403,
        code: "forbidden",
        message: "需要 Owner 权限。",
      });

      const req = createRequest({ body: { action: "inspect" } });
      const res = await POST(req, createContext("task-001"));
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("forbidden");
    });

    it("Sandbox 任务未认证或非 demo 模式时拦截", async () => {
      mocks.requireAuthenticated.mockReturnValue({
        ok: false,
        status: 401,
        code: "unauthorized",
        message: "未登录。",
      });

      const req = createRequest({ body: { action: "inspect" } });
      const res = await POST(req, createContext("demo-task-001"));
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("unauthorized");
    });
  });

  describe("Validation & Errors", () => {
    it("缺少或无效的 id 返回 400", async () => {
      const req = createRequest({ body: {} });
      const res = await POST(req, createContext(""));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("invalid_id");
    });

    it("传入非法的 action 返回 400 invalid_action", async () => {
      const req = createRequest({ body: { action: "invalid_action_xyz" } });
      const res = await POST(req, createContext("task-001"));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("invalid_action");
    });

    it("任务不存在时返回 404", async () => {
      mocks.orchestrateResearchCollection.mockRejectedValue(
        new ResearchOrchestratorError("not_found", 404, "任务不存在。"),
      );

      const req = createRequest({ body: { action: "inspect" } });
      const res = await POST(req, createContext("task-001"));
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("not_found");
    });
  });

  describe("Action Defaults & Execution", () => {
    it("请求体未提供 action 时缺省为 orchestrate", async () => {
      mocks.orchestrateResearchCollection.mockResolvedValue({
        taskId: "task-001",
        action: "orchestrate",
        overallStatus: "needs_user",
        sources: {
          amazon: { status: "needs_user" },
          keywordCompetitor: { status: "needs_user" },
          voc: { status: "needs_user" },
          sourcing1688: { status: "needs_user" },
        },
        updatedAt: new Date().toISOString(),
      });

      const req = createRequest({ body: {} });
      const res = await POST(req, createContext("task-001"));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(mocks.orchestrateResearchCollection).toHaveBeenCalledWith({
        context: { mode: "owner" },
        taskId: "task-001",
        action: "orchestrate",
      });
    });

    it("显式指定 action: inspect 正常透传", async () => {
      mocks.orchestrateResearchCollection.mockResolvedValue({
        taskId: "task-001",
        action: "inspect",
        overallStatus: "needs_user",
        sources: {
          amazon: { status: "needs_user" },
          keywordCompetitor: { status: "needs_user" },
          voc: { status: "needs_user" },
          sourcing1688: { status: "needs_user" },
        },
        updatedAt: new Date().toISOString(),
      });

      const req = createRequest({ body: { action: "inspect" } });
      const res = await POST(req, createContext("task-001"));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(mocks.orchestrateResearchCollection).toHaveBeenCalledWith({
        context: { mode: "owner" },
        taskId: "task-001",
        action: "inspect",
      });
    });
  });

  describe("Failure Isolation Contract", () => {
    it("Keyword+Competitor 失败绝不返回 500，返回 200 OK 且 sources.keywordCompetitor.status = failed", async () => {
      mocks.orchestrateResearchCollection.mockResolvedValue({
        taskId: "task-001",
        action: "orchestrate",
        overallStatus: "mixed",
        sources: {
          amazon: { status: "ready", hasEvidence: true },
          keywordCompetitor: {
            status: "failed",
            hasEvidence: false,
            error: {
              code: "seller_sprite_keyword_failed",
              message: "SellerSprite 关键词采集失败：未获得有效页面观察",
            },
          },
          voc: { status: "needs_user", hasEvidence: false },
          sourcing1688: { status: "needs_user", hasEvidence: false },
        },
        updatedAt: new Date().toISOString(),
      });

      const req = createRequest({ body: { action: "orchestrate" } });
      const res = await POST(req, createContext("task-001"));
      const json = await res.json();

      // 核心铁律验证：HTTP 状态码必须是 200，绝不能 throw 500
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.sources.keywordCompetitor.status).toBe("failed");
      expect(json.data.sources.keywordCompetitor.error.code).toBe("seller_sprite_keyword_failed");
      expect(json.data.sources.amazon.status).toBe("ready");
    });
  });
});

describe("GET /api/tasks/[id]/research-orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireOwnerOnly.mockReturnValue({
      ok: true,
      context: { mode: "owner" },
    });
  });

  it("GET 请求便捷执行 inspect 检查并返回 200", async () => {
    mocks.orchestrateResearchCollection.mockResolvedValue({
      taskId: "task-001",
      action: "inspect",
      overallStatus: "ready",
      sources: {
        amazon: { status: "ready" },
        keywordCompetitor: { status: "ready" },
        voc: { status: "ready" },
        sourcing1688: { status: "ready" },
      },
      updatedAt: new Date().toISOString(),
    });

    const req = createRequest({ method: "GET" });
    const res = await GET(req, createContext("task-001"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mocks.orchestrateResearchCollection).toHaveBeenCalledWith({
      context: { mode: "owner" },
      taskId: "task-001",
      action: "inspect",
    });
  });
});
