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

vi.mock("@/lib/server/db", () => ({
  prisma: mockPrisma,
}));

let GET: any;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
  vi.stubEnv("NODE_ENV", "test");
  vi.clearAllMocks();
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

  it("正确密码 → 返回 200 并正常查询", async () => {
    const request = createRequest({
      headers: { "x-access-password": CORRECT_PASSWORD },
    });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.viralAnalysisRecord.findMany).toHaveBeenCalled();
  });
});
