import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";

const ACCESS_STORE = `${tmpdir()}/demo-product-journey-access-${randomBytes(4).toString("hex")}.json`;
const SANDBOX_STORE = `${tmpdir()}/demo-product-journey-sandbox-${randomBytes(4).toString("hex")}.json`;

beforeAll(() => {
  process.env.DEMO_ACCESS_STORE_PATH = ACCESS_STORE;
  process.env.DEMO_SANDBOX_STORE_PATH = SANDBOX_STORE;
});

afterAll(() => {
  delete process.env.DEMO_ACCESS_STORE_PATH;
  delete process.env.DEMO_SANDBOX_STORE_PATH;
  for (const path of [ACCESS_STORE, SANDBOX_STORE]) {
    try { unlinkSync(path); } catch { /* test store may not have been created */ }
  }
});

import {
  createDemoAccess,
  getDemoAccessById,
  loadDemoAccessStore,
  saveDemoAccessStore,
} from "@/lib/server/demoAccess";
import { replaceDemoSandboxStoreForTest } from "@/lib/server/demoSandbox.testSupport";
import {
  createTrustedSandboxTask,
  getSandboxTask,
  listSandboxTasks,
} from "@/lib/server/demoSandbox";
import {
  MAX_PRODUCT_CHAINS,
  buildProductJourneyIdentity,
  commitDemoProductJourney,
  getDemoProductJourneySnapshot,
  releaseDemoProductJourney,
  reserveDemoProductJourney,
} from "@/lib/server/demoProductJourneyQuota";

function createVisitor(label: string) {
  return createDemoAccess({ label, hours: 24, maxAiCalls: 0 }).record;
}

function candidateIdentity(index: number) {
  return buildProductJourneyIdentity({ candidateId: `sandbox_candidate_${index}`, productName: `Product ${index}` });
}

beforeEach(() => {
  saveDemoAccessStore({ version: 1, accesses: [] });
  replaceDemoSandboxStoreForTest({ version: 1, tasks: [], candidates: [] });
});

describe("Visitor five-product journey quota", () => {
  it("starts every new Visitor with five product journeys independent of legacy AI calls", () => {
    const visitor = createVisitor("new visitor");
    const snapshot = getDemoProductJourneySnapshot(visitor.id);

    expect(MAX_PRODUCT_CHAINS).toBe(5);
    expect(snapshot).toMatchObject({
      quotaMetric: "product_journeys_v1",
      maxProducts: 5,
      usedProducts: 0,
      reservedProducts: 0,
      remainingProducts: 5,
    });
  });

  it("commits the first five distinct products and rejects the sixth before it starts", () => {
    const visitor = createVisitor("five products");

    for (let index = 1; index <= 5; index += 1) {
      const identity = candidateIdentity(index);
      const reserved = reserveDemoProductJourney(visitor.id, identity, `request-${index}`);
      expect(reserved.ok).toBe(true);
      if (!reserved.ok) continue;
      expect(commitDemoProductJourney(visitor.id, identity, `request-${index}`).ok).toBe(true);
    }

    const sixth = reserveDemoProductJourney(visitor.id, candidateIdentity(6), "request-6");
    expect(sixth).toMatchObject({
      ok: false,
      code: "visitor_product_quota_exhausted",
      message: "该访客码的 5 个商品体验名额已全部使用。",
    });
    expect(getDemoProductJourneySnapshot(visitor.id)).toMatchObject({
      usedProducts: 5,
      remainingProducts: 0,
    });
  });

  it("reuses a committed product across refreshes and new request ids without another slot", () => {
    const visitor = createVisitor("same product");
    const identity = candidateIdentity(1);

    expect(reserveDemoProductJourney(visitor.id, identity, "request-a").ok).toBe(true);
    expect(commitDemoProductJourney(visitor.id, identity, "request-a").ok).toBe(true);
    const replay = reserveDemoProductJourney(visitor.id, identity, "request-b");

    expect(replay).toMatchObject({ ok: true, duplicate: true, status: "committed" });
    expect(getDemoProductJourneySnapshot(visitor.id)).toMatchObject({ usedProducts: 1, remainingProducts: 4 });
  });

  it("releases a system failure before establishment and lets the same product retry the slot", () => {
    const visitor = createVisitor("release and retry");
    const identity = candidateIdentity(1);

    expect(reserveDemoProductJourney(visitor.id, identity, "request-a").ok).toBe(true);
    expect(getDemoProductJourneySnapshot(visitor.id)).toMatchObject({ reservedProducts: 1, remainingProducts: 4 });
    expect(releaseDemoProductJourney(visitor.id, identity, "request-a").ok).toBe(true);
    expect(getDemoProductJourneySnapshot(visitor.id)).toMatchObject({ usedProducts: 0, reservedProducts: 0, remainingProducts: 5 });

    const retry = reserveDemoProductJourney(visitor.id, identity, "request-b");
    expect(retry).toMatchObject({ ok: true, duplicate: false, status: "reserved" });
    expect(commitDemoProductJourney(visitor.id, identity, "request-b").ok).toBe(true);
    expect(getDemoProductJourneySnapshot(visitor.id)).toMatchObject({ usedProducts: 1, remainingProducts: 4 });
  });

  it("atomically prevents concurrent distinct requests from exceeding five products", async () => {
    const visitor = createVisitor("concurrency");
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, offset) => Promise.resolve().then(() =>
        reserveDemoProductJourney(
          visitor.id,
          candidateIdentity(offset + 1),
          `concurrent-${offset + 1}`,
        ),
      )),
    );

    expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(5);
    expect(attempts.filter((attempt) => !attempt.ok)).toHaveLength(1);
    expect(getDemoProductJourneySnapshot(visitor.id)).toMatchObject({ reservedProducts: 5, remainingProducts: 0 });
  });

  it("isolates product journeys between different Visitors", () => {
    const visitorA = createVisitor("visitor A");
    const visitorB = createVisitor("visitor B");

    for (let index = 1; index <= 5; index += 1) {
      const identity = candidateIdentity(index);
      reserveDemoProductJourney(visitorA.id, identity, `a-${index}`);
      commitDemoProductJourney(visitorA.id, identity, `a-${index}`);
    }

    expect(getDemoProductJourneySnapshot(visitorA.id).remainingProducts).toBe(0);
    expect(getDemoProductJourneySnapshot(visitorB.id).remainingProducts).toBe(5);
    expect(reserveDemoProductJourney(visitorB.id, candidateIdentity(6), "b-1").ok).toBe(true);
  });

  it("keeps existing research history readable after all five products are committed", async () => {
    const visitor = createVisitor("history after exhaustion");
    const task = await createTrustedSandboxTask(visitor.id, {
      type: "workflow",
      title: "Existing product history",
      resultJson: JSON.stringify({ listingHandoffBinding: {}, imageHandoffBinding: {} }),
    });

    // The persisted legacy task is migrated as one committed product; add four
    // new products to reach the five-product ceiling.
    for (let index = 1; index <= 4; index += 1) {
      const identity = candidateIdentity(index);
      expect(reserveDemoProductJourney(visitor.id, identity, `history-${index}`).ok).toBe(true);
      expect(commitDemoProductJourney(visitor.id, identity, `history-${index}`).ok).toBe(true);
    }

    expect(getDemoProductJourneySnapshot(visitor.id)).toMatchObject({ usedProducts: 5, remainingProducts: 0 });
    expect(listSandboxTasks(visitor.id).map((item) => item.id)).toContain(task.id);
    expect(getSandboxTask(visitor.id, task.id)?.title).toBe("Existing product history");
  });

  it("migrates legacy usage from distinct linked candidate/task chains instead of AI call count", () => {
    const visitor = createVisitor("legacy visitor");
    const accessStore = loadDemoAccessStore();
    accessStore.accesses[0].usedAiCalls = 4;
    saveDemoAccessStore(accessStore);
    replaceDemoSandboxStoreForTest({
      version: 1,
      candidates: [1, 2].map((index) => ({
        id: `sandbox_candidate_${index}`,
        demoAccessId: visitor.id,
        name: `Legacy Product ${index}`,
        rawInput: "",
        link: null,
        score: 80,
        source: "legacy",
        keyword: "",
        riskLevel: "yellow",
        riskLabel: "",
        summaryLabel: "",
        status: "selected",
        sourceMetaJson: "{}",
        analysisJson: "{}",
        createdAt: "2026-01-01T00:00:00.000Z",
        convertedTaskId: `sandbox_task_${index}`,
      })),
      tasks: [1, 2].map((index) => ({
        id: `sandbox_task_${index}`,
        demoAccessId: visitor.id,
        type: "workflow",
        title: `Legacy Product ${index}`,
        decisionStatus: "need_info",
        platform: "manual",
        productUrl: null,
        materialText: "",
        source: "legacy",
        score: 80,
        level: "yellow",
        oneLineSummary: "",
        resultJson: JSON.stringify({ candidateToTask: { candidateId: `sandbox_candidate_${index}` } }),
        productLifecycle: "{}",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
    });

    expect(getDemoAccessById(visitor.id)?.usedAiCalls).toBe(4);
    expect(getDemoProductJourneySnapshot(visitor.id)).toMatchObject({
      usedProducts: 2,
      remainingProducts: 3,
      migrationStatus: "migrated",
    });
  });

  it("keeps legacy active Visitors usable even when their old expiresAt is in the past", () => {
    const visitor = createVisitor("expired legacy visitor");
    const store = loadDemoAccessStore();
    store.accesses[0].expiresAt = "2020-01-01T00:00:00.000Z";
    saveDemoAccessStore(store);

    expect(getDemoProductJourneySnapshot(visitor.id)).toMatchObject({ remainingProducts: 5 });
    expect(reserveDemoProductJourney(visitor.id, candidateIdentity(1), "request-after-expiry").ok).toBe(true);
  });
});
