import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DomainAdapter, type CandidateRow, type DomainDb } from "@/lib/v4/domain";
import { FakeToolRegistry } from "@/lib/v4/fakeTools";
import { SideEffectJournal, type JournalDb, type JournalEntry } from "@/lib/v4/journal";
import { ResearchRunStore, type ResearchRunDb, type RunRow } from "@/lib/v4/runStore";
import { ResearchRunRunner, type GraphDeps } from "@/lib/v4/graph";

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

function makeDeps(runStore: ResearchRunStore, journal: SideEffectJournal, checkpointPath: (r: string) => string): GraphDeps {
  const domainDb: DomainDb = { opportunityCandidate: { async findUnique(args) { return args.where.id === "c-1" ? candidateRow : null; } } };
  return {
    domain: new DomainAdapter(domainDb),
    tools: new FakeToolRegistry(),
    journal,
    runStore,
    checkpointPath,
  };
}

let root = "";

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "v4-recovery-")); });
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; });

async function currentRevision(runStore: ResearchRunStore, runId: string) {
  const run = await runStore.getRun(runId);
  if (!run) throw new Error("run missing");
  return run.revision;
}

describe("Recovery: process interrupt with same checkpoint DB (no duplicate side-effects)", () => {
  it("#6 resume after recompile does not duplicate evidence", async () => {
    const runId = "run-recover";
    const checkpointPath = (r: string) => join(root, `cp-${r}.db`);
    const runStoreDb = makeRunStoreDb();
    const runStore = new ResearchRunStore(runStoreDb.db);
    const journalDb = makeJournalDb();
    const journal = new SideEffectJournal(journalDb.db);

    // First "process": run to gate_a (evidence merged, journal committed)
    const runner1 = new ResearchRunRunner(makeDeps(runStore, journal, checkpointPath));
    const start = await runner1.startRun({ runId, candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    expect(start.status).toBe("waiting_human");
    expect(start.currentNode).toBe("build_plan");
    let rev = await currentRevision(runStore, runId);
    const atGateA = await runner1.resumeRun(runId, { kind: "human_decision", decision: "continue" }, rev);
    expect(atGateA.status).toBe("waiting_human");
    expect(atGateA.currentNode).toBe("gate_a");

    const runBefore = await runStore.getRun(runId);
    const evidenceBefore = runStore.readState(runBefore!)?.evidenceRevision ?? 0;
    const committedBefore = [...journalDb.entries.values()].filter((e) => e.status === "committed").length;
    expect(evidenceBefore).toBeGreaterThan(0);
    expect(committedBefore).toBeGreaterThan(0);

    // "Process interruption": new runner, same checkpoint DB + same runStore/journal
    const runner2 = new ResearchRunRunner(makeDeps(runStore, journal, checkpointPath));
    const checkpointState = await runner2.getState(runId);
    // The checkpoint reflects the last committed superstep (synthesize_market); gate_a is pending.
    expect(checkpointState?.currentNode).toBe("synthesize_market");
    expect((checkpointState?.evidence ?? []).length).toBe(evidenceBefore);

    // Resume from gate_a to completion
    rev = await currentRevision(runStore, runId);
    const result = await runner2.resumeRun(runId, { kind: "human_decision", decision: "continue" }, rev);
    // Note: may pause at product_fact_gate. Drive through remaining gates.
    let current = result;
    let guard = 0;
    while (current.status === "waiting_human" && guard < 10) {
      rev = await currentRevision(runStore, runId);
      current = await runner2.resumeRun(runId, { kind: "human_decision", decision: "continue" }, rev);
      guard += 1;
    }
    expect(current.status).toBe("completed");

    const runAfter = await runStore.getRun(runId);
    const evidenceAfter = runStore.readState(runAfter!)?.evidenceRevision ?? 0;
    // Evidence revision must NOT have been duplicated by recovery.
    expect(evidenceAfter).toBe(evidenceBefore);
    // No new "apply" commits beyond the original question count; duplicates are skipped.
    const committedAfter = [...journalDb.entries.values()].filter((e) => e.status === "committed").length;
    expect(committedAfter).toBe(committedBefore);
  });

  it("cancel then recover is rejected (terminal frozen)", async () => {
    const runId = "run-recover-cancel";
    const checkpointPath = (r: string) => join(root, `cp-${r}.db`);
    const runStoreDb = makeRunStoreDb();
    const runStore = new ResearchRunStore(runStoreDb.db);
    const journalDb = makeJournalDb();
    const journal = new SideEffectJournal(journalDb.db);
    const runner = new ResearchRunRunner(makeDeps(runStore, journal, checkpointPath));
    await runner.startRun({ runId, candidateId: "c-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    const rev = await currentRevision(runStore, runId);
    const cancelled = await runner.resumeRun(runId, { kind: "human_decision", decision: "stop" }, rev);
    expect(cancelled.status).toBe("cancelled");
    // A new runner (recovery) cannot resume a cancelled run.
    const runner2 = new ResearchRunRunner(makeDeps(runStore, journal, checkpointPath));
    const rev2 = await currentRevision(runStore, runId);
    await expect(
      runner2.resumeRun(runId, { kind: "human_decision", decision: "continue" }, rev2),
    ).rejects.toMatchObject({ code: "TERMINAL_FROZEN" });
  });
});