import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
let databasePath = "";
let first: PrismaClient | undefined;
let second: PrismaClient | undefined;

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
  databasePath = join(root, "cas.db");
  const schemaPath = join(root, "schema.prisma");
  copyFileSync(join(process.cwd(), "prisma", "schema.prisma"), schemaPath);
  const url = "file:./cas.db";
  execFileSync(process.execPath, [
    join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
    "db", "push", "--skip-generate", "--schema", schemaPath,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url, DEBUG: "prisma:*", RUST_LOG: "info" },
    stdio: "pipe",
  });
  const absoluteUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  first = new PrismaClient({ datasources: { db: { url: absoluteUrl } } });
  second = new PrismaClient({ datasources: { db: { url: absoluteUrl } } });
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
  await Promise.allSettled([
    first?.$disconnect() ?? Promise.resolve(),
    second?.$disconnect() ?? Promise.resolve(),
  ]);
  rmSync(root, { recursive: true, force: true });
  for (const path of [databasePath, `${databasePath}-journal`, `${databasePath}-wal`, `${databasePath}-shm`]) {
    expect(existsSync(path)).toBe(false);
  }
  expect(existsSync(root)).toBe(false);
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
      runDecision(first!, {
        id: "22222222-2222-4222-8222-222222222222",
        status: "needs_information",
        reason: "Need another source.",
        nextAction: "Collect it.",
        now: "2026-08-03T01:00:00.000Z",
      }),
      runDecision(second!, {
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
    const saved = await first!.viralAnalysisRecord.findUnique({ where: { id: "task-sqlite" } });
    const parsed = JSON.parse(saved!.resultJson);
    expect(parsed.researchRecord.revision).toBe(2);
    expect(parsed.researchRecord.decisionEvents).toHaveLength(2);
    expect(saved!.decisionStatus).toBe(parsed.researchRecord.latestDecision.status === "abandoned" ? "rejected" : "need_info");
  });

  it("preserves the decision and Listing namespaces across a real concurrent race and retry", async () => {
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolveBarrier) => { release = resolveBarrier; });
    const decision = () => mutateOwnerTaskResultJsonForTest(database(first!), {
      taskId: "task-sqlite",
      writer: "research-decision",
      mutate: async (document) => {
        arrivals += 1;
        if (arrivals === 2) release();
        await barrier;
        const current = document as ReturnType<typeof protectedDocument>;
        return {
          result: JSON.parse(decisionResult(current, {
            id: "44444444-4444-4444-8444-444444444444",
            status: "needs_information",
            reason: "Need another source.",
            nextAction: "Collect it.",
            now: "2026-08-03T02:00:00.000Z",
          })),
          value: null,
          decisionStatus: "need_info",
          updatedAt: "2026-08-03T02:00:00.000Z",
        };
      },
    });
    const listing = () => mutateOwnerTaskResultJsonForTest(database(second!), {
      taskId: "task-sqlite",
      writer: "listing-pack",
      mutate: async (document) => {
        arrivals += 1;
        if (arrivals === 2) release();
        await barrier;
        return {
          result: { ...document, listingPackSnapshot: { source: "synthetic" } },
          value: null,
          updatedAt: "2026-08-03T02:00:01.000Z",
        };
      },
    });
    const settled = await Promise.allSettled([decision(), listing()]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    if (settled[0].status === "rejected") {
      arrivals = 2;
      await decision();
    } else {
      arrivals = 2;
      await listing();
    }
    const saved = await first!.viralAnalysisRecord.findUnique({ where: { id: "task-sqlite" } });
    const parsed = JSON.parse(saved!.resultJson);
    expect(parsed.listingPackSnapshot).toEqual({ source: "synthetic" });
    expect(parsed.unknownNamespace).toEqual({ keep: true });
    expect(parsed.researchRecord.revision).toBe(2);
    expect(parsed.researchRecord.decisionEvents).toHaveLength(2);
    expect(saved!.decisionStatus).toBe("need_info");
  });

  it("preserves Listing, Image, research, and unknown namespaces across a real concurrent race and retry", async () => {
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolveBarrier) => { release = resolveBarrier; });
    const run = (
      client: PrismaClient,
      writer: "listing-pack" | "ai-image",
      key: "listingPackSnapshot" | "aiImageDraftSnapshot",
      at: string,
    ) => mutateOwnerTaskResultJsonForTest(database(client), {
      taskId: "task-sqlite",
      writer,
      mutate: async (document) => {
        arrivals += 1;
        if (arrivals === 2) release();
        await barrier;
        return { result: { ...document, [key]: { source: "synthetic" } }, value: null, updatedAt: at };
      },
    });
    const settled = await Promise.allSettled([
      run(first!, "listing-pack", "listingPackSnapshot", "2026-08-03T02:10:00.000Z"),
      run(second!, "ai-image", "aiImageDraftSnapshot", "2026-08-03T02:10:01.000Z"),
    ]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    arrivals = 2;
    if (settled[0].status === "rejected") {
      await run(first!, "listing-pack", "listingPackSnapshot", "2026-08-03T02:10:02.000Z");
    } else {
      await run(second!, "ai-image", "aiImageDraftSnapshot", "2026-08-03T02:10:02.000Z");
    }
    const saved = await first!.viralAnalysisRecord.findUnique({ where: { id: "task-sqlite" } });
    const parsed = JSON.parse(saved!.resultJson);
    expect(parsed.listingPackSnapshot).toEqual({ source: "synthetic" });
    expect(parsed.aiImageDraftSnapshot).toEqual({ source: "synthetic" });
    expect(parsed.unknownNamespace).toEqual({ keep: true });
    expect(parsed.researchRecord.revision).toBe(1);
    expect(parsed.researchRecord.decisionEvents).toHaveLength(1);
  });

  it("fails stale CAS when either updatedAt or resultJson changed", async () => {
    const original = await loadOwnerTaskResultJsonSnapshot(database(first!), "task-sqlite");
    await first!.viralAnalysisRecord.update({
      where: { id: "task-sqlite" },
      data: { updatedAt: new Date("2026-08-03T03:00:00.000Z") },
    });
    expect(await commitOwnerTaskResultJsonMutation(database(second!), {
      snapshot: original!,
      resultJson: original!.resultJson,
      updatedAt: "2026-08-03T03:00:01.000Z",
    })).toBe(false);

    const current = await loadOwnerTaskResultJsonSnapshot(database(first!), "task-sqlite");
    const changed = JSON.stringify({ ...JSON.parse(current!.resultJson), externalNamespace: { changed: true } });
    await first!.viralAnalysisRecord.update({
      where: { id: "task-sqlite" },
      data: { resultJson: changed, updatedAt: current!.updatedAt as Date },
    });
    expect(await commitOwnerTaskResultJsonMutation(database(second!), {
      snapshot: current!,
      resultJson: current!.resultJson,
      updatedAt: "2026-08-03T03:00:02.000Z",
    })).toBe(false);
  });
});
