/**
 * V3.1 Phase 1 — Guest Start 端点测试（契约 02/03/09 / §11 / §31 / §32 / §40）
 * 覆盖：铸造 / 复用 / 顺序幂等 / Cookie 属性 / TTL 12h / 不返回 token /
 * 匿名遗留登录 DENIED / 沙箱复用 / 隔离 / 零 Provider 调用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import { POST } from "@/app/api/auth/guest/route";
import { POST as LOGIN_POST } from "@/app/api/auth/login/route";
import { verifySignedToken } from "@/lib/server/signedToken";
import { loadDemoAccessStore, createDemoAccess } from "@/lib/server/demoAccess";
import { ensureVisitorDemoCopy } from "@/lib/server/goldenDemoTemplate";
import { listSandboxTasks, getSandboxTask } from "@/lib/server/demoSandbox";
import { GUEST_COOKIE_NAME, GUEST_COOKIE_MAX_AGE_SECONDS } from "@/lib/server/guestCookie";

const { mockCallAiJson } = vi.hoisted(() => ({ mockCallAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: mockCallAiJson,
  getSafeAiClientErrorMessage: vi.fn((code: string) => "safe:" + code),
}));

const RUN = randomBytes(4).toString("hex");
const STORE = join(tmpdir(), "guest-route-" + RUN + ".json");
const SANDBOX = join(tmpdir(), "guest-sandbox-" + RUN + ".json");

function guestRequest(cookieValue?: string, origin?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookieValue) headers.cookie = GUEST_COOKIE_NAME + "=" + cookieValue;
  if (origin) headers.origin = origin;
  return new NextRequest("http://127.0.0.1:3010/api/auth/guest", { method: "POST", headers });
}

function extractSetCookie(response: Response): string {
  return response.headers.get("set-cookie") || "";
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.QX_RUNTIME_MODE = "public_showcase";
  process.env.ACCESS_PASSWORD = "guest-test-signing-secret";
  process.env.DEMO_ACCESS_STORE_PATH = STORE;
  process.env.DEMO_SANDBOX_STORE_PATH = SANDBOX;
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.QX_RUNTIME_MODE;
  delete process.env.ACCESS_PASSWORD;
  delete process.env.DEMO_ACCESS_STORE_PATH;
  delete process.env.DEMO_SANDBOX_STORE_PATH;
  try { if (existsSync(STORE)) unlinkSync(STORE); } catch { /* ok */ }
  try { if (existsSync(STORE + ".lock")) unlinkSync(STORE + ".lock"); } catch { /* ok */ }
  try { if (existsSync(SANDBOX)) unlinkSync(SANDBOX); } catch { /* ok */ }
  try { if (existsSync(SANDBOX + ".backup")) unlinkSync(SANDBOX + ".backup"); } catch { /* ok */ }
});

describe("POST /api/auth/guest — 铸造（PUBLIC_SHOWCASE）", () => {
  it("PUBLIC_ONE_CLICK_GUEST_START：无 cookie → 创建 anonymous demo-access + Set-Cookie，且响应体不含 token", async () => {
    const response = await POST(guestRequest());
    expect(response.status).toBe(200);
    const json = await response.clone().json();
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("demo");
    expect(json.reused).toBe(false);
    expect(json.ttlHours).toBe(12);
    expect(json.accessToken).toBeUndefined();
    expect(json.token).toBeUndefined();
    const setCookie = extractSetCookie(response);
    expect(setCookie).toContain(GUEST_COOKIE_NAME + "=");
    const store = loadDemoAccessStore();
    expect(store.accesses).toHaveLength(1);
    expect(store.accesses[0].credentialKind).toBe("anonymous");
    expect(store.accesses[0].passwordHash).toBeUndefined();
    const token = setCookie.split(GUEST_COOKIE_NAME + "=")[1].split(";")[0];
    const verified = verifySignedToken(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.mode).toBe("demo");
      expect(verified.payload.demoAccessId).toBe(store.accesses[0].id);
      expect(verified.payload.exp - verified.payload.iat).toBe(12 * 60 * 60 * 1000);
    }
    expect(mockCallAiJson).not.toHaveBeenCalled();
  });

  it("Cookie 属性：HttpOnly / Secure / SameSite=Lax / Path=/ / Max-Age=43200 / 无 Domain / __Host- 前缀", async () => {
    const response = await POST(guestRequest());
    const setCookie = extractSetCookie(response);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=" + GUEST_COOKIE_MAX_AGE_SECONDS);
    expect(setCookie).not.toContain("Domain=");
    expect(setCookie.startsWith(GUEST_COOKIE_NAME + "=")).toBe(true);
  });

  it("非 PUBLIC_SHOWCASE 模式（缺省/local_owner）→ 403 guest_start_unavailable", async () => {
    delete process.env.QX_RUNTIME_MODE;
    const response = await POST(guestRequest());
    expect(response.status).toBe(403);
    const json = await response.clone().json();
    expect(json.error.code).toBe("guest_start_unavailable");
    process.env.QX_RUNTIME_MODE = "local_owner";
    const response2 = await POST(guestRequest());
    expect(response2.status).toBe(403);
  });

  it("跨站 Origin → 403 origin_mismatch（§28）", async () => {
    const response = await POST(guestRequest(undefined, "https://evil.example"));
    expect(response.status).toBe(403);
    const json = await response.clone().json();
    expect(json.error.code).toBe("origin_mismatch");
  });
});

describe("POST /api/auth/guest — 复用与顺序幂等（§11 / §31）", () => {
  it("GUEST_START_SEQUENTIAL_IDEMPOTENT：第二次带合法 cookie → 同一 demoAccessId，不重建配额", async () => {
    const first = await POST(guestRequest());
    const firstJson = await first.clone().json();
    const token = extractSetCookie(first).split(GUEST_COOKIE_NAME + "=")[1].split(";")[0];

    const second = await POST(guestRequest(token));
    expect(second.status).toBe(200);
    const secondJson = await second.clone().json();
    expect(secondJson.reused).toBe(true);
    expect(secondJson.demoAccess.id).toBe(firstJson.demoAccess.id);
    expect(secondJson.demoAccess.standaloneListingRemaining).toBe(firstJson.demoAccess.standaloneListingRemaining);
    expect(secondJson.demoAccess.standaloneImageUnitsRemaining).toBe(firstJson.demoAccess.standaloneImageUnitsRemaining);
    expect(loadDemoAccessStore().accesses).toHaveLength(1);
    expect(extractSetCookie(second)).toBe("");
  });

  it("失效 cookie（伪造/过期/revoked）→ 重新铸造新 guest", async () => {
    const invalid = await POST(guestRequest("garbage-not-a-token"));
    const json = await invalid.clone().json();
    expect(json.reused).toBe(false);
    expect(loadDemoAccessStore().accesses).toHaveLength(1);
  });
});

describe("匿名记录对遗留密码登录（§9 / §19）", () => {
  it("ANONYMOUS_LEGACY_PASSWORD_DENIED：missing / 空串 / 任意输入 全部 DENIED", async () => {
    delete process.env.QX_RUNTIME_MODE;
    const { record } = createDemoAccess({ label: "anon", credentialKind: "anonymous" });
    expect(record.passwordHash).toBeUndefined();
    const cases: Array<{ label: string; body: string }> = [
      { label: "missing", body: "{}" },
      { label: "empty", body: JSON.stringify({ password: "" }) },
      { label: "arbitrary", body: JSON.stringify({ password: "any-random-input-123" }) },
    ];
    for (const item of cases) {
      const req = new NextRequest("http://127.0.0.1:3005/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: item.body,
      });
      const res = await LOGIN_POST(req);
      expect(res.status).toBe(401);
    }
  });
});

describe("沙箱复用与隔离（契约 07 / §22 / §33）", () => {
  it("GUEST_REUSES_EXISTING_SANDBOX：ensureVisitorDemoCopy 惰性幂等，两次调用同一 taskId", async () => {
    const response = await POST(guestRequest());
    const json = await response.clone().json();
    const guestId = json.demoAccess.id;
    const first = await ensureVisitorDemoCopy(guestId);
    expect(first).not.toBeNull();
    if (!first) return;
    const second = await ensureVisitorDemoCopy(guestId);
    expect(second?.taskId).toBe(first.taskId);
    expect(mockCallAiJson).not.toHaveBeenCalled();
  });

  it("GUEST_A_CANNOT_ACCESS_GUEST_B：A 的 token + B 的 taskId → 404/denied", async () => {
    const aRes = await POST(guestRequest());
    const aJson = await aRes.clone().json();
    const guestAId = aJson.demoAccess.id;
    const { record: b } = createDemoAccess({ label: "B", credentialKind: "anonymous" });
    const bCopy = await ensureVisitorDemoCopy(b.id);
    expect(bCopy).not.toBeNull();
    if (!bCopy) return;
    expect(listSandboxTasks(guestAId).some((t) => t.id === bCopy.taskId)).toBe(false);
    expect(getSandboxTask(guestAId, bCopy.taskId)).toBeNull();
    expect(listSandboxTasks(b.id).some((t) => t.id === bCopy.taskId)).toBe(true);
  });
});