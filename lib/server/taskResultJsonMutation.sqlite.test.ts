import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  appendProductResearchDecision,
  buildProductResearchHash,
  createInitialProductResearchRecord,
  createProductResearchVerification,
} from "@/lib/productResearchRecord";
import {
  commitOwnerTaskResultJsonMutation,
  loadOwnerTaskResultJsonSnapshot,
  mutateOwnerTaskResultJsonForTest,
  type TaskResultJsonDatabase,
} from "@/lib/server/taskResultJsonMutation";

let root = "";
let first: PrismaClient;
let second: PrismaClient;

function database(client: PrismaClient) {
  return client as unknown as TaskResultJsonDatabase;
}

function protectedDocument() {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId: "candidate-sqlite",
    runId: "workflow-run-sqlite",
    contextHash: "a".repeat(64),
    inputHash: "b".repeat(64),
    resultHash: "c".repeat(64),
    workflowStatus: "completed",
    reviewState: {
      sourcingReviewed: true,
      riskReviewed: true,
      summaryReviewed: true,
      listingReviewed: true,
      reviewedCount: 4,
      totalReviewSteps: 4,
      allReviewed: true,
    },
  });
  const researchRecord = createInitialProductResearchRecord({
    candidateId: verification.candidateId,
    runId: verification.runId,
    contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: "2026-08-03T00:00:00.000Z",
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: "creative_ready",
      reason: "Initial evidence reviewed.",
      nextAction: "Wait for an explicit handoff.",
    },
  });
  return {
    type: "workflow",
    researchRecord,
    researchVerification: verification,
    unknownNamespace: { keep: true },
    productLifecycle: { state: "investigating" },
  };
}

function decisionResult(current: ReturnType<typeof protectedDocument>, input: {
  id: string;
  status: "needs_information" | "abandoned";
  reason: string;
  nextAction: string | null;
  now: string;
}) {
  const appended = appendProductResearchDecision({
    record: current.researchRecord,
    expectedRevision: 1,
    workflowStatus: current.researchVerification.workflowStatus,
    reviewState: current.researchVerification.reviewState,
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: input.now,
    decision: {
      decisionId: input.id,
      status: input.status,
      reason: input.reason,
      nextAction: input.nextAction,
    },
  });
  return JSON.stringify({ ...current, researchRecord: appended.record });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "product-research-cas-"));
  const databasePath = join(root, "cas.db").replaceAll("\\", "/");
  const url = `file:${databasePath}`;
  first = new PrismaClient({ datasources: { db: { url } } });
  second = new PrismaClient({ datasources: { db: { url } } });
  await first.$executeRawUnsafe(`
    CREATE TABLE "ViralAnalysisRecord" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "createdAt" DATETIME NOT NULL,
      "updatedAt" DATETIME NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'viral',
      "decisionStatus" TEXT NOT NULL DEFAULT 'pending',
      "title" TEXT,
      "platform" TEXT NOT NULL,
      "productUrl" TEXT,
      "materialText" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      "score" INTEGER NOT NULL,
      "level" TEXT NOT NULL,
      "oneLineSummary" TEXT NOT NULL,
      "resultJson" TEXT NOT NULL
    )
  `);
  const document = protectedDocument();
  await first.viralAnalysisRecord.create({
    data: {
      id: "task-sqlite",
      createdAt: new Date("2026-08-03T00:00:00.000Z"),
      updatedAt: new Date("2026-08-03T00:00:00.000Z"),
      type: "workflow",
      decisionStatus: "continue",
      title: "Synthetic",
      platform: "local-test",
      materialText: "Synthetic",
      source: "isolated-test",
      score: 0,
      level: "low",
      oneLineSummary: "Synthetic",
      resultJson: JSON.stringify(document),
    },
  });
  await first.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
  await second.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
});

afterEach(async () => {
  await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
  rmSync(root, { recursive: true, force: true });
});

describe("real SQLite task resultJson CAS", () => {
  it("allows exactly one of two concurrent decisions from the same storage snapshot", async () => {
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const runDecision = (
      client: PrismaClient,
      input: { id: string; status: "needs_information" | "abandoned"; reason: string; nextAction: string | null; now: string },
    ) => mutateOwnerTaskResultJsonForTest(database(client), {
      taskId: "task-sqlite",
      writer: "research-decision",
      mutate: async (document) => {
        arrivals += 1;
        if (arrivals === 2) release();
        await barrier;
        const current = document as ReturnType<typeof protectedDocument>;
        const resultJson = decisionResult(current, input);
        return {
          result: JSON.parse(resultJson),
          value: null,
          decisionStatus: input.status === "abandoned" ? "rejected" : "need_info",
          updatedAt: input.now,
        };
      },
    });
    const settled = await Promise.allSettled([
      runDecision(first, {
        id: "22222222-2222-4222-8222-222222222222",
        status: "needs_information",
        reason: "Need another source.",
        nextAction: "Collect it.",
        now: "2026-08-03T01:00:00.000Z",
      }),
      runDecision(second, {
        id: "33333333-3333-4333-8333-333333333333",
        status: "abandoned",
        reason: "Stop this research.",
        nextAction: null,
        now: "2026-08-03T01:00:01.000Z",
      }),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "task_result_conflict", status: 409 } });
    const saved = await first.viralAnalysisRecord.findUnique({ where: { id: "task-sqlite" } });
    const parsed = JSON.parse(saved!.resultJson);
    expect(parsed.researchRecord.revision).toBe(2);
    expect(parsed.researchRecord.decisionEvents).toHaveLength(2);
    expect(saved!.decisionStatus).toBe(parsed.researchRecord.latestDecision.status === "abandoned" ? "rejected" : "need_info");
  });

  it("never loses a decision when it races lifecycle or Listing, and merges safely on a fresh retry", async () => {
    const decisionSnapshot = await loadOwnerTaskResultJsonSnapshot(database(first), "task-sqlite");
    const lifecycleSnapshot = await loadOwnerTaskResultJsonSnapshot(database(second), "task-sqlite");
    const current = protectedDocument();
    const decisionJson = decisionResult(current, {
      id: "44444444-4444-4444-8444-444444444444",
      status: "needs_information",
      reason: "Need another source.",
      nextAction: "Collect it.",
      now: "2026-08-03T02:00:00.000Z",
    });
    const lifecycleJson = JSON.stringify({ ...current, productLifecycle: { state: "paused" } });
    const results = await Promise.all([
      commitOwnerTaskResultJsonMutation(database(first), {
        snapshot: decisionSnapshot!,
        resultJson: decisionJson,
        decisionStatus: "need_info",
        updatedAt: "2026-08-03T02:00:00.000Z",
      }),
      commitOwnerTaskResultJsonMutation(database(second), {
        snapshot: lifecycleSnapshot!,
        resultJson: lifecycleJson,
        updatedAt: "2026-08-03T02:00:01.000Z",
      }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);

    await mutateOwnerTaskResultJsonForTest(database(second), {
      taskId: "task-sqlite",
      writer: "listing-pack",
      mutate: (document) => ({
        result: { ...document, listingPackSnapshot: { source: "synthetic" } },
        value: null,
        updatedAt: "2026-08-03T02:00:02.000Z",
      }),
    });
    await mutateOwnerTaskResultJsonForTest(database(first), {
      taskId: "task-sqlite",
      writer: "lifecycle",
      mutate: (document) => ({
        result: { ...document, productLifecycle: { state: "ready" } },
        value: null,
        updatedAt: "2026-08-03T02:00:03.000Z",
      }),
    });
    const saved = await first.viralAnalysisRecord.findUnique({ where: { id: "task-sqlite" } });
    const parsed = JSON.parse(saved!.resultJson);
    expect(parsed.listingPackSnapshot).toEqual({ source: "synthetic" });
    expect(parsed.productLifecycle).toEqual({ state: "ready" });
    expect(parsed.unknownNamespace).toEqual({ keep: true });
    expect(parsed.researchRecord.decisionEvents).toHaveLength(results[0] ? 2 : 1);
  });

  it("fails stale CAS when either updatedAt or resultJson changed", async () => {
    const original = await loadOwnerTaskResultJsonSnapshot(database(first), "task-sqlite");
    await first.viralAnalysisRecord.update({
      where: { id: "task-sqlite" },
      data: { updatedAt: new Date("2026-08-03T03:00:00.000Z") },
    });
    expect(await commitOwnerTaskResultJsonMutation(database(second), {
      snapshot: original!,
      resultJson: original!.resultJson,
      updatedAt: "2026-08-03T03:00:01.000Z",
    })).toBe(false);

    const current = await loadOwnerTaskResultJsonSnapshot(database(first), "task-sqlite");
    const changed = JSON.stringify({ ...JSON.parse(current!.resultJson), externalNamespace: { changed: true } });
    await first.viralAnalysisRecord.update({
      where: { id: "task-sqlite" },
      data: { resultJson: changed, updatedAt: current!.updatedAt as Date },
    });
    expect(await commitOwnerTaskResultJsonMutation(database(second), {
      snapshot: current!,
      resultJson: current!.resultJson,
      updatedAt: "2026-08-03T03:00:02.000Z",
    })).toBe(false);
  });
});
