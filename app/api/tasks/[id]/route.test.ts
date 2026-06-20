import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * /api/tasks/[id] route 测试
 *
 * 测试 GET / DELETE 的访问密码保护。
 * Prisma 被 mock，只测试密码校验逻辑。
 */

const CORRECT_PASSWORD = "ci-test-password";

// Build a mock record that matches toTaskItem expectations
const mockRecord = {
  id: "task-001",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  type: "viral",
  decisionStatus: "pending",
  title: "测试商品",
  platform: "tiktok",
  productUrl: null,
  materialText: "测试素材",
  source: "ai",
  score: 80,
  level: "高潜力",
  oneLineSummary: "测试摘要",
  resultJson: '{"score":80,"level":"高潜力"}',
};

const mockPrisma = {
  viralAnalysisRecord: {
    findFirst: vi.fn().mockResolvedValue(mockRecord),
    update: vi.fn().mockResolvedValue({ id: "task-001", decisionStatus: "continue" }),
    delete: vi.fn().mockResolvedValue(mockRecord),
  },
};

// Mock @prisma/client for Prisma.PrismaClientKnownRequestError
vi.mock("@prisma/client", () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, { code }: { code: string }) {
      super(message);
      this.code = code;
    }
  }
  return { Prisma: { PrismaClientKnownRequestError } };
});

vi.mock("@/lib/server/db", () => ({
  prisma: mockPrisma,
}));

let GET: any;
let PATCH: any;
let DELETE: any;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
  vi.stubEnv("NODE_ENV", "test");
  vi.clearAllMocks();
  mockPrisma.viralAnalysisRecord.findFirst.mockResolvedValue(mockRecord);
  mockPrisma.viralAnalysisRecord.update.mockResolvedValue({ id: "task-001", decisionStatus: "continue" });
  mockPrisma.viralAnalysisRecord.delete.mockResolvedValue(mockRecord);
  const mod = await import("./route");
  GET = mod.GET;
  PATCH = mod.PATCH;
  DELETE = mod.DELETE;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function createRequest(params: {
  url?: string;
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
}) {
  const urlStr = params.url ?? "http://localhost:3000/api/tasks/task-001";
  const url = new URL(urlStr);
  const headers = new Headers(params.headers);

  return {
    method: params.method ?? "GET",
    url: urlStr,
    nextUrl: url,
    headers,
    json: async () => params.body ?? {},
  };
}

function createContext(id: string) {
  return {
    params: Promise.resolve({ id }),
  };
}

async function getJsonStatus(response: Response) {
  const cloned = response.clone();
  const body = await cloned.json();
  return { status: cloned.status, body };
}

describe("GET /api/tasks/[id]", () => {
  it("无密码 → 返回 401", async () => {
    const request = createRequest({});
    const response = await GET(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("错误密码 → 返回 401", async () => {
    const request = createRequest({
      headers: { "x-access-password": "wrong-password" },
    });
    const response = await GET(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("正确密码 → 返回 200 并正常查询详情", async () => {
    const request = createRequest({
      headers: { "x-access-password": CORRECT_PASSWORD },
    });
    const response = await GET(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.id).toBe("task-001");
    expect(mockPrisma.viralAnalysisRecord.findFirst).toHaveBeenCalled();
  });

  it("详情响应不包含 accessPassword", async () => {
    const request = createRequest({
      headers: { "x-access-password": CORRECT_PASSWORD },
    });
    const response = await GET(request, createContext("task-001"));
    const { body } = await getJsonStatus(response);
    const responseStr = JSON.stringify(body);
    expect(responseStr).not.toContain("accessPassword");
    expect(responseStr).not.toContain(CORRECT_PASSWORD);
  });

  it("缺少 id → 密码也需校验（安全优先）", async () => {
    const request = createRequest({});
    const response = await GET(request, createContext(""));
    const { status } = await getJsonStatus(response);
    // 应该返回 401（密码校验在前），而不是 400
    expect(status).toBe(401);
  });

  it("服务端未配置密码 → 返回 500", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    const mod = await import("./route");
    const request = createRequest({});
    const response = await mod.GET(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(500);
    expect(body.error).toContain("ACCESS_PASSWORD");
  });
});

describe("DELETE /api/tasks/[id]", () => {
  it("无密码 → 返回 401", async () => {
    const request = createRequest({ method: "DELETE" });
    const response = await DELETE(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("错误密码 → 返回 401", async () => {
    const request = createRequest({
      method: "DELETE",
      headers: { "x-access-password": "wrong-password" },
    });
    const response = await DELETE(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("正确密码 → 返回 200 并正常删除", async () => {
    const request = createRequest({
      method: "DELETE",
      headers: { "x-access-password": CORRECT_PASSWORD },
    });
    const response = await DELETE(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("task-001");
    expect(mockPrisma.viralAnalysisRecord.delete).toHaveBeenCalled();
  });

  it("服务端未配置密码 → 返回 500", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    const mod = await import("./route");
    const request = createRequest({ method: "DELETE" });
    const response = await mod.DELETE(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(500);
    expect(body.error).toContain("ACCESS_PASSWORD");
  });
});

describe("PATCH /api/tasks/[id]", () => {
  it("无密码 → 返回 401", async () => {
    const request = createRequest({
      method: "PATCH",
      body: { decisionStatus: "continue" },
    });
    const response = await PATCH(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("正确密码 → 更新人工状态", async () => {
    const request = createRequest({
      method: "PATCH",
      headers: { "x-access-password": CORRECT_PASSWORD },
      body: { decisionStatus: "continue" },
    });
    const response = await PATCH(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.decisionStatus).toBe("continue");
    expect(mockPrisma.viralAnalysisRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-001" },
      data: { decisionStatus: "continue" },
    }));
  });

  it("非法人工状态 → 返回 400", async () => {
    const request = createRequest({
      method: "PATCH",
      headers: { "x-access-password": CORRECT_PASSWORD },
      body: { decisionStatus: "done" },
    });
    const response = await PATCH(request, createContext("task-001"));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_decision_status");
  });
});
