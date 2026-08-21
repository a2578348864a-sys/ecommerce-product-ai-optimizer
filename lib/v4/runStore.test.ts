import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

import { ResearchRunStore, RunStoreError, createPrismaRunStore, listRuns, __setRunPrismaForTest, type ResearchRunDb } from "@/lib/v4/runStore";
import { RESEARCH_GRAPH_VERSION, type ResearchRunState } from "@/lib/v4/contracts";

let root = "";
let databasePath = "";
let db: PrismaClient | undefined;

async function setupDb() {
  root = mkdtempSync(join(tmpdir(), "v4-runstore-"));
  databasePath = join(root, "cas.db");
  const schemaPath = join(root, "schema.prisma");
  copyFileSync(join(process.cwd(), "prisma", "schema.prisma"), schemaPath);
  const url = "file:./cas.db";
  execFileSync(process.execPath, [
    join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
    "db", "push", "--skip-generate", "--schema", schemaPath,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  const absoluteUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = absoluteUrl;
  db = new PrismaClient({ datasources: { db: { url: absoluteUrl } } });
  await db.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
  __setRunPrismaForTest(db);
}

afterEach(async () => {
  await db?.$disconnect().catch(() => undefined);
  db = undefined;
  delete process.env.DATABASE_URL;
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("ResearchRunStore (V4ResearchRun prisma-backed + CAS)", () => {
  beforeEach(async () => {
    await setupDb();
  });

  function store(): ResearchRunStore {
    return new ResearchRunStore(db as unknown as ResearchRunDb);
  }

  it("createRun -> draft, revision 0, graphVersion default", async () => {
    const s = store();
    const run = await s.createRun({ id: "run-1", candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    expect(run.status).toBe("draft");
    expect(run.revision).toBe(0);
    expect(run.graphVersion).toBe(RESEARCH_GRAPH_VERSION);
    expect(run.currentNode).toBe("load_context");
    const got = await s.getRun("run-1");
    expect(got?.id).toBe("run-1");
  });

  it("saveRun with correct expectedRevision bumps revision", async () => {
    const s = store();
    await s.createRun({ id: "run-1", candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    const row = await s.saveRun("run-1", 0, {
      stateJson: JSON.stringify({ status: "running" }),
      status: "running",
      currentNode: "validate_identity",
      events: [{ type: "node_entered", node: "validate_identity", payloadJson: "{}", createdAt: new Date().toISOString() }],
    });
    expect(row.revision).toBe(1);
    expect(row.status).toBe("running");
    const events = s.readEvents(row);
    expect(events.length).toBe(1);
    expect(events[0].seq).toBe(1);
  });

  it("saveRun with wrong expectedRevision -> REVISION_CONFLICT (latest revision)", async () => {
    const s = store();
    await s.createRun({ id: "run-1", candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    await s.saveRun("run-1", 0, { stateJson: "{}", status: "running", currentNode: "load_context" });
    await expect(
      s.saveRun("run-1", 0, { stateJson: "{}", status: "running", currentNode: "dispatch_tool" }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT", latestRevision: 1 });
  });

  it("appendEvents assigns monotonic seq", async () => {
    const s = store();
    await s.createRun({ id: "run-1", candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    await s.appendEvents("run-1", 0, [{ type: "node_entered", node: "load_context", payloadJson: "{}", createdAt: new Date().toISOString() }]);
    const row = await s.appendEvents("run-1", 1, [
      { type: "node_completed", node: "load_context", payloadJson: "{}", createdAt: new Date().toISOString() },
      { type: "node_entered", node: "validate_identity", payloadJson: "{}", createdAt: new Date().toISOString() },
    ]);
    const events = s.readEvents(row);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("cancel -> cancelled + revision frozen (writes fail TERMINAL_FROZEN)", async () => {
    const s = store();
    await s.createRun({ id: "run-1", candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    const row = await s.cancel("run-1", 0);
    expect(row.status).toBe("cancelled");
    expect(row.currentNode).toBe("cancel");
    await expect(
      s.saveRun("run-1", 1, { stateJson: "{}", status: "running", currentNode: "dispatch_tool" }),
    ).rejects.toMatchObject({ code: "TERMINAL_FROZEN" });
    await expect(s.cancel("run-1", 1)).rejects.toMatchObject({ code: "TERMINAL_FROZEN" });
  });

  it("assertGraphVersion fails closed on mismatch", async () => {
    // create with the default store (v4.1), then assert with a store expecting a different version
    const create = store();
    await create.createRun({ id: "run-1", candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    const s = new ResearchRunStore(db as unknown as ResearchRunDb, "research-graph.v9.9");
    await expect(s.assertGraphVersion("run-1")).rejects.toMatchObject({ code: "GRAPH_VERSION_MISMATCH" });
  });

  it("getRun on missing -> null; saveRun on missing -> NOT_FOUND", async () => {
    const s = store();
    expect(await s.getRun("missing")).toBeNull();
    await expect(s.saveRun("missing", 0, { stateJson: "{}" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// helper to satisfy the db type param
function newResearchRunStore(_db: unknown): ResearchRunStore {
  return new ResearchRunStore(_db as never);
}

describe("RunStore API contract (state-level create/get/save/appendEvent)", () => {
  beforeEach(async () => {
    await setupDb();
  });

  function sampleState(runId: string): ResearchRunState {
    const now = new Date().toISOString();
    return {
      schemaVersion: "researchRun.v4",
      runId,
      candidateId: "c-1",
      ownerScope: "owner",
      sandboxId: null,
      mode: "local_live",
      status: "running",
      currentNode: "load_context",
      revision: 0,
      planRevision: 0,
      automaticPlanRevisionCount: 0,
      activeQuestionId: null,
      activeToolCallId: null,
      evidenceRevision: 0,
      factRevision: null,
      policyPackVersion: null,
      budget: {
        maxWallClockMs: 120000, maxBrowserSteps: 100, maxLlmTokens: 100000, maxImageCalls: 20,
        maxCost: 10, currency: "USD", usedBrowserSteps: 0, usedLlmTokens: 0, usedImageCalls: 0, usedCost: 0,
      },
      wait: null,
      checkpoint: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
  }

  it("create + get round-trips a ResearchRunState", async () => {
    const store = new ResearchRunStore(db as unknown as ResearchRunDb);
    await store.create(sampleState("run-s"));
    const got = await store.get("run-s");
    expect(got?.runId).toBe("run-s");
    expect(got?.status).toBe("running");
    expect(got?.candidateId).toBe("c-1");
    expect(await store.get("missing")).toBeNull();
  });

  it("save with correct expectedRevision bumps revision; wrong -> REVISION_CONFLICT", async () => {
    const store = new ResearchRunStore(db as unknown as ResearchRunDb);
    await store.create(sampleState("run-s"));
    const s = sampleState("run-s");
    s.status = "waiting_human";
    s.currentNode = "build_plan";
    s.revision = 1;
    await store.save(s, 0);
    const got = await store.get("run-s");
    expect(got?.status).toBe("waiting_human");
    expect(got?.revision).toBe(1);
    await expect(store.save(sampleState("run-s"), 0)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("appendEvent appends the event and bumps revision", async () => {
    const store = new ResearchRunStore(db as unknown as ResearchRunDb);
    await store.create(sampleState("run-s"));
    const event = { seq: 1, type: "node_entered" as const, node: "load_context" as const, payloadJson: "{}", createdAt: new Date().toISOString() };
    await store.appendEvent("run-s", event, 0);
    const got = await store.get("run-s");
    expect(got?.revision).toBe(1);
  });

  it("listRuns filters by ownerScope/sandboxId", async () => {
    const store = new ResearchRunStore(db as unknown as ResearchRunDb);
    await store.create({ ...sampleState("run-a"), ownerScope: "owner", sandboxId: null });
    await store.create({ ...sampleState("run-b"), ownerScope: "owner", sandboxId: "sb1" });
    await store.create({ ...sampleState("run-c"), ownerScope: "other", sandboxId: null });
    const all = await listRuns({ ownerScope: "owner" });
    expect(all.map((s) => s.runId).sort()).toEqual(["run-a", "run-b"]);
    const scoped = await listRuns({ ownerScope: "owner", sandboxId: "sb1" });
    expect(scoped.map((s) => s.runId)).toEqual(["run-b"]);
  });

  it("createPrismaRunStore returns a working RunStore", async () => {
    const store = createPrismaRunStore();
    expect(store).toBeDefined();
    expect(typeof store.create).toBe("function");
    expect(typeof store.get).toBe("function");
    expect(typeof store.save).toBe("function");
    expect(typeof store.appendEvent).toBe("function");
  });
});