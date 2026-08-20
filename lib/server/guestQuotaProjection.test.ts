/**
 * V3.1 Phase 1 — Guest Quota Projection（契约 04-2 / §24 / §25）
 * anonymous guest：AI_RESEARCH=0 / LISTING=1 / IMAGE=1（ENV 可配）；legacy Visitor 3/3 保持兼容；
 * productJourneys 语义保留（不重解释为 AI Research Quota）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import { createDemoAccess, saveDemoAccessStore } from "@/lib/server/demoAccess";
import {
  buildDemoAccessSnapshot,
  reserveVisitorStandaloneStudioQuota,
  markVisitorStandaloneStudioProviderStarted,
} from "@/lib/server/demoGuard";
import { buildDemoProductJourneySnapshot } from "@/lib/server/demoProductJourneyQuota";

const RUN = randomBytes(4).toString("hex");
const STORE = join(tmpdir(), "guest-quota-" + RUN + ".json");

beforeEach(() => {
  process.env.DEMO_ACCESS_STORE_PATH = STORE;
  saveDemoAccessStore({ version: 1, accesses: [] });
});

afterEach(() => {
  delete process.env.DEMO_ACCESS_STORE_PATH;
  delete process.env.PUBLIC_GUEST_LISTING_GENERATION_QUOTA;
  delete process.env.PUBLIC_GUEST_IMAGE_GENERATION_QUOTA;
  delete process.env.PUBLIC_GUEST_AI_RESEARCH_ACTION_QUOTA;
  try { if (existsSync(STORE)) unlinkSync(STORE); } catch { /* ok */ }
  try { if (existsSync(STORE + ".lock")) unlinkSync(STORE + ".lock"); } catch { /* ok */ }
});

describe("PUBLIC_QUOTA_PROJECTION_0_1_1", () => {
  it("anonymous guest 缺省：listing=1 / image=1 / research=0（AI_RESEARCH_ACTION_QUOTA=0）", () => {
    const { record } = createDemoAccess({ label: "公开访客", credentialKind: "anonymous" });
    const snap = buildDemoAccessSnapshot(record);
    expect(snap.credentialKind).toBe("anonymous");
    expect(snap.standaloneListingLimit).toBe(1);
    expect(snap.standaloneListingRemaining).toBe(1);
    expect(snap.standaloneImageUnitLimit).toBe(1);
    expect(snap.standaloneImageUnitsRemaining).toBe(1);
    expect(snap.maxAiCalls).toBe(0);
    expect(snap.remainingAiCalls).toBe(0);
    expect(snap.remainingAiJobs).toBe(0);
  });

  it("ENV 可配：PUBLIC_GUEST_LISTING_GENERATION_QUOTA / IMAGE 覆盖默认值", () => {
    process.env.PUBLIC_GUEST_LISTING_GENERATION_QUOTA = "2";
    process.env.PUBLIC_GUEST_IMAGE_GENERATION_QUOTA = "3";
    const { record } = createDemoAccess({ label: "公开访客", credentialKind: "anonymous" });
    const snap = buildDemoAccessSnapshot(record);
    expect(snap.standaloneListingLimit).toBe(2);
    expect(snap.standaloneImageUnitLimit).toBe(3);
  });

  it("ENV 可配：AI_RESEARCH_ACTION_QUOTA 只影响 research 动作额度，不重解释 productJourneys", () => {
    process.env.PUBLIC_GUEST_AI_RESEARCH_ACTION_QUOTA = "7";
    const { record } = createDemoAccess({ label: "公开访客", credentialKind: "anonymous" });
    const snap = buildDemoAccessSnapshot(record);
    expect(snap.maxAiCalls).toBe(7);
    // productJourneys 语义保留：仍是研究链计数 5（契约 04-4 / §25，绝不等于 AI 配额）
    const journey = buildDemoProductJourneySnapshot(record);
    expect(journey.maxProducts).toBe(5);
    expect(journey.quotaMetric).toBe("product_journeys_v1");
  });

  it("Legacy Visitor 3/3 保持兼容（§3 / §34）：不改历史语义", () => {
    const { record } = createDemoAccess({ label: "legacy", maxAiCalls: 5 });
    const snap = buildDemoAccessSnapshot(record);
    expect(snap.credentialKind).toBe("password");
    expect(snap.standaloneListingLimit).toBe(3);
    expect(snap.standaloneImageUnitLimit).toBe(3);
    expect(snap.maxAiCalls).toBe(5);
    expect(snap.standaloneListingRemaining).toBe(3);
  });

  it("额度消耗走现有 reservation 机制（guest 限额 1：预留+启动后 remaining=0）", () => {
    const { record } = createDemoAccess({ label: "公开访客", credentialKind: "anonymous" });
    const ctx = { mode: "demo", token: "t", demoAccessId: record.id, isActive: true, isExpired: false, remainingAiCalls: 0, credentialKind: "anonymous" } as const;
    const reserved = reserveVisitorStandaloneStudioQuota(ctx, { kind: "listing", requestId: "guest-listing-1", units: 1 });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok || !reserved.reservation) return;
    expect(reserved.snapshot?.standaloneListingRemaining).toBe(0);
    const started = markVisitorStandaloneStudioProviderStarted(ctx, reserved.reservation);
    if (started.ok) expect(started.snapshot?.standaloneListingRemaining).toBe(0);
    // 第二次预留 → quota_exceeded（guest 限额 1 生效）
    const second = reserveVisitorStandaloneStudioQuota(ctx, { kind: "listing", requestId: "guest-listing-2", units: 1 });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("demo_standalone_listing_quota_exceeded");
  });
});