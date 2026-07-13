import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * /api/tasks/aggregate route 测试
 *
 * 测试 GET 的访问密码保护。
 */

const CORRECT_PASSWORD = "ci-test-password";

const mockPrisma = {
  viralAnalysisRecord: {
    findMany: vi.fn().mockResolvedValue([]),
  },
};

const accessMocks = vi.hoisted(() => ({
  checkAccessPassword: vi.fn(),
  getAccessContext: vi.fn(),
  listSandboxTasks: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/server/accessPassword", () => ({
  checkAccessPassword: accessMocks.checkAccessPassword,
  getAccessContext: accessMocks.getAccessContext,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  listSandboxTasks: accessMocks.listSandboxTasks,
}));

let GET: any;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
  vi.stubEnv("NODE_ENV", "test");
  vi.clearAllMocks();
  accessMocks.checkAccessPassword.mockImplementation((request: { headers: Headers }) => {
    const credential = request.headers.get("x-access-password");
    return credential === CORRECT_PASSWORD || credential === "visitor-a" || credential === "visitor-b"
      ? null
      : { status: 401, body: { error: "访问密码错误" } };
  });
  accessMocks.getAccessContext.mockImplementation((request: { headers: Headers }) => {
    const credential = request.headers.get("x-access-password");
    if (credential === CORRECT_PASSWORD) return { mode: "owner", token: "" };
    if (credential === "visitor-a") return { mode: "demo", token: credential, demoAccessId: "visitor-a" };
    if (credential === "visitor-b") return { mode: "demo", token: credential, demoAccessId: "visitor-b" };
    return null;
  });
  accessMocks.listSandboxTasks.mockImplementation((demoAccessId: string) => [
    {
      id: `sandbox-task-${demoAccessId}`,
      demoAccessId,
      type: "sourcing",
      title: "shared-product",
      platform: "demo",
      oneLineSummary: `${demoAccessId}-summary`,
      score: 70,
      level: "B",
      resultJson: JSON.stringify({ tenantMarker: demoAccessId }),
      createdAt: "2026-07-11T00:00:00.000Z",
    },
  ]);
  mockPrisma.viralAnalysisRecord.findMany.mockResolvedValue([]);
  const mod = await import("./route");
  GET = mod.GET;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function createRequest(params: {
  url?: string;
  headers?: Record<string, string>;
}) {
  const urlStr = params.url ?? "http://localhost:3000/api/tasks/aggregate?productName=test";
  const url = new URL(urlStr);
  const headers = new Headers(params.headers);

  return {
    method: "GET",
    url: urlStr,
    nextUrl: url,
    headers,
    json: async () => ({}),
  };
}

async function getJsonStatus(response: Response) {
  const cloned = response.clone();
  const body = await cloned.json();
  return { status: cloned.status, body };
}

describe("GET /api/tasks/aggregate", () => {
  it("无密码 → 返回 401", async () => {
    const request = createRequest({});
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("错误密码 → 返回 401", async () => {
    const request = createRequest({
      headers: { "x-access-password": "wrong-password" },
    });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
  });

  it("Owner → 返回 200 并查询正式任务", async () => {
    const request = createRequest({
      headers: { "x-access-password": CORRECT_PASSWORD },
    });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.viralAnalysisRecord.findMany).toHaveBeenCalled();
    expect(accessMocks.listSandboxTasks).not.toHaveBeenCalled();
  });

  it("Visitor → 不查询或返回 Owner 正式任务", async () => {
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([{
      id: "owner-task",
      type: "sourcing",
      title: "owner-only-product",
      platform: "owner",
      oneLineSummary: "owner-secret",
      score: 90,
      level: "A",
      resultJson: JSON.stringify({ tenantMarker: "owner" }),
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
    }]);
    accessMocks.listSandboxTasks.mockReturnValueOnce([]);

    const request = createRequest({
      url: "http://localhost:3000/api/tasks/aggregate?productName=owner-only-product",
      headers: { "x-access-password": "visitor-a" },
    });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);

    expect(status).toBe(200);
    expect(body.data.found).toBe(false);
    expect(JSON.stringify(body)).not.toContain("owner-secret");
    expect(mockPrisma.viralAnalysisRecord.findMany).not.toHaveBeenCalled();
  });

  it("Visitor A → 只能聚合 Visitor A 的隔离任务", async () => {
    const request = createRequest({
      url: "http://localhost:3000/api/tasks/aggregate?productName=shared-product",
      headers: { "x-access-password": "visitor-a" },
    });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);

    expect(status).toBe(200);
    expect(accessMocks.listSandboxTasks).toHaveBeenCalledWith("visitor-a");
    expect(body.data.sourcing.tenantMarker).toBe("visitor-a");
    expect(JSON.stringify(body)).not.toContain("visitor-b-summary");
    expect(mockPrisma.viralAnalysisRecord.findMany).not.toHaveBeenCalled();
  });
});
