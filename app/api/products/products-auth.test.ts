import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * /api/products/* 服务端鉴权测试
 *
 * 验证所有 products API 在无密码、错误密码、正确密码情况下的行为。
 * AI 调用和数据库操作均被 mock，确保测试不消耗 token、不写库。
 */

const CORRECT_PASSWORD = "ci-test-password";

// ── Shared mocks ──

const mockCallAiJson = vi.fn().mockResolvedValue({
  ok: true,
  data: { recommendation: "caution", score: 60 },
});

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: mockCallAiJson,
  getSafeAiClientErrorMessage: vi.fn((code: string) => `safe:${code}`),
}));

const mockPrisma = {
  listingCopyHistory: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: "hist-001",
      productId: null,
      productName: "test",
      title: "test title",
      data: { title: "test" },
      sourceInput: null,
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
};

// listingCopyHistoryStore reads DATABASE_URL
vi.stubEnv("DATABASE_URL", "file:./test.db");

vi.mock("@/lib/server/listingCopyHistoryStore", () => ({
  listListingCopyHistories: vi.fn().mockResolvedValue([]),
  createListingCopyHistory: vi.fn().mockResolvedValue({
    id: "hist-001",
    productId: null,
    productName: "test",
    title: "test title",
    data: { title: "test" },
    sourceInput: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  }),
  deleteListingCopyHistory: vi.fn().mockResolvedValue(true),
}));

// ── Test helpers ──

function createRequest(opts: {
  url?: string;
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
} = {}) {
  const urlStr = opts.url ?? "http://localhost:3000/api/products/ai-analysis";
  const url = new URL(urlStr);
  const headers = new Headers(opts.headers);

  if (typeof opts.body === "object" && opts.body !== null) {
    headers.set("content-type", "application/json");
  }

  return {
    method: opts.method ?? "POST",
    url: urlStr,
    nextUrl: url,
    headers,
    text: opts.body ? async () => JSON.stringify(opts.body) : async () => "{}",
    json: async () => opts.body ?? {},
  };
}

async function getJsonStatus(response: Response) {
  const cloned = response.clone();
  const body = await cloned.json();
  return { status: cloned.status, body };
}

// ── Reusable auth describe blocks ──

function describePostAuth(
  routePath: string,
  importPost: () => Promise<any>,
  validBody: Record<string, unknown>,
  opts?: { expectContainsOnSuccess?: string; legacyAuth500?: boolean },
) {
  describe(`POST ${routePath}`, () => {
    let POST: any;

    beforeEach(async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
      vi.stubEnv("DATABASE_URL", "file:./test.db");
      vi.clearAllMocks();
      const mod = await importPost();
      POST = mod.POST;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("无密码 → 返回 401", async () => {
      const request = createRequest({ method: "POST", body: validBody });
      const response = await POST(request);
      const { status, body } = await getJsonStatus(response);
      expect(status).toBe(401);
      expect(body.error?.code || body.error).toBeTruthy();
      expect(mockCallAiJson).not.toHaveBeenCalled();
    });

    it("body 中错误密码 → 返回 401", async () => {
      const request = createRequest({
        method: "POST",
        body: { ...validBody, accessPassword: "wrong-password" },
      });
      const response = await POST(request);
      const { status, body } = await getJsonStatus(response);
      expect(status).toBe(401);
      expect(body.error?.code || body.error).toBeTruthy();
      expect(mockCallAiJson).not.toHaveBeenCalled();
    });

    it("body 中正确密码 → 通过鉴权（不返回 401）", async () => {
      const request = createRequest({
        method: "POST",
        body: { ...validBody, accessPassword: CORRECT_PASSWORD },
      });
      const response = await POST(request);
      const { status } = await getJsonStatus(response);
      expect(status).not.toBe(401);
    });

    it("header 中正确密码 → 通过鉴权（不返回 401）", async () => {
      const request = createRequest({
        method: "POST",
        headers: { "x-access-password": CORRECT_PASSWORD },
        body: validBody,
      });
      const response = await POST(request);
      const { status } = await getJsonStatus(response);
      expect(status).not.toBe(401);
    });

    it("服务端未配置密码 → 返回 500", async () => {
      vi.stubEnv("ACCESS_PASSWORD", "");
      vi.stubEnv("APP_ACCESS_PASSWORD", "");
      const mod = await importPost();
      const request = createRequest({ method: "POST", body: validBody });
      const response = await mod.POST(request);
      const { status, body } = await getJsonStatus(response);
      if (opts?.legacyAuth500) {
        expect(status).toBe(500);
        expect(body.error).toContain("ACCESS_PASSWORD");
      } else {
        expect(status).toBe(401);
        expect(body.error?.code || body.error).toBeTruthy();
      }
    });
  });
}

function describeGetAuth(
  routePath: string,
  importGet: () => Promise<any>,
  url: string,
) {
  describe(`GET ${routePath}`, () => {
    let GET: any;

    beforeEach(async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
      vi.stubEnv("DATABASE_URL", "file:./test.db");
      vi.clearAllMocks();
      const mod = await importGet();
      GET = mod.GET;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("无密码 → 返回 401", async () => {
      const request = createRequest({ method: "GET", url });
      const response = await GET(request);
      const { status, body } = await getJsonStatus(response);
      expect(status).toBe(401);
      expect(body.error?.code || body.error).toBeTruthy();
    });

    it("错误密码 → 返回 401", async () => {
      const request = createRequest({
        method: "GET",
        url,
        headers: { "x-access-password": "wrong-password" },
      });
      const response = await GET(request);
      const { status, body } = await getJsonStatus(response);
      expect(status).toBe(401);
      expect(body.error?.code || body.error).toBeTruthy();
    });

    it("正确密码 → 通过鉴权（不返回 401）", async () => {
      const request = createRequest({
        method: "GET",
        url,
        headers: { "x-access-password": CORRECT_PASSWORD },
      });
      const response = await GET(request);
      const { status } = await getJsonStatus(response);
      expect(status).not.toBe(401);
    });

    it("服务端未配置密码 → 返回 500", async () => {
      vi.stubEnv("ACCESS_PASSWORD", "");
      vi.stubEnv("APP_ACCESS_PASSWORD", "");
      const mod = await importGet();
      const request = createRequest({ method: "GET", url });
      const response = await mod.GET(request);
      const { status, body } = await getJsonStatus(response);
      expect(status).toBe(500);
      expect(body.error).toContain("ACCESS_PASSWORD");
    });
  });
}

function describeDeleteAuth(
  routePath: string,
  importDelete: () => Promise<any>,
  url: string,
) {
  describe(`DELETE ${routePath}`, () => {
    let DELETE: any;

    beforeEach(async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
      vi.stubEnv("DATABASE_URL", "file:./test.db");
      vi.clearAllMocks();
      const mod = await importDelete();
      DELETE = mod.DELETE;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("无密码 → 返回 401", async () => {
      const request = createRequest({ method: "DELETE", url });
      const response = await DELETE(request, { params: Promise.resolve({ id: "hist-001" }) });
      const { status, body } = await getJsonStatus(response);
      expect(status).toBe(401);
      expect(body.error?.code || body.error).toBeTruthy();
    });

    it("错误密码 → 返回 401", async () => {
      const request = createRequest({
        method: "DELETE",
        url,
        headers: { "x-access-password": "wrong-password" },
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: "hist-001" }) });
      const { status, body } = await getJsonStatus(response);
      expect(status).toBe(401);
      expect(body.error?.code || body.error).toBeTruthy();
    });

    it("正确密码 → 通过鉴权（不返回 401）", async () => {
      const request = createRequest({
        method: "DELETE",
        url,
        headers: { "x-access-password": CORRECT_PASSWORD },
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: "hist-001" }) });
      const { status } = await getJsonStatus(response);
      expect(status).not.toBe(401);
    });

    it("服务端未配置密码 → 返回 500", async () => {
      vi.stubEnv("ACCESS_PASSWORD", "");
      vi.stubEnv("APP_ACCESS_PASSWORD", "");
      const mod = await importDelete();
      const request = createRequest({ method: "DELETE", url });
      const response = await mod.DELETE(request, { params: Promise.resolve({ id: "hist-001" }) });
      const { status, body } = await getJsonStatus(response);
      expect(status).toBe(500);
      expect(body.error).toContain("ACCESS_PASSWORD");
    });
  });
}

// ── Tests ──

describe("/api/products/ai-analysis auth", () => {
  describePostAuth(
    "/api/products/ai-analysis",
    () => import("./ai-analysis/route"),
    { product: { name: "测试商品", targetPlatform: "amazon" } },
  );
});

describe("/api/products/listing-copy auth", () => {
  describePostAuth(
    "/api/products/listing-copy",
    () => import("./listing-copy/route"),
    { product: { name: "测试商品", targetPlatform: "amazon" } },
  );
});

describe("/api/products/keywords auth", () => {
  describePostAuth(
    "/api/products/keywords",
    () => import("./keywords/route"),
    { product: { name: "测试商品", targetPlatform: "amazon" } },
  );
});

describe("/api/products/listing-copy-history auth", () => {
  describeGetAuth(
    "/api/products/listing-copy-history",
    () => import("./listing-copy-history/route"),
    "http://localhost:3000/api/products/listing-copy-history?limit=5",
  );

  describePostAuth(
    "/api/products/listing-copy-history (POST)",
    () => import("./listing-copy-history/route"),
    { productId: null, productName: "test", data: { title: "test" } },
    { legacyAuth500: true },
  );

  describe("/api/products/listing-copy-history DELETE (stub)", () => {
    let DELETE: any;

    beforeEach(async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
      vi.stubEnv("DATABASE_URL", "file:./test.db");
      vi.clearAllMocks();
      const mod = await import("./listing-copy-history/route");
      DELETE = mod.DELETE;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("无密码 → 返回 401", async () => {
      const request = createRequest({ method: "DELETE", url: "http://localhost:3000/api/products/listing-copy-history" });
      const response = await DELETE(request);
      const { status, body } = await getJsonStatus(response);
      expect(status).toBe(401);
      expect(body.error?.code || body.error).toBeTruthy();
    });

    it("正确密码 → 返回 400（stub 缺 ID 提示）", async () => {
      const request = createRequest({
        method: "DELETE",
        url: "http://localhost:3000/api/products/listing-copy-history",
        headers: { "x-access-password": CORRECT_PASSWORD },
      });
      const response = await DELETE(request);
      const { status, body } = await getJsonStatus(response);
      expect(status).toBe(400);
      expect(body.error.code).toBe("invalid_id");
    });
  });
});

describe("/api/products/listing-copy-history/[id] auth", () => {
  describeDeleteAuth(
    "/api/products/listing-copy-history/[id]",
    () => import("./listing-copy-history/[id]/route"),
    "http://localhost:3000/api/products/listing-copy-history/hist-001",
  );
});
