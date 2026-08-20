/**
 * V3.1 Phase 2 — D1_LISTING_HANDOFF_QUOTA_GUARDED（§3-4 / §42）
 * listing-handoff POST 必须：reserve（guest quota + global cap 同事务）→ provider → 结算；
 * 并发 10 请求 → Success<=1 / Provider Spy Calls<=1 / 其余 quota 拒绝。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import { createDemoAccess, saveDemoAccessStore, loadDemoAccessStore } from "@/lib/server/demoAccess";
import { GUEST_COOKIE_NAME } from "@/lib/server/guestCookie";

const mockGenerate = vi.fn();
vi.mock("@/lib/listingHandoff/listingGenerationService", () => ({
  generateListingDraftFromHandoff: mockGenerate,
  ListingHandoffError: class ListingHandoffError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message); }
  },
  draftSafeSummary: vi.fn((value: unknown) => value),
}));
vi.mock("@/lib/listingHandoff/listingBrief", () => ({
  buildListingBrief: vi.fn((brief: unknown) => ({ ok: true, brief })),
}));

const { POST } = await import("@/app/api/tasks/[id]/listing-handoff/route");

const RUN = randomBytes(4).toString("hex");
const STORE = join(tmpdir(), "d1-listing-" + RUN + ".json");
const LEDGER = join(tmpdir(), "d1-ledger-" + RUN + ".json");

function buildPost(requestId: string, token: string, origin = "http://127.0.0.1:3010"): NextRequest {
  const body = JSON.stringify({
    requestId,
    expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-20T00:00:00.000Z" },
    expectedHandoffRevision: 1,
    confirmed: true,
    listingBrief: { primaryKeyword: "water bottle", supportingKeywords: [], backendSearchTerms: [] },
  });
  return new NextRequest("http://127.0.0.1:3010/api/tasks/sandbox_task_d1/listing-handoff", {
    method: "POST",
    headers: { "content-type": "application/json", "x-remote-addr": "203.0.113.9", origin, cookie: GUEST_COOKIE_NAME + "=" + token },
    body,
  });
}

function okDraft(providerAttempted: boolean) {
  return {
    listingStatus: "ready",
    currentHandoffRevision: 1,
    sourceHandoffRevision: 1,
    idempotentReplay: false,
    listingSaved: true,
    draft: {
      providerAttempted,
      generatedAt: null,
      source: null,
      version: null,
      composerVersion: null,
      generationPolicyVersion: null,
      polishApplied: false,
      polishModel: null,
      titles: [],
      bullets: [],
      description: null,
      keywords: [],
      sellingPoints: [],
      riskNotes: [],
      reviewChecklist: [],
      blockedClaims: [],
      complianceWarnings: [],
    },
    safeFallbackApplied: !providerAttempted,
    handoffState: { controlState: "active", stale: false },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.QX_RUNTIME_MODE = "public_showcase";
  process.env.ACCESS_PASSWORD = "d1-test-secret";
  process.env.DEMO_ACCESS_STORE_PATH = STORE;
  process.env.PROVIDER_USAGE_STORE_PATH = LEDGER;
  saveDemoAccessStore({ version: 1, accesses: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.QX_RUNTIME_MODE;
  delete process.env.ACCESS_PASSWORD;
  delete process.env.DEMO_ACCESS_STORE_PATH;
  delete process.env.PROVIDER_USAGE_STORE_PATH;
  delete process.env.PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP;
  for (const p of [STORE, STORE + ".lock", LEDGER, LEDGER + ".lock"]) { try { if (existsSync(p)) unlinkSync(p); } catch { /* ok */ } }
});

describe("D1_LISTING_HANDOFF_QUOTA_GUARDED", () => {
  it("真实 Provider 调用发生（providerAttempted=true）→ 配额 commit（used=1），响应 200", async () => {
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const token = (await import("@/lib/server/signedToken")).generateSignedToken("demo", record.id);
    mockGenerate.mockResolvedValue(okDraft(true));
    const response = await POST(buildPost("11111111-1111-4111-8111-111111111111", token), { params: Promise.resolve({ id: "sandbox_task_d1" }) });
    expect(response.status).toBe(200);
    const access = loadDemoAccessStore().accesses.find((a) => a.id === record.id);
    expect(access?.standaloneListingUsed).toBe(1);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("确定性失败（安全兜底，无 Provider 调用）→ 预留回补（used=0），响应 200", async () => {
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const token = (await import("@/lib/server/signedToken")).generateSignedToken("demo", record.id);
    mockGenerate.mockResolvedValue(okDraft(false));
    const response = await POST(buildPost("22222222-2222-4222-8222-222222222222", token), { params: Promise.resolve({ id: "sandbox_task_d1" }) });
    expect(response.status).toBe(200);
    const access = loadDemoAccessStore().accesses.find((a) => a.id === record.id);
    expect(access?.standaloneListingUsed ?? 0).toBe(0);
  });

  it("LISTING_CONCURRENT_10_ONLY_ONE：10 个并发 → Success<=1 / Provider Spy<=1 / 其余 quota 拒绝", async () => {
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const token = (await import("@/lib/server/signedToken")).generateSignedToken("demo", record.id);
    mockGenerate.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return okDraft(true);
    });
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) => {
        const uuid = "30000000-0000-4000-8000-" + String(index).padStart(12, "0");
        return POST(buildPost(uuid, token), { params: Promise.resolve({ id: "sandbox_task_d1" }) });
      }),
    );
    const statuses = await Promise.all(attempts.map((r) => r.status));
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 403)).toHaveLength(9);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const access = loadDemoAccessStore().accesses.find((a) => a.id === record.id);
    expect(access?.standaloneListingUsed).toBe(1);
  });

  it("GLOBAL cap 耗尽：guest 生成 → 403 global_provider_cap_exceeded（不消耗 guest quota）", async () => {
    process.env.PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP = "0";
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const token = (await import("@/lib/server/signedToken")).generateSignedToken("demo", record.id);
    const response = await POST(buildPost("44444444-4444-4444-8444-444444444444", token), { params: Promise.resolve({ id: "sandbox_task_d1" }) });
    expect(response.status).toBe(403);
    const json = await response.clone().json();
    expect(json.error.code).toBe("global_provider_cap_exceeded");
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});