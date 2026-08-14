import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import {
  addCompetitorAsin,
  CompetitorEvidenceError,
  COMPETITOR_EVIDENCE_MAX_ASINS,
  emptyCompetitorEvidence,
  getCompetitorEvidence,
  normalizeCompetitorAsin,
  parseCompetitorEvidence,
  removeCompetitorAsin,
} from "@/lib/server/competitorEvidence";
import { createHash } from "node:crypto";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "competitor-evidence-store");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const NOW = "2026-08-05T00:00:00.000Z";
const DEMO_A = "demo-access-a";

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

let taskId: string;
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "competitor-evidence-"));
  const task = await createTrustedSandboxTask(
    DEMO_A,
    {
      type: "workflow",
      title: "Competitor Evidence Test",
      platform: "amazon",
      productUrl: null,
      materialText: "",
      source: "demo",
      score: 0,
      level: "low",
      oneLineSummary: "",
      resultJson: "{}",
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

describe("competitor evidence schema", () => {
  it("normalizes ASIN to uppercase and validates format", () => {
    expect(normalizeCompetitorAsin(" b0a1b2c3d4 ")).toBe("B0A1B2C3D4");
    expect(parseCompetitorEvidence(emptyCompetitorEvidence(null))).not.toBeNull();
  });

  it("rejects malformed namespaces fail-soft to empty list", () => {
    expect(parseCompetitorEvidence({ schema: "competitor-evidence.v1", version: 1, asins: "nope" })).toBeNull();
    expect(parseCompetitorEvidence({ schema: "other", version: 1, asins: [] })).toBeNull();
    expect(parseCompetitorEvidence({ schema: "competitor-evidence.v1", version: 2, asins: [] })).toBeNull();
  });
});

describe("competitor evidence mutations (visitor sandbox)", () => {
  it("starts empty and adds an ASIN with actor", async () => {
    const context = visitorContext();
    const initial = await getCompetitorEvidence(context, taskId);
    expect(initial.asins).toEqual([]);

    const afterAdd = await addCompetitorAsin({
      context,
      taskId,
      asin: "b0a1b2c3d4",
      note: "参考竞品",
      expectedStorageVersion: toStorageVersion(taskId),
    });
    expect(afterAdd.asins).toHaveLength(1);
    expect(afterAdd.asins[0]).toMatchObject({
      asin: "B0A1B2C3D4",
      sourceKind: "manual",
      addedBy: { mode: "visitor", actorRef: `visitor:${DEMO_A}` },
    });
    expect(afterAdd.asins[0].note).toBe("参考竞品");
    expect(afterAdd.schema).toBe("competitor-evidence.v1");
  });

  it("rejects duplicates and enforces the 5-ASIN cap", async () => {
    const context = visitorContext();
    for (let i = 1; i <= COMPETITOR_EVIDENCE_MAX_ASINS; i += 1) {
      await addCompetitorAsin({
        context,
        taskId,
        asin: `B0TEST000${i}`,
        expectedStorageVersion: toStorageVersion(taskId),
      });
    }
    const dup = await addCompetitorAsin({
      context,
      taskId,
      asin: "b0test0001",
      expectedStorageVersion: toStorageVersion(taskId),
    }).catch((error: CompetitorEvidenceError) => error);
    expect(dup).toBeInstanceOf(CompetitorEvidenceError);
    expect((dup as CompetitorEvidenceError).code).toBe("duplicate_asin");

    const over = await addCompetitorAsin({
      context,
      taskId,
      asin: "B0TEST000X",
      expectedStorageVersion: toStorageVersion(taskId),
    }).catch((error: CompetitorEvidenceError) => error);
    expect(over).toBeInstanceOf(CompetitorEvidenceError);
    expect((over as CompetitorEvidenceError).code).toBe("competitor_evidence_limit_exceeded");
  });

  it("rejects invalid ASIN format", async () => {
    const context = visitorContext();
    const result = await addCompetitorAsin({
      context,
      taskId,
      asin: "not-an-asin!",
      expectedStorageVersion: toStorageVersion(taskId),
    }).catch((error: CompetitorEvidenceError) => error);
    expect(result).toBeInstanceOf(CompetitorEvidenceError);
    expect((result as CompetitorEvidenceError).code).toBe("invalid_asin");
  });

  it("rejects stale storage version with 409 conflict", async () => {
    const context = visitorContext();
    await addCompetitorAsin({
      context,
      taskId,
      asin: "B0TEST0001",
      expectedStorageVersion: toStorageVersion(taskId),
    });
    const stale = await addCompetitorAsin({
      context,
      taskId,
      asin: "B0TEST0002",
      expectedStorageVersion: {
        resultJsonHash: "a".repeat(64),
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    }).catch((error: CompetitorEvidenceError) => error);
    expect(stale).toBeInstanceOf(CompetitorEvidenceError);
    expect((stale as CompetitorEvidenceError).code).toBe("task_result_conflict");
  });

  it("removes an ASIN and persists through the sandbox store", async () => {
    const context = visitorContext();
    await addCompetitorAsin({
      context,
      taskId,
      asin: "B0TEST0001",
      expectedStorageVersion: toStorageVersion(taskId),
    });
    await addCompetitorAsin({
      context,
      taskId,
      asin: "B0TEST0002",
      expectedStorageVersion: toStorageVersion(taskId),
    });
    const afterRemove = await removeCompetitorAsin({
      context,
      taskId,
      asin: "B0TEST0001",
      expectedStorageVersion: toStorageVersion(taskId),
    });
    expect(afterRemove.asins.map((entry) => entry.asin)).toEqual(["B0TEST0002"]);

    // 持久化验证：重新读取（同一 store 文件）
    const reloaded = await getCompetitorEvidence(context, taskId);
    expect(reloaded.asins.map((entry) => entry.asin)).toEqual(["B0TEST0002"]);
  });
});
