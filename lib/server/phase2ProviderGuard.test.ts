/**
 * V3.1 Phase 2 — D1 Provider Guard（§4-7 / §41-44）
 * 统一 quota authority：guest listing=1 / image=1（ENV 可配）；legacy 3；全局 cap 独立；
 * 并发原子性；幂等重试；IP backstop。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import { createDemoAccess, saveDemoAccessStore, loadDemoAccessStore } from "@/lib/server/demoAccess";
import {
  guardDemoProviderAction,
  finalizeDemoProviderAction,
  getLatestDemoSnapshot,
  type DemoProviderActionToken,
} from "@/lib/server/demoGuard";
import { getGlobalProviderUsage } from "@/lib/server/providerUsageLedger";
import type { AccessContext } from "@/lib/server/accessPassword";

const RUN = randomBytes(4).toString("hex");
const STORE = join(tmpdir(), "phase2-guard-" + RUN + ".json");
const LEDGER = join(tmpdir(), "phase2-ledger-" + RUN + ".json");

function request(): NextRequest {
  return new NextRequest("http://127.0.0.1:3010/api/tasks/sandbox_task_x/listing-handoff", {
    method: "POST",
    headers: { "x-remote-addr": "203.0.113.9", origin: "http://127.0.0.1:3010" },
  });
}

function guestCtx(recordId: string): AccessContext {
  return { mode: "demo", token: "t", demoAccessId: recordId, isActive: true, isExpired: false, remainingAiCalls: 0, credentialKind: "anonymous" };
}

function legacyCtx(recordId: string): AccessContext {
  return { mode: "demo", token: "t", demoAccessId: recordId, isActive: true, isExpired: false, remainingAiCalls: 5, credentialKind: "password" };
}

beforeEach(() => {
  process.env.QX_RUNTIME_MODE = "public_showcase";
  process.env.ACCESS_PASSWORD = "phase2-guard-secret";
  process.env.DEMO_ACCESS_STORE_PATH = STORE;
  process.env.PROVIDER_USAGE_STORE_PATH = LEDGER;
  saveDemoAccessStore({ version: 1, accesses: [] });
});

afterEach(() => {
  delete process.env.QX_RUNTIME_MODE;
  delete process.env.ACCESS_PASSWORD;
  delete process.env.DEMO_ACCESS_STORE_PATH;
  delete process.env.PROVIDER_USAGE_STORE_PATH;
  delete process.env.PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP;
  delete process.env.PUBLIC_DAILY_IMAGE_PROVIDER_CALL_CAP;
  delete process.env.QX_IP_TEXT_PROVIDER_LIMIT_15M;
  for (const p of [STORE, STORE + ".lock", LEDGER, LEDGER + ".lock"]) { try { if (existsSync(p)) unlinkSync(p); } catch { /* ok */ } }
});

describe("D1：Listing/Image 统一 quota authority（§4-5）", () => {
  it("guest listing：reserve→commit 后 used=1；第二次 → quota_exceeded", () => {
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const ctx = guestCtx(record.id);
    const first = guardDemoProviderAction(ctx, request(), { kind: "listing", requestId: "r-1", units: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(getLatestDemoSnapshot(ctx)?.standaloneListingRemaining).toBe(0);
    finalizeDemoProviderAction(ctx, first.token, { kind: "listing", requestId: "r-1", units: 1 }, true);
    expect(getLatestDemoSnapshot(ctx)?.standaloneListingUsed).toBe(1);
    const second = guardDemoProviderAction(ctx, request(), { kind: "listing", requestId: "r-2", units: 1 });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("demo_standalone_listing_quota_exceeded");
  });

  it("guest image：remaining=1 时 count=2 → 整体拒绝（§5，禁止 remaining=1 生成 2 张）", () => {
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const ctx = guestCtx(record.id);
    const guarded = guardDemoProviderAction(ctx, request(), { kind: "image", requestId: "img-2", units: 2 });
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.code).toBe("demo_standalone_image_quota_exceeded");
    expect(getLatestDemoSnapshot(ctx)?.standaloneImageUnitsRemaining).toBe(1);
  });

  it("失败回补：finalize(false) 释放预留，remaining 恢复（§7）", () => {
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const ctx = guestCtx(record.id);
    const first = guardDemoProviderAction(ctx, request(), { kind: "listing", requestId: "r-a", units: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    finalizeDemoProviderAction(ctx, first.token, { kind: "listing", requestId: "r-a", units: 1 }, false);
    expect(getLatestDemoSnapshot(ctx)?.standaloneListingRemaining).toBe(1);
  });

  it("legacy visitor 保持 3（§4：Legacy Visitor 原 3，不改历史语义）", () => {
    const { record } = createDemoAccess({ label: "L", maxAiCalls: 5 });
    const ctx = legacyCtx(record.id);
    for (let index = 0; index < 3; index += 1) {
      const g = guardDemoProviderAction(ctx, request(), { kind: "listing", requestId: "l-" + index, units: 1 });
      expect(g.ok).toBe(true);
      if (g.ok) finalizeDemoProviderAction(ctx, g.token, { kind: "listing", requestId: "l-" + index, units: 1 }, true);
    }
    expect(getLatestDemoSnapshot(ctx)?.standaloneListingUsed).toBe(3);
    const fourth = guardDemoProviderAction(ctx, request(), { kind: "listing", requestId: "l-3", units: 1 });
    expect(fourth.ok).toBe(false);
  });
});

describe("并发原子性（§7 / §42-43）", () => {
  it("LISTING_CONCURRENT_10_ONLY_ONE：quota=1 时 10 个并发仅 1 个成功", async () => {
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const ctx = guestCtx(record.id);
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        Promise.resolve().then(() => guardDemoProviderAction(ctx, request(), { kind: "listing", requestId: "c-" + index, units: 1 }))),
    );
    expect(attempts.filter((a) => a.ok)).toHaveLength(1);
    expect(attempts.filter((a) => !a.ok)).toHaveLength(9);
  });

  it("IMAGE_CONCURRENT_10_ONLY_ONE：units=1 时 10 个并发仅 1 个成功", async () => {
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const ctx = guestCtx(record.id);
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        Promise.resolve().then(() => guardDemoProviderAction(ctx, request(), { kind: "image", requestId: "ci-" + index, units: 1 }))),
    );
    expect(attempts.filter((a) => a.ok)).toHaveLength(1);
  });

  it("IDEMPOTENT_RETRY：同 requestId 重试 → duplicate，不重复占用 quota 与全局 cap", () => {
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const ctx = guestCtx(record.id);
    const first = guardDemoProviderAction(ctx, request(), { kind: "listing", requestId: "same-req", units: 1 });
    expect(first.ok).toBe(true);
    const second = guardDemoProviderAction(ctx, request(), { kind: "listing", requestId: "same-req", units: 1 });
    expect(second.ok).toBe(true);
    if (second.ok && second.token.reservation) {
      expect(second.token.reservation.duplicate).toBe(true);
    }
    expect(getGlobalProviderUsage().text.used).toBe(1);
  });
});

describe("GLOBAL_CAP（§13-17 / §44）", () => {
  it("GLOBAL_CAP_MULTI_GUEST：清 Cookie / 多 Guest 也绕不过全局 cap", () => {
    process.env.PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP = "1";
    const { record: a } = createDemoAccess({ label: "A", credentialKind: "anonymous" });
    const { record: b } = createDemoAccess({ label: "B", credentialKind: "anonymous" });
    const ctxA = guestCtx(a.id);
    const ctxB = guestCtx(b.id);
    const ga = guardDemoProviderAction(ctxA, request(), { kind: "listing", requestId: "g-a", units: 1 });
    expect(ga.ok).toBe(true);
    const gb = guardDemoProviderAction(ctxB, request(), { kind: "listing", requestId: "g-b", units: 1 });
    expect(gb.ok).toBe(false);
    if (!gb.ok) expect(gb.code).toBe("global_provider_cap_exceeded");
    // guest B 的自身配额未被消耗（全局拒绝发生在 quota 之前/同事务回滚）
    expect(getLatestDemoSnapshot(ctxB)?.standaloneListingRemaining).toBe(1);
  });

  it("GLOBAL_CONCURRENT_ONLY_ONE：remaining=1 时 10 个并发（多 Guest）仅 1 个预留成功", async () => {
    process.env.PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP = "1";
    const records = Array.from({ length: 10 }, () => createDemoAccess({ label: "G", credentialKind: "anonymous" }).record);
    const attempts = await Promise.all(
      records.map((record, index) =>
        Promise.resolve().then(() => guardDemoProviderAction(guestCtx(record.id), request(), { kind: "listing", requestId: "gc-" + index, units: 1 }))),
    );
    expect(attempts.filter((a) => a.ok)).toHaveLength(1);
    expect(attempts.filter((a) => !a.ok && a.code === "global_provider_cap_exceeded")).toHaveLength(9);
  });

  it("GLOBAL_CAP_VIEW_STILL_ALLOWED：全局耗尽只阻断真实 Provider 动作，查看照常（§18）", () => {
    process.env.PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP = "0";
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const ctx = guestCtx(record.id);
    const guarded = guardDemoProviderAction(ctx, request(), { kind: "listing", requestId: "v-1", units: 1 });
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.code).toBe("global_provider_cap_exceeded");
    // 快照/查看路径不受影响
    expect(getLatestDemoSnapshot(ctx)).not.toBeNull();
  });
});

describe("IP backstop 与 owner 直通", () => {
  it("ABUSE_BURST：Provider burst 超限 → 429 rate_limited（guard 前置）", () => {
    process.env.QX_IP_TEXT_PROVIDER_LIMIT_15M = "0";
    const { record } = createDemoAccess({ label: "G", credentialKind: "anonymous" });
    const guarded = guardDemoProviderAction(guestCtx(record.id), request(), { kind: "listing", requestId: "ip-1", units: 1 });
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.code).toBe("rate_limited");
  });

  it("Owner 直通：不消耗 guest quota / global cap / IP（§6）", () => {
    const owner = { mode: "owner" as const, token: "t" };
    const g = guardDemoProviderAction(owner, request(), { kind: "listing", requestId: "o-1", units: 100 });
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.token.reservation).toBeNull();
    expect(getGlobalProviderUsage().text.used).toBe(0);
  });
});