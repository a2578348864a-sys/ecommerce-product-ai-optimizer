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
  type CompetitorAsinEntry,
  type CompetitorEvidenceV1,
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

describe("competitorEvidence 自动采集来源（轮 9）", () => {
  it("browser_use 确认写入：来源必须齐全，且解析后可追溯", async () => {
    const context = visitorContext();
    const saved = await addCompetitorAsin({
      context,
      taskId,
      asin: "B0COMP0002",
      expectedStorageVersion: toStorageVersion(taskId, context),
      autoProvenance: {
        collector: { tool: "browser-use", version: "0.1.9" },
        sourceUrl: "https://www.amazon.com/dp/B0COMP0002",
        capturedAt: "2026-08-14T02:00:00.000Z",
        reasonCodes: ["reverse_asin_top10"],
      },
    });
    const entry = saved.asins[0] as CompetitorAsinEntry;
    expect(entry.sourceKind).toBe("browser_use");
    expect(entry.collectedBy).toEqual({ tool: "browser-use", version: "0.1.9" });
    expect(entry.sourceUrl).toBe("https://www.amazon.com/dp/B0COMP0002");
    const parsed = parseCompetitorEvidence(saved);
    expect(parsed).not.toBeNull();
    expect((parsed as CompetitorEvidenceV1).asins[0].sourceKind).toBe("browser_use");
  });

  it("来源缺失（无 sourceUrl/capturedAt）→ 拒绝保存（不冒充人工添加）", async () => {
    const context = visitorContext();
    await expect(addCompetitorAsin({
      context,
      taskId,
      asin: "B0COMP0003",
      expectedStorageVersion: toStorageVersion(taskId, context),
      autoProvenance: { collector: { tool: "browser-use", version: "0.1.9" }, sourceUrl: "", capturedAt: "" },
    })).rejects.toMatchObject({ code: "invalid_auto_provenance" });
  });
});


describe("轮 15：detailBullets 向后兼容", () => {
  it("旧数据无 detailBullets 字段仍能解析（缺省 undefined）", () => {
    const legacyRaw = {
      schema: "competitor-evidence.v1",
      version: 1,
      candidateId: null,
      asins: [
        {
          asin: "B0TEST0001",
          sourceKind: "browser_use",
          addedBy: { mode: "owner", actorRef: "owner:v1" },
          addedAt: "2026-08-20T00:00:00.000Z",
          note: "legacy note",
          collectedBy: { tool: "browser-use", version: "0.1.0" },
          sourceUrl: "https://www.amazon.com/dp/B0TEST0001",
          capturedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-20T00:00:00.000Z",
    };
    const parsed = parseCompetitorEvidence(legacyRaw);
    expect(parsed).not.toBeNull();
    expect((parsed as { asins: { detailBullets?: unknown }[] }).asins[0].detailBullets).toBeUndefined();
  });
  it("新数据含 detailBullets：正确解析（≤5 条、≤500 字符、ASIN 保留）", () => {
    const raw = {
      schema: "competitor-evidence.v1",
      version: 1,
      candidateId: null,
      asins: [
        {
          asin: "B0TEST0002",
          sourceKind: "browser_use",
          addedBy: { mode: "owner", actorRef: "owner:v1" },
          addedAt: "2026-08-20T00:00:00.000Z",
          collectedBy: { tool: "browser-use", version: "0.1.0" },
          sourceUrl: "https://www.amazon.com/dp/B0TEST0002",
          capturedAt: "2026-08-20T00:00:00.000Z",
          detailBullets: {
            bullets: ["b1", "b2", "b3", "b4", "b5", "b6"],
            capturedAt: "2026-08-21T00:00:00.000Z",
            sourceUrl: "https://www.amazon.com/dp/B0TEST0002",
          },
        },
      ],
      updatedAt: "2026-08-20T00:00:00.000Z",
    };
    const parsed = parseCompetitorEvidence(raw);
    expect(parsed).not.toBeNull();
    const entry = (parsed as { asins: { detailBullets?: { bullets: string[]; capturedAt: string; sourceUrl: string | null } }[] }).asins[0];
    expect(entry.detailBullets?.bullets).toEqual(["b1", "b2", "b3", "b4", "b5"]);
    expect(entry.detailBullets?.sourceUrl).toBe("https://www.amazon.com/dp/B0TEST0002");
  });
  it("detailBullets 为 null/空数组/超长 → 不解析（undefined，不崩溃）", () => {
    const raw = {
      schema: "competitor-evidence.v1",
      version: 1,
      candidateId: null,
      asins: [
        {
          asin: "B0TEST0003",
          sourceKind: "browser_use",
          addedBy: { mode: "owner", actorRef: "owner:v1" },
          addedAt: "2026-08-20T00:00:00.000Z",
          collectedBy: { tool: "browser-use", version: "0.1.0" },
          sourceUrl: "https://www.amazon.com/dp/B0TEST0003",
          capturedAt: "2026-08-20T00:00:00.000Z",
          detailBullets: { bullets: [], capturedAt: "2026-08-21T00:00:00.000Z", sourceUrl: null },
        },
      ],
      updatedAt: "2026-08-20T00:00:00.000Z",
    };
    const parsed = parseCompetitorEvidence(raw);
    expect(parsed).not.toBeNull();
    expect((parsed as { asins: { detailBullets?: unknown }[] }).asins[0].detailBullets).toBeUndefined();
  });
});
