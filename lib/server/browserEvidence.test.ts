import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import {
  BrowserEvidenceError,
  BROWSER_EVIDENCE_SNAPSHOT_LIMIT,
  buildBrowserEvidenceSnapshot,
  parseBrowserEvidence,
  readBrowserEvidence,
  saveBrowserEvidence,
  type BrowserEvidenceSnapshot,
} from "@/lib/server/browserEvidence";
import type { AmazonDetailPageExtraction } from "@/tools/collectors/amazon/detail-page-extract";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "browser-evidence-store");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const NOW = "2026-08-05T00:00:00.000Z";
const DEMO_A = "demo-access-a";
const TARGET_ASIN = "B0A1B2C3D4";

function visitorContext(demoAccessId = DEMO_A) {
  return {
    mode: "demo" as const,
    token: `tok-${demoAccessId}`,
    demoAccessId,
    isActive: true,
    isExpired: false,
    remainingAiCalls: 10,
  };
}

function toStorageVersion(taskId: string, context = visitorContext()) {
  const task = getSandboxTask(context.demoAccessId, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

function extraction(overrides: Partial<AmazonDetailPageExtraction> = {}): AmazonDetailPageExtraction {
  return {
    schemaVersion: "amazon-detail-page-extraction.v1",
    expectedAsin: TARGET_ASIN,
    urlAsin: TARGET_ASIN,
    pageAsin: TARGET_ASIN,
    entityBound: true,
    bindingProof: {
      urlMatchesExpected: true,
      pageAnchorMatchesExpected: true,
      productContainerFound: true,
    },
    pageStatus: "ok",
    fields: {
      asin: { field: "asin", value: TARGET_ASIN, status: "correct", reason: null },
      title: { field: "title", value: "John Boos Walnut Cutting Board", status: "correct", reason: null },
      price: { field: "price", value: 48.95, status: "correct", reason: null },
      bsr: { field: "bsr", value: 2541, status: "correct", reason: null },
      rating: { field: "rating", value: 4.2, status: "correct", reason: null },
      reviews: { field: "reviews", value: 4958, status: "correct", reason: null },
    },
    capturedAt: NOW,
    collectorVersion: "amazon-detail-page-extractor.v1",
    ...overrides,
  };
}

function buildSnapshot(overrides: {
  capturedAt?: string;
  extraction?: AmazonDetailPageExtraction;
} = {}) {
  return buildBrowserEvidenceSnapshot({
    extraction: overrides.extraction ?? extraction(),
    targetAsin: TARGET_ASIN,
    pageUrl: `https://www.amazon.com/dp/${TARGET_ASIN}`,
    locale: "en_US",
    collectorVersion: "amazon-detail-page-extractor.v1",
    capturedAt: overrides.capturedAt ?? NOW,
    confirmedBy: { mode: "visitor", actorRef: `visitor:${DEMO_A}` },
  });
}

let taskId: string;
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "browser-evidence-"));
  const task = await createTrustedSandboxTask(
    DEMO_A,
    {
      type: "workflow",
      title: "Browser Evidence Test",
      platform: "amazon",
      productUrl: null,
      materialText: "",
      source: "demo",
      score: 0,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify({
        sourceMeta: { source: "opportunity", candidateId: "candidate-browser-evidence" },
        candidateToTask: { version: 1, candidateId: "candidate-browser-evidence" },
      }),
      productLifecycle: "new_candidate",
      decisionStatus: "pending",
      createdAt: NOW,
      updatedAt: NOW,
    } as Parameters<typeof createTrustedSandboxTask>[1],
  );
  taskId = task.id;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("browserEvidence schema (parse)", () => {
  it("parses a fully-formed namespace round-trip", () => {
    const snapshot = buildSnapshot();
    const evidence = {
      schema: "browser-evidence.v1",
      version: 1,
      candidateId: "candidate-browser-evidence",
      targetAsin: TARGET_ASIN,
      snapshots: [snapshot],
      updatedAt: NOW,
    };
    const parsed = parseBrowserEvidence(evidence);
    expect(parsed).not.toBeNull();
    expect(parsed!.snapshots).toHaveLength(1);
    expect(parsed!.snapshots[0].fields).toMatchObject({
      asin: { value: TARGET_ASIN, status: "correct", nature: "snapshot" },
      title: { value: "John Boos Walnut Cutting Board", status: "correct" },
      price: { value: 48.95, status: "correct" },
      bsr: { value: 2541, status: "correct" },
      rating: { value: 4.2, status: "correct" },
      reviewCount: { value: 4958, status: "correct" },
    });
  });

  it("rejects wrong schema/version and malformed snapshots", () => {
    expect(parseBrowserEvidence({ schema: "browser-evidence.v2", version: 1, snapshots: [] })).toBeNull();
    expect(parseBrowserEvidence({ schema: "browser-evidence.v1", version: 2, snapshots: [] })).toBeNull();
    expect(parseBrowserEvidence(null)).toBeNull();
    const snapshot = buildSnapshot();
    expect(parseBrowserEvidence({ schema: "browser-evidence.v1", version: 1, snapshots: [{ ...snapshot, sourceType: "xlsx" }] })).toBeNull();
    expect(parseBrowserEvidence({ schema: "browser-evidence.v1", version: 1, snapshots: [{ ...snapshot, fields: { ...snapshot.fields, price: { ...snapshot.fields.price, nature: "fact" } } }] })).toBeNull();
  });

  it("rejects a correct field with a null value and non-numeric numbers", () => {
    const snapshot = buildSnapshot();
    const bad = {
      ...snapshot,
      fields: { ...snapshot.fields, price: { ...snapshot.fields.price, value: null } },
    };
    expect(parseBrowserEvidence({ schema: "browser-evidence.v1", version: 1, snapshots: [bad] })).toBeNull();
    const nonNumeric = {
      ...snapshot,
      fields: { ...snapshot.fields, rating: { ...snapshot.fields.rating, value: "4.2" } },
    };
    expect(parseBrowserEvidence({ schema: "browser-evidence.v1", version: 1, snapshots: [nonNumeric] })).toBeNull();
  });

  it("rejects snapshots beyond the 20 limit", () => {
    const snapshots = Array.from({ length: BROWSER_EVIDENCE_SNAPSHOT_LIMIT + 1 }, () => buildSnapshot());
    expect(parseBrowserEvidence({ schema: "browser-evidence.v1", version: 1, snapshots })).toBeNull();
  });
});

describe("browserEvidence build (extraction → snapshot)", () => {
  it("maps 6 fields, currency USD, binding and failure reasons", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.sourceType).toBe("browser");
    expect(snapshot.sourceSite).toBe("amazon");
    expect(snapshot.currency).toBe("USD");
    expect(snapshot.locale).toBe("en_US");
    expect(snapshot.entityBinding).toMatchObject({ bound: true, urlAsin: TARGET_ASIN, pageAsin: TARGET_ASIN });
    expect(snapshot.failureReasons).toEqual([]);
    expect(snapshot.confirmedBy).toEqual({ mode: "visitor", actorRef: `visitor:${DEMO_A}` });
  });
  // V3 Final PHASE 1：productInfo 规格行
  it("build: 带 productInfo 快照（entityBound 前提；rows 有界）", () => {
    const snapshot = buildSnapshot({
      extraction: extraction(),
    });
    const withInfo = {
      ...snapshot,
      productInfo: {
        schemaVersion: "amazon-product-info-extraction.v1",
        rows: [
          { label: "Material Type", value: "Wood", sourceSection: "productDetails_depthRightSections" },
          { label: "Item Weight", value: "16 ounces", sourceSection: "productDetails_depthRightSections" },
        ],
        canonicalFacts: { material: "Wood", weight: "16 ounces" },
        capturedAt: NOW,
        collectorVersion: "amazon-detail-page-extractor.v1",
      },
    };
    const parsed = parseBrowserEvidence({
      schema: "browser-evidence.v1",
      version: 1,
      candidateId: "candidate-browser-evidence",
      targetAsin: TARGET_ASIN,
      snapshots: [withInfo],
      updatedAt: NOW,
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.snapshots[0].productInfo?.canonicalFacts.material).toBe("Wood");
    expect(parsed!.snapshots[0].productInfo?.rows).toHaveLength(2);
  });

  it("parse fail-soft: 非法 productInfo（非法来源区/非法 schema/超行数）→ 快照整体忽略", () => {
    const base = buildSnapshot();
    const badSection = parseBrowserEvidence({
      schema: "browser-evidence.v1",
      version: 1,
      candidateId: "candidate-browser-evidence",
      targetAsin: TARGET_ASIN,
      snapshots: [{
        ...base,
        productInfo: {
          schemaVersion: "amazon-product-info-extraction.v1",
          rows: [{ label: "x", value: "y", sourceSection: "sponsored_feature_div" }],
          canonicalFacts: {},
          capturedAt: NOW,
          collectorVersion: "v",
        },
      }],
      updatedAt: NOW,
    });
    expect(badSection).toBeNull();
    const badSchema = parseBrowserEvidence({
      schema: "browser-evidence.v1",
      version: 1,
      candidateId: "candidate-browser-evidence",
      targetAsin: TARGET_ASIN,
      snapshots: [{
        ...base,
        productInfo: { schemaVersion: "other.v1", rows: [], canonicalFacts: {}, capturedAt: NOW, collectorVersion: "v" },
      }],
      updatedAt: NOW,
    });
    expect(badSchema).toBeNull();
  });
  it("flags JPY currency as unknown price with currency_not_usd reason", () => {
    const jpy = extraction({
      fields: {
        ...extraction().fields,
        price: { field: "price", value: null, status: "unknown", reason: "currency_not_usd:JPY" },
      },
    });
    const snapshot = buildSnapshot({ extraction: jpy });
    expect(snapshot.currency).toBe("JPY");
    expect(snapshot.fields.price).toMatchObject({ value: null, status: "unknown" });
    expect(snapshot.failureReasons).toContain("currency_not_usd:JPY");
  });

  it("keeps unbound extractions as unknown with binding reasons", () => {
    const base = extraction();
    const unbound = extraction({
      entityBound: false,
      pageAsin: null,
      fields: Object.fromEntries(
        Object.entries(base.fields).map(([key, value]) => [
          key,
          { ...value, value: null, status: "unknown", reason: "entity_binding_unproven" },
        ]),
      ) as AmazonDetailPageExtraction["fields"],
    });
    const snapshot = buildSnapshot({ extraction: unbound });
    expect(snapshot.entityBinding.bound).toBe(false);
    expect(Object.values(snapshot.fields).every((field) => field.status === "unknown")).toBe(true);
    expect(snapshot.failureReasons.length).toBeGreaterThan(0);
  });
});

describe("browserEvidence read/write (visitor sandbox)", () => {
  it("reads null when namespace is absent", async () => {
    const context = visitorContext();
    expect(await readBrowserEvidence(context, taskId)).toBeNull();
  });

  it("read fail-soft: garbage/unknown old browserEvidence value is safely ignored", async () => {
    const context = visitorContext();
    // 直接在 sandbox task 注入坏值（模拟旧记录/被污染数据）
    const corrupted = await createTrustedSandboxTask(
      DEMO_A,
      {
        type: "workflow",
        title: "Corrupted",
        platform: "amazon",
        productUrl: null,
        materialText: "",
        source: "demo",
        score: 0,
        level: "low",
        oneLineSummary: "",
        resultJson: JSON.stringify({ browserEvidence: "garbage-not-an-object" }),
        productLifecycle: "new_candidate",
        decisionStatus: "pending",
        createdAt: NOW,
        updatedAt: NOW,
      } as Parameters<typeof createTrustedSandboxTask>[1],
    );
    // 读取必须 fail-soft：不抛错、返回 null（安全忽略）
    const read = await readBrowserEvidence(context, corrupted.id);
    expect(read).toBeNull();
  });

  it("write fail-closed: a snapshot with a 7th field is rejected, never auto-cleaned", async () => {
    const context = visitorContext();
    const snapshot = buildSnapshot() as BrowserEvidenceSnapshot & { fields: Record<string, unknown> };
    // 超白名单：塞入第 7 个字段（如 coupon）
    snapshot.fields = { ...snapshot.fields, coupon: { value: "SAVE10", status: "correct", reason: null, nature: "snapshot" } };
    await expect(
      saveBrowserEvidence({ context, taskId, expectedStorageVersion: toStorageVersion(taskId), snapshot: snapshot as BrowserEvidenceSnapshot }),
    ).rejects.toMatchObject({ code: "invalid_snapshot", status: 422 });
    // 未落库
    expect(await readBrowserEvidence(context, taskId)).toBeNull();
  });

  it("write fail-closed: missing binding proof is rejected", async () => {
    const context = visitorContext();
    const snapshot = buildSnapshot();
    const broken = {
      ...snapshot,
      entityBinding: { ...snapshot.entityBinding, proof: { urlMatchesExpected: false, pageAnchorMatchesExpected: false, productContainerFound: false } },
    };
    await expect(
      saveBrowserEvidence({ context, taskId, expectedStorageVersion: toStorageVersion(taskId), snapshot: broken }),
    ).rejects.toMatchObject({ code: "invalid_snapshot", status: 422 });
  });

  it("write fail-closed: oversized snapshot payload is rejected", async () => {
    const context = visitorContext();
    const snapshot = buildSnapshot();
    // 构造超限快照：巨大 pageUrl（16KB+）
    const oversized = {
      ...snapshot,
      pageUrl: `https://www.amazon.com/dp/${TARGET_ASIN}?` + "x".repeat(17 * 1024),
    };
    await expect(
      saveBrowserEvidence({ context, taskId, expectedStorageVersion: toStorageVersion(taskId), snapshot: oversized }),
    ).rejects.toMatchObject({ code: "browser_evidence_payload_too_large", status: 413 });
  });

  it("saves a snapshot and binds candidateId from the authoritative task", async () => {
    const context = visitorContext();
    const snapshot = buildSnapshot();
    const saved = await saveBrowserEvidence({
      context,
      taskId,
      expectedStorageVersion: toStorageVersion(taskId),
      snapshot,
    });
    expect(saved.kind).toBe("saved");
    expect(saved.evidence.candidateId).toBe("candidate-browser-evidence");
    expect(saved.evidence.targetAsin).toBe(TARGET_ASIN);
    expect(saved.evidence.snapshots).toHaveLength(1);

    const reloaded = await readBrowserEvidence(context, taskId);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.snapshots).toHaveLength(1);
    expect(reloaded!.snapshots[0].fields.price.value).toBe(48.95);
  });

  it("dedupes identical capturedAt+pageUrl+asin as duplicate without growing", async () => {
    const context = visitorContext();
    const first = await saveBrowserEvidence({ context, taskId, expectedStorageVersion: toStorageVersion(taskId), snapshot: buildSnapshot() });
    expect(first.kind).toBe("saved");
    const versionAfterFirst = toStorageVersion(taskId);
    const second = await saveBrowserEvidence({ context, taskId, expectedStorageVersion: versionAfterFirst, snapshot: buildSnapshot() });
    expect(second.kind).toBe("duplicate");
    expect(second.evidence.snapshots).toHaveLength(1);
  });

  it("appends a snapshot with a new capturedAt (temporal difference, no overwrite)", async () => {
    const context = visitorContext();
    await saveBrowserEvidence({ context, taskId, expectedStorageVersion: toStorageVersion(taskId), snapshot: buildSnapshot() });
    const later = buildSnapshot({ capturedAt: "2026-08-06T00:00:00.000Z" });
    const result = await saveBrowserEvidence({
      context,
      taskId,
      expectedStorageVersion: toStorageVersion(taskId),
      snapshot: later,
    });
    expect(result.kind).toBe("saved");
    expect(result.evidence.snapshots).toHaveLength(2);
  });

  it("rejects stale storage versions with task_result_conflict", async () => {
    const context = visitorContext();
    const stale = { resultJsonHash: "a".repeat(64), updatedAt: "2000-01-01T00:00:00.000Z" };
    await expect(
      saveBrowserEvidence({ context, taskId, expectedStorageVersion: stale, snapshot: buildSnapshot() }),
    ).rejects.toMatchObject({ code: "task_result_conflict", status: 409 });
  });

  it("rejects non-sandbox task ids for visitors", async () => {
    const context = visitorContext();
    await expect(readBrowserEvidence(context, "cmqtwpu3k0001eurv5pgur70p")).rejects.toBeInstanceOf(BrowserEvidenceError);
  });

  it("enforces the 20-snapshot cap with browser_evidence_snapshot_limit", async () => {
    const context = visitorContext();
    let version = toStorageVersion(taskId);
    // 先写满 20 条（不同 capturedAt 以避开 dedupe）
    for (let index = 0; index < BROWSER_EVIDENCE_SNAPSHOT_LIMIT; index += 1) {
      const saved = await saveBrowserEvidence({
        context,
        taskId,
        expectedStorageVersion: version,
        snapshot: buildSnapshot({
          capturedAt: `2026-08-05T00:${String(index).padStart(2, "0")}:00.000Z`,
        }),
      });
      expect(saved.kind).toBe("saved");
      version = toStorageVersion(taskId);
    }
    // 第 21 条 → 上限错误（合同语义：报错，不静默截断）
    await expect(
      saveBrowserEvidence({
        context,
        taskId,
        expectedStorageVersion: version,
        snapshot: buildSnapshot({ capturedAt: "2026-08-05T01:00:00.000Z" }),
      }),
    ).rejects.toMatchObject({ code: "browser_evidence_snapshot_limit", status: 409 });
    const reloaded = await readBrowserEvidence(context, taskId);
    expect(reloaded!.snapshots).toHaveLength(BROWSER_EVIDENCE_SNAPSHOT_LIMIT);
  });
});
