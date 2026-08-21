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
import { appendFact, createPrismaFactStore, currentFacts, validateFactConfirmation, type FactStoreDb } from "@/lib/v4/factStore";

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
        commercialJson: (args.data.commercialJson as string | null) ?? null,
        contentJson: (args.data.contentJson as string | null) ?? null,
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
  return { db };
}

class SupplierPlanTools extends FakeToolRegistry {
  plan(): ResearchPlan {
    const questions: ResearchQuestion[] = [
      { questionId: "q-amazon", toolName: "amazon/search", input: { toolName: "amazon/search", query: "yoga mat" }, inputHash: "profile-a-hash" },
      { questionId: "q-supplier", toolName: "supplier_research", input: { toolName: "supplier_research", offerId: "930374004918" }, inputHash: "detail-ok-hash" },
    ];
    return { planRevision: 0, rationale: "supplier journey", questions, stopConditions: ["budget"] };
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

function factDb(): FactStoreDb & { v4FactRecord: { update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>> } } {
  const rows: Record<string, unknown>[] = [];
  let seq = 0;
  return {
    v4FactRecord: {
      async create(args) { seq += 1; const row = { id: "f-" + seq, ...args.data, createdAt: new Date().toISOString() }; rows.push(row); return row; },
      async findMany(args) {
        const where = args.where as Record<string, unknown>;
        return rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
      },
      async update(args) { const row = rows.find((r) => r.id === args.where.id)!; Object.assign(row, args.data); return row; },
    },
  };
}

describe("P3 supplier journey: Gate A → 1688 claims → Fact Gate → facts", () => {
  let root = "";
  let runStore: ResearchRunStore;
  let journal: SideEffectJournal;

  function deps(): GraphDeps {
    return {
      domain: new DomainAdapter(domainDb),
      tools: new SupplierPlanTools(),
      journal,
      runStore,
      checkpointPath: (runId: string) => join(root, runId + ".db"),
      marketTools: { names: MARKET_TOOL_NAMES, execute: executeMarketTool },
    };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "v4-supplier-journey-"));
    const runDb = makeRunDb();
    runStore = new ResearchRunStore({ v4ResearchRun: runDb.delegate } as unknown as ResearchRunDb);
    journal = new SideEffectJournal(makeJournalDb().db);
    setGraphDepsFactoryForTest(deps);
  });

  afterEach(() => {
    setGraphDepsFactoryForTest(() => { throw new Error("not set"); });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("Gate A continue → 1688 supplier claims → Fact Gate waiting → manual confirm appended with revision", async () => {
    const runner = new ResearchRunRunner(deps());
    const start = await runner.startRun({ runId: "sup-1", candidateId: "cand-1", ownerScope: "owner", sandboxId: null, mode: "local_live" });
    expect(start.currentNode).toBe("build_plan");
    // 计划审核通过
    const plan = await runner.resumeRun("sup-1", { kind: "human_decision", decision: "continue" }, start.run.revision);
    expect(plan.currentNode).toBe("gate_a");
    // Gate A 通过（continue_sourcing 语义 → decision continue）
    const gateA = await runner.resumeRun("sup-1", { kind: "human_decision", decision: "continue", note: "市场证据充足，继续找货" }, plan.run.revision);
    expect(gateA.currentNode).toBe("product_fact_gate");
    expect(gateA.status).toBe("waiting_human");
    expect(gateA.wait?.reasonCode).toBe("FACT_GATE");

    // 人工在 Fact Gate 逐项确认（经 validator：必须 method + refs）
    const db = factDb();
    const v = validateFactConfirmation({ runId: "sup-1", candidateId: "cand-1", offerIdentity: "930374004918", variantKey: "v1", field: "material", value: "304 不锈钢", status: "confirmed", confirmationMethod: "document", claimRefs: ["claim-1"], documentRefs: ["doc-1"], actor: "owner" });
    expect(v.ok).toBe(true);
    const rec = await appendFact(db, { runId: "sup-1", candidateId: "cand-1", offerIdentity: "930374004918", variantKey: "v1", field: "material", value: "304 不锈钢", status: "confirmed", confirmationMethod: "document", claimRefs: ["claim-1"], documentRefs: ["doc-1"], actor: "owner" });
    expect(rec.revision).toBe(1);
    // 自动晋级阻断
    const blocked = validateFactConfirmation({ runId: "sup-1", candidateId: "cand-1", offerIdentity: "930374004918", variantKey: "v1", field: "material", value: "304 不锈钢", status: "confirmed", claimRefs: ["claim-1"], actor: "owner" });
    expect(blocked.ok).toBe(false);

    // Fact Gate 通过 → factRevision 提升
    const factsDone = await runner.resumeRun("sup-1", { kind: "human_decision", decision: "continue" }, gateA.run.revision);
    expect(factsDone.status).toBe("waiting_input");
    expect(factsDone.currentNode).toBe("commercial_check");
    // P4：注入商业输出后到 Gate B
    const crow = await runStore.getRun("sup-1");
    await runStore.saveRun("sup-1", crow!.revision, { stateJson: crow!.stateJson, commercialJson: JSON.stringify({ schemaVersion: "calc-commercial.v1", scenarios: {}, sensitiveVariables: [], unknowns: [], uncoveredCosts: [], rules: { version: "calc-commercial.v1", marketplace: "US", category: "home", reviewedAt: "2026-08-01T00:00:00.000Z", sourceUrl: "https://example.com", stale: false }, generatedAt: "2026-08-21T00:00:00.000Z" }) });
    const rev2 = (await runStore.getRun("sup-1"))!.revision;
    const gateB = await runner.resumeRun("sup-1", { kind: "human_decision", decision: "continue" }, rev2);
    expect(gateB.status).toBe("waiting_human");
    expect(gateB.currentNode).toBe("gate_b");
    const current = await currentFacts(db, "sup-1", "930374004918", "v1");
    expect(current.length).toBe(1);
    expect(current[0].field).toBe("material");
    expect(current[0].status).toBe("confirmed");
  });
});
