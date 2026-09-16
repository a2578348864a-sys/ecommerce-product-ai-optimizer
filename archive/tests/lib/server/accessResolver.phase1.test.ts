/**
 * V3.1 Phase 1 — Unified Access Resolver 测试（契约 03-5 / §16 / §29 / §30）
 * 覆盖双来源冲突矩阵 8 态、运行模式语义、Host 伪造否定、Origin 校验、scope deny-list。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { generateSignedToken } from "@/lib/server/signedToken";
import { createDemoAccess, saveDemoAccessStore } from "@/lib/server/demoAccess";
import { resolveAccessContext, getAccessContext } from "@/lib/server/accessPassword";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { GUEST_COOKIE_NAME } from "@/lib/server/guestCookie";
import { resolveGuestCapability } from "@/lib/server/guestCapabilities";

const STORE = ".next/test-stores/access-resolver.phase1.json";

function buildRequest(url: string, init?: { headers?: Record<string, string>; method?: string }): NextRequest {
  return new NextRequest(url, { method: init?.method ?? "GET", headers: init?.headers ?? {} });
}

function guestCookieHeader(token: string): Record<string, string> {
  return { cookie: GUEST_COOKIE_NAME + "=" + token };
}

beforeEach(() => {
  process.env.ACCESS_PASSWORD = "test-dummy-password-for-unit-tests";
  process.env.DEMO_ACCESS_STORE_PATH = STORE;
  saveDemoAccessStore({ version: 1, accesses: [] });
});

afterEach(() => {
  delete process.env.QX_RUNTIME_MODE;
  delete process.env.ACCESS_PASSWORD;
  delete process.env.DEMO_ACCESS_STORE_PATH;
  delete process.env.QX_PUBLIC_ORIGIN;
});

describe("双来源冲突矩阵（§16 FROZEN）", () => {
  let guestA: string;
  let guestB: string;
  let legacyDemoId: string;

  beforeEach(() => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const { record: a } = createDemoAccess({ label: "A", credentialKind: "anonymous" });
    const { record: b } = createDemoAccess({ label: "B", credentialKind: "anonymous" });
    guestA = generateSignedToken("demo", a.id);
    guestB = generateSignedToken("demo", b.id);
    legacyDemoId = createDemoAccess({ label: "legacy", maxAiCalls: 5 }).record.id;
  });

  it("NONE → unauthenticated", () => {
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3010/api/x"));
    expect(res).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("COOKIE valid only → ACCEPT（demo）", () => {
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3010/api/x", { headers: guestCookieHeader(guestA) }));
    expect(res.ok).toBe(true);
    if (res.ok && res.context.mode === "demo") {
      expect(res.context.credentialKind).toBe("anonymous");
    }
  });

  it("LEGACY HEADER valid only → ACCEPT", () => {
    const token = generateSignedToken("demo", legacyDemoId);
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3010/api/x", { headers: { "x-access-token": token } }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.context.mode).toBe("demo");
  });

  it("COOKIE + HEADER 同一身份 → ACCEPT", () => {
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3010/api/x", {
      headers: { ...guestCookieHeader(guestA), "x-access-token": guestA },
    }));
    expect(res.ok).toBe(true);
    if (res.ok && res.context.mode === "demo") expect(res.context.demoAccessId).toBeDefined();
  });

  it("COOKIE + HEADER 不同身份 → FAIL CLOSED（conflict）", () => {
    const req = buildRequest("http://127.0.0.1:3010/api/x", {
      headers: { ...guestCookieHeader(guestA), "x-access-token": guestB },
    });
    expect(resolveAccessContext(req)).toEqual({ ok: false, reason: "conflict" });
    expect(requireAuthenticated(req)).toMatchObject({ ok: false, status: 401, code: "token_context_conflict" });
  });

  it("invalid COOKIE + valid HEADER → FAIL CLOSED（无 silent fallback）", () => {
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3010/api/x", {
      headers: { ...guestCookieHeader("garbage-token"), "x-access-token": guestB },
    }));
    expect(res).toEqual({ ok: false, reason: "conflict" });
  });

  it("valid COOKIE + invalid HEADER → FAIL CLOSED", () => {
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3010/api/x", {
      headers: { ...guestCookieHeader(guestA), "x-access-token": "garbage-token" },
    }));
    expect(res).toEqual({ ok: false, reason: "conflict" });
  });

  it("both invalid → FAIL CLOSED", () => {
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3010/api/x", {
      headers: { ...guestCookieHeader("bad-cookie"), "x-access-token": "bad-header" },
    }));
    expect(res.ok).toBe(false);
  });

  it("遗留头短路语义保持：x-access-token 存在无效 → 不回退 x-access-password", () => {
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3010/api/x", {
      headers: { "x-access-token": "bad", "x-access-password": guestB },
    }));
    expect(res.ok).toBe(false);
  });
});

describe("运行模式语义（§6 / §7 / §29 / §30）", () => {
  it("LOCAL_OWNER 显式：无凭据 → owner 上下文（NO AUTH / FULL OWNER）", () => {
    process.env.QX_RUNTIME_MODE = "local_owner";
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3005/api/tasks"));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.context.mode).toBe("owner");
    expect(requireOwnerOnly(buildRequest("http://127.0.0.1:3005/api/tasks")).ok).toBe(true);
    expect(requireAuthenticated(buildRequest("http://127.0.0.1:3005/api/tasks")).ok).toBe(true);
  });

  it("缺省（未显式配置）= v3.0.1 现状语义：无凭据 → unauthenticated（不开口子）", () => {
    delete process.env.QX_RUNTIME_MODE;
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3005/api/tasks"));
    expect(res).toEqual({ ok: false, reason: "unauthenticated" });
    expect(requireOwnerOnly(buildRequest("http://127.0.0.1:3005/api/tasks"))).toMatchObject({
      ok: false, status: 401, code: "invalid_access",
    });
  });

  it("PUBLIC_SHOWCASE：Host / X-Forwarded-Host / Origin 伪造不得获得 OWNER", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const spoof = buildRequest("http://127.0.0.1:3010/api/x", {
      headers: { host: "localhost", "x-forwarded-host": "127.0.0.1", origin: "http://localhost" },
    });
    expect(resolveAccessContext(spoof)).toEqual({ ok: false, reason: "unauthenticated" });
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const guestToken = generateSignedToken("demo", record.id);
    const withCookie = resolveAccessContext(buildRequest("http://127.0.0.1:3010/api/x", {
      headers: { ...guestCookieHeader(guestToken), host: "localhost", "x-forwarded-host": "127.0.0.1", origin: "http://localhost" },
    }));
    expect(withCookie.ok).toBe(true);
    if (withCookie.ok) expect(withCookie.context.mode).toBe("demo");
  });

  it("LOCAL_OWNER：伪造请求输入不得切换模式（Runtime 只由 trusted env 决定）", () => {
    process.env.QX_RUNTIME_MODE = "local_owner";
    const spoof = buildRequest("http://127.0.0.1:3005/api/x", {
      headers: { host: "public.example.com", "x-forwarded-host": "public.example.com", origin: "https://public.example.com" },
    });
    const res = resolveAccessContext(spoof);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.context.mode).toBe("owner");
  });

  it("PUBLIC_SHOWCASE：遗留 raw-password 认证关闭（契约 07/10）", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3010/api/x"), { accessPassword: "test-dummy-password-for-unit-tests" });
    expect(res).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("缺省模式：遗留 raw-password 仍可用（向后兼容）", () => {
    delete process.env.QX_RUNTIME_MODE;
    const res = resolveAccessContext(buildRequest("http://127.0.0.1:3005/api/x"), { accessPassword: "test-dummy-password-for-unit-tests" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.context.mode).toBe("owner");
  });
});

describe("CSRF 基础（契约 09-4 / §28）", () => {
  it("变更方法 + 跨站 Origin → 403 origin_mismatch", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const req = buildRequest("http://127.0.0.1:3010/api/x", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(requireAuthenticated(req)).toMatchObject({ ok: false, status: 403, code: "origin_denied" });
  });

  it("同源 Origin + Cookie 认证 → 通过（§29）", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const token = generateSignedToken("demo", record.id);
    const sameOrigin = buildRequest("http://127.0.0.1:3010/api/tasks/sandbox_task_1/listing-handoff", {
      method: "POST",
      headers: { ...guestCookieHeader(token), origin: "http://127.0.0.1:3010" },
    });
    expect(requireAuthenticated(sameOrigin).ok).toBe(true);
  });

  it("反代部署（QX_PUBLIC_ORIGIN 配置）：公网 Origin 视为同源（Phase 4 修复）", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    process.env.QX_PUBLIC_ORIGIN = "https://112.124.54.81";
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const token = generateSignedToken("demo", record.id);
    // nextUrl.origin 是回环自址（nginx + X-Forwarded-Proto 场景），公网 Origin 精确匹配 QX_PUBLIC_ORIGIN → 通过
    const proxied = buildRequest("http://127.0.0.1:3005/api/tasks/sandbox_task_1/listing-handoff", {
      method: "POST",
      headers: { ...guestCookieHeader(token), origin: "https://112.124.54.81" },
    });
    expect(requireAuthenticated(proxied).ok).toBe(true);
    // 跨站 Origin 仍拒绝（QX_PUBLIC_ORIGIN 不构成宽免）
    const crossSite = buildRequest("http://127.0.0.1:3005/api/x", {
      method: "POST",
      headers: { ...guestCookieHeader(token), origin: "https://evil.example" },
    });
    expect(requireAuthenticated(crossSite)).toMatchObject({ ok: false, status: 403, code: "origin_denied" });
    // scheme 不同也拒绝（http 明文伪造 https 公网 origin 无效）
    const wrongScheme = buildRequest("http://127.0.0.1:3005/api/x", {
      method: "POST",
      headers: { ...guestCookieHeader(token), origin: "http://112.124.54.81" },
    });
    expect(requireAuthenticated(wrongScheme)).toMatchObject({ ok: false, status: 403, code: "origin_denied" });
  });

  it("未配置 QX_PUBLIC_ORIGIN：反代自址不匹配 → 仍 fail-closed（原行为不变）", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    delete process.env.QX_PUBLIC_ORIGIN;
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const token = generateSignedToken("demo", record.id);
    const proxied = buildRequest("http://127.0.0.1:3005/api/x", {
      method: "POST",
      headers: { ...guestCookieHeader(token), origin: "https://112.124.54.81" },
    });
    expect(requireAuthenticated(proxied)).toMatchObject({ ok: false, status: 403, code: "origin_denied" });
  });

  it("Cookie 认证变更请求缺少 Origin → FAIL CLOSED（origin_denied，§28）", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const token = generateSignedToken("demo", record.id);
    const noOrigin = buildRequest("http://127.0.0.1:3010/api/x", { method: "POST", headers: guestCookieHeader(token) });
    expect(requireAuthenticated(noOrigin)).toMatchObject({ ok: false, status: 403, code: "origin_denied" });
    const nullOrigin = buildRequest("http://127.0.0.1:3010/api/x", {
      method: "POST",
      headers: { ...guestCookieHeader(token), origin: "null" },
    });
    expect(requireAuthenticated(nullOrigin)).toMatchObject({ ok: false, status: 403, code: "origin_denied" });
  });

  it("非 Cookie 认证（legacy header）变更请求无 Origin → 保持既有语义（bearer，无 ambient CSRF 面）", () => {
    delete process.env.QX_RUNTIME_MODE;
    const { record } = createDemoAccess({ label: "legacy", maxAiCalls: 5 });
    const token = generateSignedToken("demo", record.id);
    const headerOnly = buildRequest("http://127.0.0.1:3005/api/x", {
      method: "POST",
      headers: { "x-access-token": token },
    });
    expect(requireAuthenticated(headerOnly).ok).toBe(true);
  });
});

describe("Public Guest Capability Allow-list（契约 01-5 / §21-24，DEFAULT DENY）", () => {
  it("显式 ALLOW：金标演示 / 只读任务 / 证据 / 交接链 / 生成（quota）", () => {
    expect(resolveGuestCapability("GET", "/api/demo/golden")).toBe("view_golden_demo");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_1")).toBe("view_guest_task");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_1/fact-candidates")).toBe("view_evidence");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_1/image-draft/img_1")).toBe("view_existing_images");
    expect(resolveGuestCapability("GET", "/api/tasks/sandbox_task_1/listing-handoff")).toBe("view_existing_listing");
    expect(resolveGuestCapability("POST", "/api/tasks/sandbox_task_1/listing-handoff")).toBe("generate_guest_listing");
    expect(resolveGuestCapability("POST", "/api/tasks/sandbox_task_1/image-handoff")).toBe("generate_guest_image");
    expect(resolveGuestCapability("POST", "/api/tasks/sandbox_task_1/research-decision")).toBe("human_demo_interaction");
  });

  it("UNKNOWN_GUEST_ACTION_DENIED：未注册动作 → null（默认 DENY，§23）", () => {
    expect(resolveGuestCapability("POST", "/api/workflows/product-analysis")).toBeNull();
    expect(resolveGuestCapability("POST", "/api/opportunities/crawl")).toBeNull();
    expect(resolveGuestCapability("POST", "/api/opportunities/sellersprite-import")).toBeNull();
    expect(resolveGuestCapability("POST", "/api/opportunity-candidates")).toBeNull();
    expect(resolveGuestCapability("POST", "/api/tasks/sandbox_task_1/browser-evidence")).toBeNull();
    expect(resolveGuestCapability("DELETE", "/api/tasks/sandbox_task_1")).toBeNull();
    expect(resolveGuestCapability("GET", "/api/tasks")).toBeNull();
    expect(resolveGuestCapability("GET", "/api/opportunity-candidates")).toBeNull();
    expect(resolveGuestCapability("GET", "/api/runtime-mode")).toBeNull();
  });

  it("PUBLIC_SHOWCASE + anonymous guest：未注册路由 → 403 guest_scope_denied（服务端强制）", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const token = generateSignedToken("demo", record.id);
    const req = buildRequest("http://127.0.0.1:3010/api/workflows/product-analysis", {
      method: "POST",
      headers: { ...guestCookieHeader(token), "content-type": "application/json", origin: "http://127.0.0.1:3010" },
    });
    expect(requireAuthenticated(req)).toMatchObject({ ok: false, status: 403, code: "guest_scope_denied" });
  });

  it("PUBLIC_SHOWCASE + anonymous guest：显式 ALLOW 路由放行（金标演示）", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const token = generateSignedToken("demo", record.id);
    const req = buildRequest("http://127.0.0.1:3010/api/demo/golden", {
      method: "GET",
      headers: guestCookieHeader(token),
    });
    expect(requireAuthenticated(req).ok).toBe(true);
  });

  it("PUBLIC_SHOWCASE + 遗留 visitor token：不受 allow-list 限制（仅 anonymous guest）", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const { record } = createDemoAccess({ label: "legacy", maxAiCalls: 5 });
    const token = generateSignedToken("demo", record.id);
    const req = buildRequest("http://127.0.0.1:3010/api/workflows/product-analysis", {
      method: "POST",
      headers: { "x-access-token": token, "content-type": "application/json" },
    });
    expect(requireAuthenticated(req).ok).toBe(true);
  });
});

describe("getAccessContext 包装兼容（既有调用方）", () => {
  it("冲突/未认证 → null（backward-compatible wrapper）", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    expect(getAccessContext(buildRequest("http://127.0.0.1:3010/api/x"))).toBeNull();
    const { record: a } = createDemoAccess({ label: "A", credentialKind: "anonymous" });
    const { record: b } = createDemoAccess({ label: "B", credentialKind: "anonymous" });
    const ta = generateSignedToken("demo", a.id);
    const tb = generateSignedToken("demo", b.id);
    expect(getAccessContext(buildRequest("http://127.0.0.1:3010/api/x", {
      headers: { ...guestCookieHeader(ta), "x-access-token": tb },
    }))).toBeNull();
  });
});