import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * lib/server/accessPassword 服务端校验工具测试
 *
 * 测试 getAccessPassword() 和 checkAccessPassword() 在
 * 无密码、错误密码、正确密码三类情况下的行为。
 */

const MODULE_PATH = "@/lib/server/accessPassword";

// Mock NextRequest 对象（简化版，避免复杂类型注解）
function createMockRequest(headers?: Record<string, string>) {
  const headersMap = new Map(Object.entries(headers ?? {}));
  return {
    headers: {
      get: (name: string) => headersMap.get(name.toLowerCase()) ?? null,
    },
  };
}

describe("getAccessPassword", () => {
  let accessPassword: any;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    accessPassword = await import(MODULE_PATH);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("读取 ACCESS_PASSWORD 环境变量", () => {
    vi.stubEnv("ACCESS_PASSWORD", "test-secret-123");
    expect(accessPassword.getAccessPassword()).toBe("test-secret-123");
  });

  it("ACCESS_PASSWORD 优先于 APP_ACCESS_PASSWORD", () => {
    vi.stubEnv("ACCESS_PASSWORD", "primary");
    vi.stubEnv("APP_ACCESS_PASSWORD", "fallback");
    expect(accessPassword.getAccessPassword()).toBe("primary");
  });

  it("ACCESS_PASSWORD 为空时回退到 APP_ACCESS_PASSWORD", () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "fallback-secret");
    expect(accessPassword.getAccessPassword()).toBe("fallback-secret");
  });

  it("两个环境变量都未设置时返回空字符串", () => {
    expect(accessPassword.getAccessPassword()).toBe("");
  });
});

describe("checkAccessPassword", () => {
  let accessPassword: any;

  const CORRECT_PASSWORD = "correct-password-456";

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
    // 重新导入以读取新的环境变量
    accessPassword = await import(MODULE_PATH);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── 服务端未配置密码 ──

  it("环境变量未配置时返回 500", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    const fresh = await import(MODULE_PATH);
    const request = createMockRequest();
    const result = fresh.checkAccessPassword(request);
    expect(result).not.toBeNull();
    expect(result.status).toBe(500);
    expect(result.body.error).toContain("ACCESS_PASSWORD");
  });

  // ── 无密码（header 和 body 都没有） ──

  it("无 header 无 body → 返回 401", () => {
    const request = createMockRequest();
    const result = accessPassword.checkAccessPassword(request);
    expect(result).not.toBeNull();
    expect(result.status).toBe(401);
    expect(result.body.error).toContain("访问密码错误");
  });

  it("空 header → 返回 401", () => {
    const request = createMockRequest({ "x-access-password": "" });
    const result = accessPassword.checkAccessPassword(request);
    expect(result).not.toBeNull();
    expect(result.status).toBe(401);
  });

  // ── header 错误密码 ──

  it("header 错误密码 → 返回 401", () => {
    const request = createMockRequest({ "x-access-password": "wrong-password" });
    const result = accessPassword.checkAccessPassword(request);
    expect(result).not.toBeNull();
    expect(result.status).toBe(401);
  });

  // ── header 正确密码 ──

  it("header 正确密码 → 返回 null（通过）", () => {
    const request = createMockRequest({ "x-access-password": CORRECT_PASSWORD });
    const result = accessPassword.checkAccessPassword(request);
    expect(result).toBeNull();
  });

  // ── body.accessPassword 优先 ──

  it("body.accessPassword 正确 → 返回 null（通过）", () => {
    const request = createMockRequest();
    const result = accessPassword.checkAccessPassword(request, { accessPassword: CORRECT_PASSWORD });
    expect(result).toBeNull();
  });

  it("body.accessPassword 正确，即使 header 错误也通过", () => {
    const request = createMockRequest({ "x-access-password": "wrong" });
    const result = accessPassword.checkAccessPassword(request, { accessPassword: CORRECT_PASSWORD });
    expect(result).toBeNull();
  });

  it("body.accessPassword 错误，header 正确 → 也通过", () => {
    const request = createMockRequest({ "x-access-password": CORRECT_PASSWORD });
    const result = accessPassword.checkAccessPassword(request, { accessPassword: "wrong" });
    expect(result).toBeNull();
  });

  // ── body.accessPassword 错误，无 header → 返回 401 ──

  it("body.accessPassword 错误，无 header → 返回 401", () => {
    const request = createMockRequest();
    const result = accessPassword.checkAccessPassword(request, { accessPassword: "wrong" });
    expect(result).not.toBeNull();
    expect(result.status).toBe(401);
  });

  // ── body 有但 accessPassword 字段缺失 ──

  it("body 存在但无 accessPassword 字段，无 header → 返回 401", () => {
    const request = createMockRequest();
    const result = accessPassword.checkAccessPassword(request, { type: "viral" });
    expect(result).not.toBeNull();
    expect(result.status).toBe(401);
  });

  // ── body.accessPassword 非字符串 ──

  it("body.accessPassword 为数字时不崩溃并返回 401", () => {
    const request = createMockRequest();
    const result = accessPassword.checkAccessPassword(request, { accessPassword: 12345 });
    expect(result).not.toBeNull();
    expect(result.status).toBe(401);
  });

  // ── 前后空格 ──

  it("header 密码前后有空格会被 trim 后匹配", () => {
    const request = createMockRequest({ "x-access-password": "  " + CORRECT_PASSWORD + "  " });
    const result = accessPassword.checkAccessPassword(request);
    expect(result).toBeNull();
  });
});
