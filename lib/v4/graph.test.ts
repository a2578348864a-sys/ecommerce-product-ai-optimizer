import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DomainAdapter, type CandidateRow, type DomainDb } from "@/lib/v4/domain";
import { FakeToolRegistry } from "@/lib/v4/fakeTools";
import { SideEffectJournal, buildIdempotencyKey, type JournalDb, type JournalEntry } from "@/lib/v4/journal";
import { ResearchRunStore, type ResearchRunDb, type RunRow } from "@/lib/v4/runStore";
import { ResearchRunRunner, initialBudget, type GraphDeps } from "@/lib/v4/graph";

function makeRunStoreDb() {
  const rows = new Map<string, RunRow>();
  let seq = 0;
  const delegate = {
    async create(args: { data: Record<string, unknown> }) {
      seq += 1;
      const row: RunRow = {
        id: args.data.id as string, candidateId: args.data.candidateId as string,
        ownerScope: args.data.ownerScope as string, sandboxId: (args.data.sandboxId as string | null) ?? null,
        mode: args.data.mode as string, graphVersion: args.data.graphVersion as string,
        status: args.data.status as string, currentNode: args.data.currentNode as string,
        revision: args.data.revision as number, planRevision: args.data.planRevision as number,
        automaticPlanRevisionCount: args.data.automaticPlanRevisionCount as number,
        stateJson: args.data.stateJson as string, eventsJson: args.data.eventsJson as string,
        createdAt: new Date(), updatedAt: new Date(),
      };
      rows.set(row.id, row);
      return { ...row };
    },
    async findUnique(args: { where: { id: string } }) {
      const row = rows.get(args.where.id);
      return row ? { ...row } : null;
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const current = rows.get(args.where.id);
      if (!current) throw new Error("not found");
      const updated = { ...current, ...(args.data as Partial<RunRow>), updatedAt: new Date() };
      rows.set(updated.id, updated);
      return { ...updated };
    },
  };
  return { db: { v4ResearchRun: delegate } as ResearchRunDb, rows };
}

function makeJournalDb() {
  const entries = new Map<string, JournalEntry>();
  let seq = 0;
  const db: JournalDb = {
    v4SideEffectJournal: {
      async findFirst(args) {
        const e = entries.get(`${args.where.runId}|${args.where.idempotencyKey}`);
        return e ? { ...e } : null;
      },
      async create(args) {
        const key = `${args.data.runId}|${args.data.idempotencyKey}`;
        if (entries.has(key)) throw new Error("UNIQUE constraint failed");
        seq += 1;
        const e: JournalEntry = { id: `j-${seq}`, runId: args.data.runId, idempotencyKey: args.data.idempotencyKey, inputHash: args.data.inputHash, action: args.data.action, status: args.data.status, detailJson: args.data.detailJson ?? "{}", createdAt: new Date().toISOString() };
        entries.set(key, e);
        return { ...e };
      },
      async updateMany(args) {
        const key = `${args.where.runId}|${args.where.idempotencyKey}`;
        const e = entries.get(key);
        if (!e) return { count: 0 };
        e.status = args.data.status;
        entries.set(key, e);
        return { count: 1 };
      },
    },
  };
  return { db, entries };
}

const candidateRow: CandidateRow = {
  id: "c-1", name: "Mini LED Ring Light", rawInput: "amazon data", link: "https://e.com/p",
  score: 82, source: "机会雷达", keyword: "ring light", riskLevel: "low", riskLabel: "",
  summaryLabel: "", status: "pending", analysisJson: JSON.stringify({ summary: "High demand" }),
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
};

let root = "";
let checkpointPath: (runId: string) => string;
let runStore: ResearchRunStore;
let journal: SideEffectJournal;
let journalDb: ReturnType<typeof makeJournalDb>;
let runner: ResearchRunRunner;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "v4-graph-"));
  checkpointPath = (runId: string) => join(root, `cp-${runId}.db`);
  runStore = new ResearchRunStore(makeRunStoreDb().db);
  journalDb = makeJournalDb();
  journal = new SideEffectJournal(journalDb.db);
  const domainDb: DomainDb = { opportunityCandidate: { async findUnique(args) { return args.where.id === "c-1" ? candidateRow : null; } } };
  const deps: GraphDeps = {
    domain: new DomainAdapter(domainDb),
    tools: new FakeToolRegistry(),
    journal,
    runStore,
    checkpointPath,
  };
  runner = new ResearchRunRunner(deps);
});
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

async function currentRevision(runId: string): Promise<number> {
  const run = await runStore.getRun(runId);
  if (!run) throw new Error("run missing");
  return run.revision;
}
async function resumeContinue(runId: string, expectedRevision: number) {
  return runner.resumeRun(runId, { kind: "human_decision", decision: "continue" }, expectedRevision);
}

describe("ResearchRunRunner (StateGraph + interrupt HITL)", () => {
  it("#1 happy path: draft -> waiting_human x5 -> completed", async () => {
    const runId = "run-happy";
    const start = await runner.startRun({ runId, candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    expect(start.status).toBe("waiting_human");
    expect(start.currentNode).toBe("build_plan");
    expect(start.wait?.kind).toBe("human_decision");
    expect(start.wait?.reasonCode).toBe("PLAN_REVIEW");

    let rev = await currentRevision(runId);
    let result = await resumeContinue(runId, rev);
    expect(result.status).toBe("waiting_human");
    expect(result.currentNode).toBe("gate_a");

    rev = await currentRevision(runId);
    result = await resumeContinue(runId, rev);
    expect(result.status).toBe("waiting_human");
    expect(result.currentNode).toBe("product_fact_gate");
    expect(result.wait?.reasonCode).toBe("FACT_GATE");

    rev = await currentRevision(runId);
    result = await resumeContinue(runId, rev);
    expect(result.status).toBe("waiting_human");
    expect(result.currentNode).toBe("gate_b");

    rev = await currentRevision(runId);
    result = await resumeContinue(runId, rev);
    expect(result.status).toBe("waiting_human");
    expect(result.currentNode).toBe("content_review");

    rev = await currentRevision(runId);
    result = await resumeContinue(runId, rev);
    expect(result.status).toBe("completed");
    expect(result.completed).toBe(true);
    expect(result.currentNode).toBe("complete");

    const run = await runStore.getRun(runId);
    expect(run?.status).toBe("completed");
    const state = runStore.readState(run!);
    expect(state?.status).toBe("completed");
    expect(state?.evidenceRevision).toBeGreaterThan(0);
    const events = runStore.readEvents(run!);
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("#2 each wait pauses with waiting_human", async () => {
    const runId = "run-wait";
    const start = await runner.startRun({ runId, candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    expect(start.status).toBe("waiting_human");
    expect(start.currentNode).toBe("build_plan");
    expect(start.wait?.instructions).toBeTruthy();
  });

  it("#3 cancel after plan review -> cancelled + writes frozen", async () => {
    const runId = "run-cancel";
    const start = await runner.startRun({ runId, candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    expect(start.status).toBe("waiting_human");
    const rev = await currentRevision(runId);
    const result = await runner.resumeRun(runId, { kind: "human_decision", decision: "stop" }, rev);
    expect(result.status).toBe("cancelled");
    expect(result.cancelled).toBe(true);
    const run = await runStore.getRun(runId);
    expect(run?.status).toBe("cancelled");
    expect(run?.currentNode).toBe("cancel");
    const rev2 = await currentRevision(runId);
    await expect(
      runner.resumeRun(runId, { kind: "human_decision", decision: "continue" }, rev2),
    ).rejects.toMatchObject({ code: "TERMINAL_FROZEN" });
    await expect(
      runStore.saveRun(runId, rev2, { stateJson: "{}", status: "running", currentNode: "dispatch_tool" }),
    ).rejects.toMatchObject({ code: "TERMINAL_FROZEN" });
  });

  it("#5 resume with wrong expectedRevision -> REVISION_CONFLICT (latest revision)", async () => {
    const runId = "run-rev";
    await runner.startRun({ runId, candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    const rev = await currentRevision(runId);
    await expect(
      runner.resumeRun(runId, { kind: "human_decision", decision: "continue" }, rev + 5),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT", latestRevision: rev });
  });

  it("#4 idempotency: pre-committed tool side-effect is skipped (no duplicate evidence)", async () => {
    const runId = "run-idem";
    const domainDb: DomainDb = { opportunityCandidate: { async findUnique(args) { return args.where.id === "c-1" ? candidateRow : null; } } };
    const domain = new DomainAdapter(domainDb);
    const tools = new FakeToolRegistry();
    const ctx = await domain.loadContext({ candidateId: "c-1" });
    const plan = tools.plan({ contextHash: ctx.contextHash, budgetInputHash: "0" });
    const first = plan.questions[0];
    const idemKey = buildIdempotencyKey({ runId, questionId: first.questionId, toolName: first.toolName, inputHash: first.inputHash });
    await journal.resolve({ runId, idempotencyKey: idemKey, inputHash: first.inputHash, action: first.toolName });
    await journal.commit({ runId, idempotencyKey: idemKey });

    const start = await runner.startRun({ runId, candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    expect(start.status).toBe("waiting_human");
    let result = start;
    let guard = 0;
    while (result.status === "waiting_human" && guard < 10) {
      const rev = await currentRevision(runId);
      result = await resumeContinue(runId, rev);
      guard += 1;
    }
    expect(result.status).toBe("completed");
    const run = await runStore.getRun(runId);
    const state = runStore.readState(run!);
    expect(state?.evidenceRevision).toBe(plan.questions.length - 1);
    const entry = journalDb.entries.get(`${runId}|${idemKey}`);
    expect(entry?.status).toBe("skipped_duplicate");
  });

  it("budget exhaustion pauses with paused_budget", async () => {
    const runId = "run-budget";
    const tiny = initialBudget();
    tiny.maxCost = 0.01;
    const start = await runner.startRun({ runId, candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live", budget: tiny });
    expect(start.status).toBe("waiting_human");
    const rev = await currentRevision(runId);
    const result = await resumeContinue(runId, rev);
    expect(result.status).toBe("paused_budget");
    expect(result.wait?.kind).toBe("budget");
    expect(result.currentNode).toBe("dispatch_tool");
  });
});
