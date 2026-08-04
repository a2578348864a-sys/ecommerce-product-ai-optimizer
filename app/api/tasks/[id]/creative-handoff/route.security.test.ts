import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "fix2-route-test");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
  process.env.ACCESS_PASSWORD = "synthetic-password-for-tests";
});

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/tasks/[id]/creative-handoff/route";

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headersInit = new Headers();
  headersInit.set("x-access-password", headers["x-access-password"] ?? "synthetic-password-for-tests");
  for (const [k, v] of Object.entries(headers)) headersInit.set(k, v);
  return new NextRequest("http://localhost/api/tasks/task-1/creative-handoff", {
    method: "POST",
    headers: headersInit,
    body: text,
  });
}

async function responseJson(res: Response) {
  return { status: res.status, body: await res.json() };
}

function makeGetRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}/creative-handoff`, {
    method: "GET",
    headers: new Headers({ "x-access-password": "synthetic-password-for-tests" }),
  });
}

const VALID_CREATE = {
  action: "create",
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  expectedResearchRevision: 1,
  expectedCurrentHandoffRevision: 0,
  expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-05T00:00:00.000Z" },
  selectedFactIds: ["fact:abc"],
  confirmed: true,
};

const VALID_REVOKE = {
  action: "revoke",
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  expectedCurrentHandoffRevision: 1,
  expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-05T00:00:00.000Z" },
  revokeReasonCode: "explicit_user_revoke",
};

describe("Route 严格请求合同", () => {
  it("44. 未知顶层字段拒绝 → 400 unknown_field", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, evil: 1 }), { params: Promise.resolve({ id: "task-1" }) });
    const j = await responseJson(res);
    expect(res.status).toBe(400);
    expect(j.body.error.code).toBe("unknown_field");
  });

  it("46. 非法 action 拒绝 → 400 invalid_action", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, action: "append" }), { params: Promise.resolve({ id: "task-1" }) });
    const j = await responseJson(res);
    expect(res.status).toBe(400);
    expect(j.body.error.code).toBe("invalid_action");
  });

  it("47. null 根拒绝 → 400 invalid_json", async () => {
    const res = await POST(makeRequest(null), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("48. array 根拒绝 → 400 invalid_json", async () => {
    const res = await POST(makeRequest([1, 2]), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("49. 非字符串 selection 拒绝", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, selectedFactIds: [123] }), { params: Promise.resolve({ id: "task-1" }) });
    const j = await responseJson(res);
    expect(res.status).toBe(400);
    expect(j.body.error.code).toBe("invalid_selection");
  });

  it("50. 重复 selection 拒绝", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, selectedFactIds: ["fact:a", "fact:a"] }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("51. 超长 selection 拒绝", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, selectedFactIds: ["x".repeat(300)] }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("52. 超多 selection 拒绝（>256）", async () => {
    const many = Array.from({ length: 300 }, (_, i) => `fact:${i}`);
    const res = await POST(makeRequest({ ...VALID_CREATE, selectedFactIds: many }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("53. 非法 requestId 拒绝（非 UUID）", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, requestId: "not-a-uuid" }), { params: Promise.resolve({ id: "task-1" }) });
    const j = await responseJson(res);
    expect(res.status).toBe(400);
    expect(j.body.error.code).toBe("invalid_request_id");
  });

  it("54. 请求体超限 → 413 request_too_large", async () => {
    const big = "x".repeat(200 * 1024);
    const res = await POST(makeRequest(big), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(413);
  });

  it("55. 原型污染字段拒绝（__proto__ / constructor / prototype）", async () => {
    const res1 = await POST(makeRequest(JSON.parse('{"__proto__": {"x": 1}}')), { params: Promise.resolve({ id: "task-1" }) });
    expect(res1.status).toBe(400);
    const res2 = await POST(makeRequest({ ...VALID_CREATE, constructor: {} }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res2.status).toBe(400);
    const res3 = await POST(makeRequest({ ...VALID_CREATE, prototype: {} }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res3.status).toBe(400);
  });

  it("56. 完整 Handoff 注入拒绝", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, creativeHandoff: { schema: "product-creative-handoff.v1" } }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("57. Ledger 注入拒绝", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, creativeHandoffRequestLedger: { entries: [] } }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("58. candidateId 注入拒绝", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, candidateId: "cand-1" }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("S1. 下划线内部字段拒绝", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, _requestMeta: {} }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("S2. 缺失 expectedStorageVersion → 400 invalid_storage_version", async () => {
    const { expectedStorageVersion: _sv, ...rest } = VALID_CREATE;
    const res = await POST(makeRequest(rest), { params: Promise.resolve({ id: "task-1" }) });
    const j = await responseJson(res);
    expect(res.status).toBe(400);
    expect(j.body.error.code).toBe("invalid_storage_version");
  });

  it("S3. 错误 storageVersion 格式（非 64-hex）→ 400", async () => {
    const res = await POST(makeRequest({
      ...VALID_CREATE,
      expectedStorageVersion: { resultJsonHash: "short", updatedAt: "2026-08-05T00:00:00.000Z" },
    }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("S4. Revoke 缺失 storageVersion → 400", async () => {
    const { expectedStorageVersion: _sv, ...rest } = VALID_REVOKE;
    const res = await POST(makeRequest(rest), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("S5. 嵌套未知字段拒绝（creativePreferences 内）", async () => {
    const res = await POST(makeRequest({
      ...VALID_CREATE,
      creativePreferences: { tone: "professional", evil: 1 },
    }), { params: Promise.resolve({ id: "task-1" }) });
    const j = await responseJson(res);
    expect(res.status).toBe(400);
    expect(j.body.error.code).toBe("invalid_creative_preferences");
  });

  it("S6. 非法 JSON → 400 invalid_json", async () => {
    const res = await POST(makeRequest("{invalid json"), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("S7. Revoke 非法 reasonCode → 400", async () => {
    const res = await POST(makeRequest({ ...VALID_REVOKE, revokeReasonCode: "evil" }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });

  it("S8. confirmed !== true → 400 confirmation_required", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, confirmed: false }), { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
  });
});

describe("Route 响应 DTO 禁止字段扫描", () => {
  it("S9. GET Preview 响应不含内部字段", async () => {
    const res = await GET(makeGetRequest("demo-task-1"), { params: Promise.resolve({ id: "demo-task-1" }) });
    const text = await res.text();
    expect(text).not.toContain("candidateId");
    expect(text).not.toContain("requestId");
    expect(text).not.toContain("_requestMeta");
    expect(text).not.toContain("creativeHandoffRequestLedger");
    expect(text).not.toContain("requestKeyHash");
    expect(text).not.toContain("requestFingerprint");
    expect(text).not.toContain("actorRef");
    expect(text).not.toContain("demoAccessId");
    expect(text).not.toContain("subjectFingerprint");
    expect(text).not.toContain("researchHash");
    expect(text).not.toContain("handoffFingerprint");
    expect(text).not.toContain("resultJson");
    expect(text).not.toContain("sourceReference");
  });

  it("S10. GET Detail 响应不含内部字段", async () => {
    const res = await GET(makeGetRequest("demo-task-1"), { params: Promise.resolve({ id: "demo-task-1" }) });
    const text = await res.text();
    expect(text).not.toContain("candidateId");
    expect(text).not.toContain("_requestMeta");
    expect(text).not.toContain("creativeHandoffRequestLedger");
    expect(text).not.toContain("requestKeyHash");
  });

  it("S11. POST 错误响应不含内部字段", async () => {
    const res = await POST(makeRequest({ ...VALID_CREATE, evil: 1 }), { params: Promise.resolve({ id: "task-1" }) });
    const text = await res.text();
    expect(text).not.toContain("candidateId");
    expect(text).not.toContain("requestId");
    expect(text).not.toContain("_requestMeta");
    expect(text).not.toContain("creativeHandoffRequestLedger");
    expect(text).not.toContain("stack");
    expect(text).not.toContain("DATABASE_URL");
  });

  it("S12. GET 未知任务错误不含堆栈", async () => {
    const res = await GET(makeGetRequest("demo-unknown"), { params: Promise.resolve({ id: "demo-unknown" }) });
    const text = await res.text();
    expect(text).not.toContain("at ");
    expect(text).not.toContain("Error:");
  });
});
