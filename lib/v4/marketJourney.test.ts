import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DomainAdapter, type DomainDb } from "@/lib/v4/domain";
import { FakeToolRegistry, type ResearchPlan, type ResearchQuestion } from "@/lib/v4/fakeTools";
import { SideEffectJournal, type JournalDb, type JournalEntry } from "@/lib/v4/journal";
import { ResearchRunStore, type ResearchRunDb, type RunRow } from "@/lib/v4/runStore";
import { ResearchRunRunner, setGraphDepsFactoryForTest, type GraphDeps } from "@/lib/v4/graph";
import { MARKET_TOOL_NAMES, executeMarketTool } from "@/lib/v4/tools/registry";
import type { ResearchRunState } from "@/lib/v4/contracts";

function makeRunDb() {
  const rows = new Map<string, RunRow>();
  let seq = 0;
  const delegate = {
    async create(args: { data: Record<string, unknown> }) {
      seq += 1;
      const row: RunRow = {
        id: args.data.id as string, candidateId: args.data.candidateId as string,
        ownerScope: args.data.ownerScope as string, sandboxId: (args.data.sandboxId as string | null) ?? null,
        mode: args.data.mode as string, graphVersion: args.data.graphVersion as string,
        reportJson: (args.data.reportJson as string | null) ?? null,
        status: args.data.status as string, currentNode: args.data.currentNode as string,
        revision: args.data.revision as number, planRevision: args.data.planRevision as number,
        automaticPlanRevisionCount: args.data.automaticPlanRevisionCount as number,
        stateJson: args.data.stateJson as string, eventsJson: args.data.eventsJson as string,
        createdAt: new Date(), updatedAt: new Date(),
      };
      rows.set(row.id, row);
      return row;
    },
    async findUnique(args: { where: { id: string } }) { return rows.get(args.where.id) ?? null; },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const current = rows.get(args.where.id)!;
      const next = { ...current, ...args.data, updatedAt: new Date() };
      rows.set(next.id, next);
      return next;
    },
    async findMany() { return [...rows.values()]; },
  };
  return { delegate, rows };
}

function makeJournalDb() {
  const entries = new Map<string, JournalEntry>();
  let seq = 0;
  const db: JournalDb = {
    v4SideEffectJournal: {
      async findFirst(args) {
        const e = entries.get(args.where.runId + "|" + args.where.idempotencyKey);
        return e ? { ...e } : null;
      },
      async create(args) {
        const key = args.data.runId + "|" + args.data.idempotencyKey;
        if (entries.has(key)) throw new Error("UNIQUE constraint failed");
        seq += 1;
        const e: JournalEntry = { id: "j-" + seq, runId: args.data.runId, idempotencyKey: args.data.idempotencyKey, inputHash: args.data.inputHash, action: args.data.action, status: args.data.status, detailJson: args.data.detailJson ?? "{}", createdAt: new Date().toISOString() };
        entries.set(key, e);
        return { ...e };
      },
      async updateMany(args) {
        for (const e of entries.values()) {
          if (e.runId === args.where.runId && e.idempotencyKey === args.where.idempotencyKey) {
            entries.set(e.runId + "|" + e.idempotencyKey, { ...e, ...args.data });
          }
        }
        return { count: 1 };
      },
    },
  };
  return { db, entries };
}

class MarketPlanTools extends FakeToolRegistry {
  plan(): ResearchPlan {
    const questions: ResearchQuestion[] = [
      { questionId: "q-amazon", toolName: "amazon/search", input: { toolName: "amazon/search", query: "yoga mat" }, inputHash: "profile-a-hash" },
      { questionId: "q-keyword", toolName: "keyword", input: { toolName: "keyword" }, inputHash: "keyword-hash" },
      { questionId: "q-voc", toolName: "voc", input: { toolName: "voc" }, inputHash: "voc-hash" },
    ];
    return { planRevision: 0, rationale: "market journey", questions, stopConditions: ["budget"] };
  }
}

const domainDb: DomainDb = {
  opportunityCandidate: {
    async findUnique(args) {
      return args.where.id === "cand-1"
        ? { id: "cand-1", name: "yoga mat", rawInput: "", link: null, score: 0, source: "fixture", keyword: "yoga mat", riskLevel: "low", riskLabel: "低", summaryLabel: "", status: "pending", sourceMetaJson: "{}", analysisJson: "{}", convertedTaskId: null, originProductBatchItemId: null, createdAt: new Date(), updatedAt: new Date() }
        : null;
    },
  },
};

describe("P2 market journey (recorded) → report → gate_a", () => {
  let root = "";
  let runDb: ReturnType<typeof makeRunDb>;
  let journal: SideEffectJournal;
  let runStore: ResearchRunStore;

  function deps(): GraphDeps {
    return {
      domain: new DomainAdapter(domainDb),
      tools: new MarketPlanTools(),
      journal,
      runStore,
      checkpointPath: (runId: string) => join(root, runId + ".db"),
      marketTools: { names: MARKET_TOOL_NAMES, execute: executeMarketTool },
    };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "v4-market-journey-"));
    runDb = makeRunDb();
    journal = new SideEffectJournal(makeJournalDb().db);
    runStore = new ResearchRunStore({ v4ResearchRun: runDb.delegate } as unknown as ResearchRunDb);
    setGraphDepsFactoryForTest(deps);
  });

  afterEach(() => {
    setGraphDepsFactoryForTest(() => { throw new Error("not set"); });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("drives recorded market tools, merges evidence, builds cited report, waits at gate_a", async () => {
    const runner = new ResearchRunRunner(deps());
    const first = await runner.startRun({ runId: "mkt-1", candidateId: "cand-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    expect(first.status).toBe("waiting_human");
    expect(first.currentNode).toBe("build_plan");

    const afterPlan = await runner.resumeRun("mkt-1", { kind: "human_decision", decision: "continue" }, first.run.revision);
    expect(afterPlan.status).toBe("waiting_human");
    expect(afterPlan.currentNode).toBe("gate_a");
    expect(afterPlan.wait?.kind).toBe("human_decision");
    expect(afterPlan.wait?.reasonCode).toBe("GATE_A");

    const row = await runStore.getRun("mkt-1");
    expect(row).not.toBeNull();
    expect(row!.reportJson).toBeTruthy();
    const report = JSON.parse(row!.reportJson!) as {
      sections: { title: string; sentences: { kind: string; evidenceRefs: string[] }[] }[];
      evidence: unknown[];
      gaps: unknown[];
    };
    expect(report.evidence.length).toBeGreaterThanOrEqual(1);
    for (const section of report.sections) {
      for (const s of section.sentences) {
        if (s.kind === "factual") expect(s.evidenceRefs.length).toBeGreaterThan(0);
      }
    }
    const state = JSON.parse(row!.stateJson) as ResearchRunState;
    expect(state.status).toBe("waiting_human");
  });
});
