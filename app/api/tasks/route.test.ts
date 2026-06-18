import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * /api/tasks route 测试
 *
 * 测试 GET / POST 的访问密码保护。
 * Prisma 和数据库操作被 mock，只测试密码校验逻辑。
 */

const CORRECT_PASSWORD = "ci-test-password";

// Mock Prisma
const mockPrisma = {
  viralAnalysisRecord: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({
      id: "test-001",
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
      type: "viral",
      title: "测试商品",
      platform: "tiktok",
      productUrl: null,
      materialText: "测试素材",
      source: "ai",
      score: 80,
      level: "高潜力",
      oneLineSummary: "测试摘要",
      resultJson: '{"score":80,"level":"高潜力"}',
    }),
  },
};

vi.mock("@/lib/server/db", () => ({
  prisma: mockPrisma,
}));

// Mock normalizeTaskRecord to pass through
vi.mock("@/lib/tasks/normalizeTaskRecord", () => ({
  normalizeTaskRecord: vi.fn((record: Record<string, unknown>) => ({
    id: record.id ?? "test-001",
    createdAt: (record.createdAt instanceof Date ? record.createdAt.toISOString() : "2025-01-01T00:00:00.000Z"),
    updatedAt: (record.updatedAt instanceof Date ? record.updatedAt.toISOString() : "2025-01-01T00:00:00.000Z"),
    type: record.type ?? "viral",
    title: record.title ?? "测试",
    platform: record.platform ?? "manual",
    productUrl: record.productUrl ?? null,
    materialText: record.materialText ?? "",
    source: record.source ?? "ai",
    score: record.score ?? 0,
    level: record.level ?? "",
    oneLineSummary: record.oneLineSummary ?? "",
    result: typeof record.resultJson === "string" ? JSON.parse(record.resultJson) : {},
    agentType: record.type ?? "viral",
    status: "completed",
  })),
}));

let GET: any;
let POST: any;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
  vi.stubEnv("NODE_ENV", "test");
  // Clear mock call history
  vi.clearAllMocks();
  const mod = await import("./route");
  GET = mod.GET;
  POST = mod.POST;
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
  const urlStr = params.url ?? "http://localhost:3000/api/tasks";
  const url = new URL(urlStr);
  const headers = new Headers(params.headers);

  if (typeof params.body === "object" && params.body !== null) {
    headers.set("content-type", "application/json");
  }

  return {
    method: params.method ?? "GET",
    url: urlStr,
    nextUrl: url,
    headers,
    json: async () => params.body ?? {},
  };
}

async function getJsonStatus(response: Response) {
  const cloned = response.clone();
  const body = await cloned.json();
  return { status: cloned.status, body };
}

describe("GET /api/tasks", () => {
  it("无密码 → 返回 401", async () => {
    const request = createRequest({ url: "http://localhost:3000/api/tasks?type=viral" });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("错误密码 → 返回 401", async () => {
    const request = createRequest({
      url: "http://localhost:3000/api/tasks?type=viral",
      headers: { "x-access-password": "wrong-password" },
    });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("正确密码 → 返回 200 并正常查询", async () => {
    const request = createRequest({
      url: "http://localhost:3000/api/tasks?type=viral&limit=5",
      headers: { "x-access-password": CORRECT_PASSWORD },
    });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(mockPrisma.viralAnalysisRecord.findMany).toHaveBeenCalled();
  });

  it("服务端未配置密码 → 返回 500", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    const mod = await import("./route");
    const request = createRequest({ url: "http://localhost:3000/api/tasks" });
    const response = await mod.GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(500);
    expect(body.error).toContain("ACCESS_PASSWORD");
  });
});

describe("POST /api/tasks", () => {
  const validBody = {
    type: "viral",
    title: "测试",
    platform: "tiktok",
    source: "ai",
    materialText: "测试素材",
    result: { score: 80, level: "高潜力", oneLineSummary: "ok" },
  };

  it("无密码 → 返回 401", async () => {
    const request = createRequest({
      method: "POST",
      body: validBody,
    });
    const response = await POST(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("body 中错误密码 → 返回 401", async () => {
    const request = createRequest({
      method: "POST",
      body: { ...validBody, accessPassword: "wrong-password" },
    });
    const response = await POST(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("header 中正确密码 → 返回 200 并正常保存", async () => {
    const request = createRequest({
      method: "POST",
      headers: { "x-access-password": CORRECT_PASSWORD },
      body: validBody,
    });
    const response = await POST(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(mockPrisma.viralAnalysisRecord.create).toHaveBeenCalled();
  });

  it("body 中正确密码 → 返回 200 并正常保存", async () => {
    const request = createRequest({
      method: "POST",
      body: { ...validBody, accessPassword: CORRECT_PASSWORD },
    });
    const response = await POST(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(mockPrisma.viralAnalysisRecord.create).toHaveBeenCalled();
  });

  it("accessPassword 不会被写入数据库", async () => {
    const bodyWithPassword = { ...validBody, accessPassword: CORRECT_PASSWORD };
    const request = createRequest({
      method: "POST",
      body: bodyWithPassword,
    });
    await POST(request);

    // 获取 prisma create 被调用时传入的 data
    const createCall = mockPrisma.viralAnalysisRecord.create.mock.calls[0][0];
    const createData = createCall.data;

    // resultJson 是 JSON.stringify(body.result)，不应包含 accessPassword
    expect(createData.resultJson).not.toContain("accessPassword");
    expect(createData.resultJson).not.toContain(CORRECT_PASSWORD);

    // 任何字段都不应该包含密码
    const allValues = JSON.stringify(createData);
    expect(allValues).not.toContain(CORRECT_PASSWORD);

    // 返回的响应 data 也不应包含 accessPassword
    const response = await POST(request);
    // clone and read response body
    const { body: responseBody } = await (async () => {
      const cloned = response.clone();
      return { body: await cloned.json() };
    })();
    const responseStr = JSON.stringify(responseBody);
    expect(responseStr).not.toContain("accessPassword");
    expect(responseStr).not.toContain(CORRECT_PASSWORD);
  });

  it("服务端未配置密码 → 返回 500", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    const mod = await import("./route");
    const request = createRequest({
      method: "POST",
      body: validBody,
    });
    const response = await mod.POST(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(500);
    expect(body.error).toContain("ACCESS_PASSWORD");
  });
});
