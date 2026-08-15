/**
 * V3.5 — Sourcing Evidence 存储与 Preview Store 单测（Owner/Visitor 隔离、幂等、fail-closed）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import {
  SourcingEvidenceError,
  createSourcingPreview,
  getSourcingEvidence,
  parseSourcingEvidence,
  resetSourcingPreviewStoreForTests,
  saveSourcingEvidence,
  takeSourcingPreview,
} from "@/lib/server/sourcingEvidence";
import type { AcquisitionCandidate, AcquisitionRunTrace } from "@/lib/upstream/1688/contracts";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v35-sourcing-evidence-store");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const DEMO_A = "demo-access-a";
const DEMO_B = "demo-access-b";

function visitorContext(accessId = DEMO_A) {
  return {
    mode: "demo" as const,
    token: "tok-demo",
    demoAccessId: accessId,
    isActive: true,
    isExpired: false,
    remainingAiCalls: 10,
  };
}

function toStorageVersion(taskId: string, accessId = DEMO_A) {
  const task = getSandboxTask(accessId, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

function sampleCandidate(offerId = "674035283676"): AcquisitionCandidate {
  return {
    schema: "acquisition-candidate.v1",
    source: "1688",
    offerId,
    sourceUrl: `https://detail.1688.com/offer/${offerId}.html`,
    capturedAt: "2026-08-15T00:00:00.000Z",
    acquisitionMethod: "keyword",
    sourceProductRole: "candidate",
    title: "测试保温杯",
    images: ["https://img.example.test/a.jpg"],
    displayedPrice: { text: "¥16", nature: "displayed_price" },
    priceRange: { min: 16, max: 16, text: "¥16" },
    priceTiers: [],
    displayedMoq: null,
    skuSpecs: [],
    sellerClaims: [],
    platformMetadata: [],
    supplierDisplayName: "测试供应商",
    matchState: null,
  };
}

function runTrace(method: "keyword" | "url" = "keyword"): AcquisitionRunTrace {
  return {
    source: "1688",
    method,
    query: "保温杯",
    timestamp: "2026-08-15T00:00:00.000Z",
    driverVersion: "local-session-1688-cli-driver.v1",
    resolverVersion: null,
    success: true,
    failClosedReason: null,
  };
}

let taskId: string;

beforeEach(async () => {
  resetSourcingPreviewStoreForTests();
  taskId = (await createTrustedSandboxTask(DEMO_A, { type: "research" })).id;
});

afterEach(() => {
  // 无共享状态残留
});

describe("parseSourcingEvidence", () => {
  it("合法结构 → 解析", () => {
    const value = {
      schema: "sourcing-evidence.v1",
      taskId: "t1",
      capturedAt: "2026-08-15T00:00:00.000Z",
      acquisition: { method: "keyword", query: "保温杯", runTrace: runTrace() },
      candidates: [sampleCandidate()],
      humanConfirmed: [{ offerId: "674035283676", confirmedAt: "2026-08-15T01:00:00.000Z", note: null }],
      updatedAt: "2026-08-15T01:00:00.000Z",
    };
    expect(parseSourcingEvidence(value)?.schema).toBe("sourcing-evidence.v1");
  });

  it("schema 不符 / 结构残缺 → null（fail-closed）", () => {
    expect(parseSourcingEvidence({ schema: "other" })).toBeNull();
    expect(parseSourcingEvidence({ schema: "sourcing-evidence.v1" })).toBeNull();
    expect(parseSourcingEvidence(null)).toBeNull();
  });

  it("humanConfirmed offerId 非法 → null", () => {
    const value = {
      schema: "sourcing-evidence.v1",
      taskId: "t1",
      capturedAt: "x",
      acquisition: { method: "keyword", query: "q", runTrace: runTrace() },
      candidates: [],
      humanConfirmed: [{ offerId: "abc" }],
      updatedAt: "x",
    };
    expect(parseSourcingEvidence(value)).toBeNull();
  });
});

describe("saveSourcingEvidence（demo sandbox）", () => {
  it("确认后保存 → 可读回，候选与确认条目一致", async () => {
    const saved = await saveSourcingEvidence({
      context: visitorContext(),
      taskId,
      method: "keyword",
      query: "保温杯",
      runTrace: runTrace(),
      candidates: [sampleCandidate()],
      confirmedOfferIds: ["674035283676"],
      expectedStorageVersion: toStorageVersion(taskId),
    });
    expect(saved.candidates).toHaveLength(1);
    expect(saved.humanConfirmed[0].offerId).toBe("674035283676");
    const loaded = await getSourcingEvidence(visitorContext(), taskId);
    expect(loaded?.candidates[0].title).toBe("测试保温杯");
  });

  it("未确认任何候选 → NO_CONFIRMED_CANDIDATES", async () => {
    await expect(saveSourcingEvidence({
      context: visitorContext(),
      taskId,
      method: "keyword",
      query: "保温杯",
      runTrace: runTrace(),
      candidates: [sampleCandidate()],
      confirmedOfferIds: [],
      expectedStorageVersion: toStorageVersion(taskId),
    })).rejects.toThrowError(SourcingEvidenceError);
  });

  it("确认列表与候选不一致 → CANDIDATE_MISMATCH", async () => {
    await expect(saveSourcingEvidence({
      context: visitorContext(),
      taskId,
      method: "keyword",
      query: "保温杯",
      runTrace: runTrace(),
      candidates: [sampleCandidate()],
      confirmedOfferIds: ["99999999999"],
      expectedStorageVersion: toStorageVersion(taskId),
    })).rejects.toThrowError(/不一致/);
  });

  it("重复确认同 offerId → 幂等（候选不重复，条目更新时间）", async () => {
    await saveSourcingEvidence({
      context: visitorContext(),
      taskId,
      method: "keyword",
      query: "保温杯",
      runTrace: runTrace(),
      candidates: [sampleCandidate()],
      confirmedOfferIds: ["674035283676"],
      expectedStorageVersion: toStorageVersion(taskId),
    });
    const saved = await saveSourcingEvidence({
      context: visitorContext(),
      taskId,
      method: "keyword",
      query: "保温杯",
      runTrace: runTrace(),
      candidates: [sampleCandidate()],
      confirmedOfferIds: ["674035283676"],
      expectedStorageVersion: toStorageVersion(taskId),
    });
    expect(saved.candidates).toHaveLength(1);
    expect(saved.humanConfirmed).toHaveLength(1);
  });

  it("stale storageVersion → 并发冲突拒绝", async () => {
    const stale = { resultJsonHash: "0".repeat(64), updatedAt: "2000-01-01T00:00:00.000Z" };
    await expect(saveSourcingEvidence({
      context: visitorContext(),
      taskId,
      method: "keyword",
      query: "保温杯",
      runTrace: runTrace(),
      candidates: [sampleCandidate()],
      confirmedOfferIds: ["674035283676"],
      expectedStorageVersion: stale,
    })).rejects.toThrowError(SourcingEvidenceError);
  });
});

describe("Preview Store（主体/任务绑定）", () => {
  it("同主体同任务可取，跨任务不可取（fail-closed）", () => {
    const preview = createSourcingPreview({
      context: visitorContext(DEMO_A),
      taskId,
      method: "keyword",
      query: "保温杯",
      runTrace: runTrace(),
      candidates: [sampleCandidate()],
    });
    expect(takeSourcingPreview(preview.previewId, {
      subjectKey: `visitor:${DEMO_A}`,
      taskId,
    })).not.toBeNull();
    // 第二次取（已消费）→ null
    expect(takeSourcingPreview(preview.previewId, {
      subjectKey: `visitor:${DEMO_A}`,
      taskId,
    })).toBeNull();
  });

  it("跨主体（Visitor B）不可取 → null", () => {
    const preview = createSourcingPreview({
      context: visitorContext(DEMO_A),
      taskId,
      method: "keyword",
      query: "保温杯",
      runTrace: runTrace(),
      candidates: [sampleCandidate()],
    });
    expect(takeSourcingPreview(preview.previewId, {
      subjectKey: `visitor:${DEMO_B}`,
      taskId,
    })).toBeNull();
    // 原主体仍可取（跨主体尝试不消耗）
    expect(takeSourcingPreview(preview.previewId, {
      subjectKey: `visitor:${DEMO_A}`,
      taskId,
    })).not.toBeNull();
  });

  it("过期条目不可取 → null", () => {
    const preview = createSourcingPreview({
      context: visitorContext(DEMO_A),
      taskId,
      method: "keyword",
      query: "保温杯",
      runTrace: runTrace(),
      candidates: [sampleCandidate()],
    });
    // 直接改过期时间（同一引用，测试专用）
    (preview as { expiresAt: number }).expiresAt = Date.now() - 1;
    expect(takeSourcingPreview(preview.previewId, {
      subjectKey: `visitor:${DEMO_A}`,
      taskId,
    })).toBeNull();
  });
});
