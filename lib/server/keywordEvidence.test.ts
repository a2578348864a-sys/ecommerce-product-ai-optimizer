import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import {
  getKeywordEvidence,
  KeywordEvidenceError,
  keywordReportToEvidence,
  parseKeywordEvidence,
  saveKeywordEvidence,
} from "@/lib/server/keywordEvidence";
import { parseKeywordReport } from "@/lib/upstream/sellersprite/keywordReports";
import {
  GOLDEN_KEYWORD_MINING_HEADERS,
  GOLDEN_KEYWORD_MINING_ROWS,
} from "@/lib/upstream/sellersprite/golden/golden-keyword-reports";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "keyword-evidence-store");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const NOW = "2026-08-15T00:00:00.000Z";
const DEMO_A = "demo-access-a";

function visitorContext() {
  return {
    mode: "demo" as const,
    token: "tok-demo",
    demoAccessId: DEMO_A,
    isActive: true,
    isExpired: false,
    remainingAiCalls: 10,
  };
}

function toStorageVersion(taskId: string) {
  const task = getSandboxTask(DEMO_A, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

function sampleReport() {
  const parsed = parseKeywordReport({
    headers: GOLDEN_KEYWORD_MINING_HEADERS,
    rows: GOLDEN_KEYWORD_MINING_ROWS.map((row) => GOLDEN_KEYWORD_MINING_HEADERS.map((h) => row[h] ?? null)),
    capturedAt: "2026-08-15T02:00:00.000Z",
  });
  if (!parsed.ok) throw new Error("fixture parse failed");
  return parsed.report;
}

let taskId: string;
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "keyword-evidence-"));
  const task = await createTrustedSandboxTask(
    DEMO_A,
    {
      type: "workflow",
      title: "Keyword Evidence Test",
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

describe("keyword evidence (Phase 3/4 Save Evidence)", () => {
  it("starts empty and saves a parsed report", async () => {
    const context = visitorContext();
    expect(await getKeywordEvidence(context, taskId)).toBeNull();

    const evidence = keywordReportToEvidence(sampleReport(), NOW);
    const saved = await saveKeywordEvidence({
      context,
      taskId,
      evidence,
      expectedStorageVersion: toStorageVersion(taskId),
    });
    expect(saved.schema).toBe("seller-sprite-keyword-evidence.v1");
    expect(saved.reportType).toBe("keyword_mining");
    expect(saved.rows).toHaveLength(5);

    const reloaded = await getKeywordEvidence(context, taskId);
    expect(reloaded?.rows[0].keyword).toBe("golden");
    expect(reloaded?.rows[0].fields.supplyDemandRatio).toMatchObject({ normalized: 1296.2 });
  });

  it("round-trips through parseKeywordEvidence", () => {
    const evidence = keywordReportToEvidence(sampleReport(), NOW);
    const parsed = parseKeywordEvidence(evidence);
    expect(parsed?.reportType).toBe("keyword_mining");
    expect(parsed?.rows).toHaveLength(5);
    expect(parseKeywordEvidence({ schema: "other" })).toBeNull();
    expect(parseKeywordEvidence({ schema: "seller-sprite-keyword-evidence.v1", reportType: "nope", rows: [] })).toBeNull();
  });

  it("rejects empty rows and stale storage version", async () => {
    const context = visitorContext();
    const empty = keywordReportToEvidence({ ...sampleReport(), rows: [] }, NOW);
    const emptyResult = await saveKeywordEvidence({
      context,
      taskId,
      evidence: empty,
      expectedStorageVersion: toStorageVersion(taskId),
    }).catch((error: KeywordEvidenceError) => error);
    expect(emptyResult).toBeInstanceOf(KeywordEvidenceError);
    expect((emptyResult as KeywordEvidenceError).code).toBe("no_valid_rows");

    const stale = await saveKeywordEvidence({
      context,
      taskId,
      evidence: keywordReportToEvidence(sampleReport(), NOW),
      expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2020-01-01T00:00:00.000Z" },
    }).catch((error: KeywordEvidenceError) => error);
    expect(stale).toBeInstanceOf(KeywordEvidenceError);
    expect((stale as KeywordEvidenceError).code).toBe("task_result_conflict");
  });

  it("overwrites previous evidence on save (single latest snapshot semantics)", async () => {
    const context = visitorContext();
    await saveKeywordEvidence({
      context,
      taskId,
      evidence: keywordReportToEvidence(sampleReport(), NOW),
      expectedStorageVersion: toStorageVersion(taskId),
    });
    const second = keywordReportToEvidence(sampleReport(), NOW);
    const secondSaved = await saveKeywordEvidence({
      context,
      taskId,
      evidence: { ...second, capturedAt: "2026-08-16T02:00:00.000Z" },
      expectedStorageVersion: toStorageVersion(taskId),
    });
    const reloaded = await getKeywordEvidence(context, taskId);
    expect(reloaded?.capturedAt).toContain("2026-08-16");
    expect(secondSaved.rows).toHaveLength(5);
  });
});
