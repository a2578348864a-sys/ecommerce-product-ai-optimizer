/**
 * workflowBatchRunCache — pure function tests
 *
 * Tests run in vitest node environment.
 * Storage-dependent tests use vi.stubGlobal + dynamic import() following
 * the same pattern as hooks/useLocalDraft.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasRunContent,
  makeRunId,
  sanitizeRun,
  stripLargeResult,
} from "@/components/cross-border/workflowBatchRunCache";
import { emptyWorkflowBatchRun } from "@/components/cross-border/workflowBatchRunCache";

/* ── sanitizeRun (no storage needed) ──────────── */

describe("sanitizeRun", () => {
  it("preserves valid queueItems with result/status/taskId/batchMeta", () => {
    const raw = {
      version: 1,
      runId: "run-test",
      createdAt: Date.now(),
      input: "手机支架\n电动牙刷",
      batchId: "batch-123",
      queueItems: [
        {
          id: "batch-123-0",
          productName: "手机支架",
          status: "saved" as const,
          result: {
            ok: true,
            workflowId: "wf-1",
            productName: "手机支架",
            status: "completed",
            finalReport: {
              finalVerdict: "推荐尝试",
              riskLevel: "green",
              beginnerFit: "适合新手",
              canTestSmallBatch: true,
              mustCheckBeforeListing: ["认证文件"],
              nextSteps: ["联系供应商"],
              manualReviewChecklist: ["确认平台规则"],
            },
            sourcing: { difficulty: "easy" },
            risk: { level: "low" },
            summary: { verdict: "good" },
            listing: { title: "test" },
            costGuard: { aiStepsRequested: 4, aiStepsCompleted: 4, fallbackSteps: 0 },
            warnings: ["minor issue"],
          },
          taskId: "task-1",
          error: "",
          batchMeta: {
            batchId: "batch-123",
            batchName: "分析产品",
            batchIndex: 1,
            batchTotal: 2,
            source: "workflow_batch_mvp" as const,
          },
        },
        {
          id: "batch-123-1",
          productName: "电动牙刷",
          status: "analyzed" as const,
          result: {
            ok: true,
            workflowId: "wf-2",
            productName: "电动牙刷",
            status: "completed",
            finalReport: {
              finalVerdict: "需谨慎",
              riskLevel: "yellow",
              beginnerFit: "需经验",
              canTestSmallBatch: false,
              mustCheckBeforeListing: ["CPC认证"],
              nextSteps: ["确认合规"],
              manualReviewChecklist: ["确认电池运输"],
            },
            sourcing: null,
            risk: null,
            summary: null,
            listing: null,
            costGuard: { aiStepsRequested: 4, aiStepsCompleted: 4, fallbackSteps: 0 },
            warnings: [],
          },
          taskId: null,
          error: "",
          batchMeta: {
            batchId: "batch-123",
            batchName: "分析产品",
            batchIndex: 2,
            batchTotal: 2,
            source: "workflow_batch_mvp" as const,
          },
        },
      ],
      lastSavedTaskId: "task-1",
      lastSavedProductName: "手机支架",
    };

    const result = sanitizeRun(raw);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.queueItems).toHaveLength(2);

    const item0 = result.queueItems[0];
    expect(item0.id).toBe("batch-123-0");
    expect(item0.status).toBe("saved");
    expect(item0.taskId).toBe("task-1");
    expect(item0.result).not.toBeNull();
    expect(item0.result?.finalReport).toBeDefined();
    expect(item0.result?.sourcing).toBeDefined();
    expect(item0.result?.risk).toBeDefined();
    expect(item0.result?.summary).toBeDefined();
    expect(item0.result?.listing).toBeDefined();
    expect(item0.result?.costGuard).toBeDefined();
    expect(item0.result?.warnings).toBeDefined();
    expect(item0.batchMeta).not.toBeNull();

    const item1 = result.queueItems[1];
    expect(item1.id).toBe("batch-123-1");
    expect(item1.status).toBe("analyzed");
    expect(item1.taskId).toBeNull();

    expect(result.lastSavedTaskId).toBe("task-1");
    expect(result.lastSavedProductName).toBe("手机支架");
    expect(result.input).toBe("手机支架\n电动牙刷");
    expect(result.batchId).toBe("batch-123");
  });

  it("discards invalid queueItems (missing id/productName)", () => {
    const raw = {
      version: 1,
      runId: "run-test",
      createdAt: Date.now(),
      input: "",
      batchId: null,
      queueItems: [
        { id: "", productName: "valid", status: "analyzed" as const, result: null, taskId: null, error: "", batchMeta: null },
        { id: "x", productName: "", status: "analyzed" as const, result: null, taskId: null, error: "", batchMeta: null },
        { productName: "no-id", status: "analyzed" },
        null,
        "not-an-object",
        { id: "valid-1", productName: "valid item", status: "analyzed" as const, result: null, taskId: null, error: "", batchMeta: null },
      ],
      lastSavedTaskId: null,
      lastSavedProductName: "",
    };

    const result = sanitizeRun(raw);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.queueItems).toHaveLength(1);
    expect(result.queueItems[0].id).toBe("valid-1");
    expect(result.queueItems[0].productName).toBe("valid item");
  });

  it("preserves save_failed items with result/error/status/batchMeta", () => {
    const raw = {
      version: 1,
      runId: "run-test",
      createdAt: Date.now(),
      input: "test",
      batchId: "b1",
      queueItems: [
        {
          id: "b1-0",
          productName: "test",
          status: "save_failed" as const,
          result: { ok: true, finalReport: { finalVerdict: "ok" } },
          taskId: null,
          error: "保存失败，请重试",
          batchMeta: {
            batchId: "b1",
            batchName: "分析产品",
            batchIndex: 1,
            batchTotal: 1,
            source: "workflow_batch_mvp" as const,
          },
        },
      ],
      lastSavedTaskId: null,
      lastSavedProductName: "",
    };

    const result = sanitizeRun(raw);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.queueItems).toHaveLength(1);
    const item = result.queueItems[0];
    expect(item.id).toBe("b1-0");
    expect(item.productName).toBe("test");
    expect(item.status).toBe("save_failed");
    expect(item.result).not.toBeNull();
    expect(item.result?.finalReport).toBeDefined();
    expect(item.error).toBe("保存失败，请重试");
    expect(item.taskId).toBeNull();
    expect(item.batchMeta).not.toBeNull();
    expect(item.batchMeta?.batchIndex).toBe(1);
  });

  it("returns null for completely invalid input", () => {
    expect(sanitizeRun(null)).toBeNull();
    expect(sanitizeRun(undefined)).toBeNull();
    expect(sanitizeRun("string")).toBeNull();
    expect(sanitizeRun(123)).toBeNull();
    expect(sanitizeRun({})).toBeNull();
    expect(sanitizeRun({ version: "not-a-number" })).toBeNull();
  });

  it("caps queueItems at 3", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `item-${i}`,
      productName: `product-${i}`,
      status: "analyzed" as const,
      result: null,
      taskId: null,
      error: "",
      batchMeta: null,
    }));

    const result = sanitizeRun({
      version: 1,
      runId: "run-test",
      createdAt: Date.now(),
      input: "",
      batchId: "b1",
      queueItems: items,
      lastSavedTaskId: null,
      lastSavedProductName: "",
    });

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.queueItems).toHaveLength(3);
  });

  it("batchId set to null when queueItems empty after sanitization", () => {
    const result = sanitizeRun({
      version: 1,
      runId: "run-test",
      createdAt: Date.now(),
      input: "",
      batchId: "b1",
      queueItems: [],
      lastSavedTaskId: null,
      lastSavedProductName: "",
    });

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.batchId).toBeNull();
  });
});

/* ── stripLargeResult ─────────────────────────── */

describe("stripLargeResult", () => {
  it("preserves finalReport, sourcing, risk, summary, listing, costGuard, warnings", () => {
    const input = {
      ok: true,
      workflowId: "wf-1",
      productName: "test",
      status: "completed",
      finalReport: { finalVerdict: "ok", riskLevel: "green" },
      sourcing: { difficulty: "easy" },
      risk: { level: "low" },
      summary: { verdict: "good" },
      listing: { title: "Product Title" },
      costGuard: { aiStepsRequested: 4, aiStepsCompleted: 4, fallbackSteps: 0 },
      warnings: ["small warning"],
    };

    const result = stripLargeResult(input);
    expect(result.finalReport).toBeDefined();
    expect(result.sourcing).toBeDefined();
    expect(result.risk).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.listing).toBeDefined();
    expect(result.costGuard).toBeDefined();
    expect(result.warnings).toEqual(["small warning"]);
    expect(result.ok).toBe(true);
    expect(result.workflowId).toBe("wf-1");
    expect(result.productName).toBe("test");
    expect(result.status).toBe("completed");
  });

  it("removes provider raw response, debug, raw fields", () => {
    const input = {
      ok: true,
      workflowId: "wf-1",
      productName: "test",
      status: "completed",
      rawResponse: { huge: "payload" },
      providerRaw: "large string",
      rawSteps: [{ step1: "data" }],
      providerWarnings: ["ignore"],
      rawWarnings: ["also ignore"],
      debug: { trace: "stack" },
      _internal: "secret",
      _debugField: "hidden",
      finalReport: { finalVerdict: "ok" },
    };

    const result = stripLargeResult(input);

    expect(result.finalReport).toBeDefined();
    expect(result).not.toHaveProperty("rawResponse");
    expect(result).not.toHaveProperty("providerRaw");
    expect(result).not.toHaveProperty("rawSteps");
    expect(result).not.toHaveProperty("providerWarnings");
    expect(result).not.toHaveProperty("rawWarnings");
    expect(result).not.toHaveProperty("debug");
    expect(result).not.toHaveProperty("_internal");
    expect(result).not.toHaveProperty("_debugField");
  });

  it("recursively cleans nested step objects", () => {
    const input = {
      ok: true,
      sourcing: {
        ok: true,
        rawResponse: "should be removed",
        _debug: "also removed",
        difficulty: "easy",
        providerRaw: "nested raw",
      },
      risk: {
        ok: true,
        debug: { trace: "nested" },
        level: "low",
        providerWarnings: ["x"],
      },
    };

    const result = stripLargeResult(input);

    const sourcing = result.sourcing as Record<string, unknown>;
    expect(sourcing.difficulty).toBe("easy");
    expect(sourcing).not.toHaveProperty("rawResponse");
    expect(sourcing).not.toHaveProperty("_debug");
    expect(sourcing).not.toHaveProperty("providerRaw");

    const risk = result.risk as Record<string, unknown>;
    expect(risk.level).toBe("low");
    expect(risk).not.toHaveProperty("debug");
    expect(risk).not.toHaveProperty("providerWarnings");
  });
});

/* ── hasRunContent ────────────────────────────── */

describe("hasRunContent", () => {
  it("returns true when at least one item is analyzed, saved, or save_failed with result", () => {
    const run = {
      ...emptyWorkflowBatchRun,
      queueItems: [
        { id: "1", productName: "a", status: "queued" as const, result: null, taskId: null, error: "", batchMeta: null },
        { id: "2", productName: "b", status: "analyzed" as const, result: null, taskId: null, error: "", batchMeta: null },
      ],
    };
    expect(hasRunContent(run)).toBe(true);

    const run2 = { ...emptyWorkflowBatchRun, queueItems: [{ id: "1", productName: "a", status: "saved" as const, result: null, taskId: "t1", error: "", batchMeta: null }] };
    expect(hasRunContent(run2)).toBe(true);

    // save_failed with result → should restore
    const run3 = { ...emptyWorkflowBatchRun, queueItems: [{ id: "1", productName: "a", status: "save_failed" as const, result: { ok: true }, taskId: null, error: "保存失败", batchMeta: null }] };
    expect(hasRunContent(run3)).toBe(true);
  });

  it("returns false for save_failed without result", () => {
    const run = {
      ...emptyWorkflowBatchRun,
      queueItems: [
        { id: "1", productName: "a", status: "save_failed" as const, result: null, taskId: null, error: "保存失败", batchMeta: null },
      ],
    };
    expect(hasRunContent(run)).toBe(false);
  });

  it("returns false for pending/queued/failed/analyzing without result", () => {
    const run = {
      ...emptyWorkflowBatchRun,
      queueItems: [
        { id: "1", productName: "a", status: "queued" as const, result: null, taskId: null, error: "", batchMeta: null },
        { id: "2", productName: "b", status: "running" as const, result: null, taskId: null, error: "", batchMeta: null },
        { id: "3", productName: "c", status: "failed" as const, result: null, taskId: null, error: "err", batchMeta: null },
      ],
    };
    expect(hasRunContent(run)).toBe(false);
    expect(hasRunContent(emptyWorkflowBatchRun)).toBe(false);
  });
});

/* ── makeRunId ────────────────────────────────── */

describe("makeRunId", () => {
  it("generates a run- prefix id", () => {
    const id = makeRunId();
    expect(id).toMatch(/^run-\d+$/);
  });
});

/* ── Storage-dependent tests ──────────────────── */

const store = new Map<string, string>();

const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
};

vi.stubGlobal("window", { localStorage: mockLocalStorage });
vi.stubGlobal("localStorage", mockLocalStorage);

const runCache = await import("@/components/cross-border/workflowBatchRunCache");
const WORKFLOW_BATCH_RUN_KEY = runCache.WORKFLOW_BATCH_RUN_KEY;
const WORKFLOW_BATCH_RUN_TTL_MS = runCache.WORKFLOW_BATCH_RUN_TTL_MS;

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", { localStorage: mockLocalStorage });
  vi.stubGlobal("localStorage", mockLocalStorage);
});

describe("clearLocalRun", () => {
  it("removes WORKFLOW_BATCH_RUN_KEY from localStorage", () => {
    store.set(WORKFLOW_BATCH_RUN_KEY, "some data");
    runCache.clearLocalRun();
    expect(store.has(WORKFLOW_BATCH_RUN_KEY)).toBe(false);
  });

  it("does not throw when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("window", undefined);
    expect(() => runCache.clearLocalRun()).not.toThrow();
  });
});

describe("readLocalRun / writeLocalRun", () => {
  it("writes and reads a valid run", () => {
    const run = {
      ...emptyWorkflowBatchRun,
      version: 1,
      runId: "run-test",
      createdAt: Date.now(),
      input: "手机支架",
      queueItems: [
        { id: "1", productName: "手机支架", status: "analyzed" as const, result: { ok: true }, taskId: null, error: "", batchMeta: null },
      ],
    };

    const updatedAt = runCache.writeLocalRun(run);
    expect(updatedAt).not.toBeNull();
    expect(typeof updatedAt).toBe("number");

    const result = runCache.readLocalRun();
    expect(result.restored).toBe(true);
    expect(result.value.input).toBe("手机支架");
    expect(result.value.queueItems).toHaveLength(1);
    expect(result.value.queueItems[0].status).toBe("analyzed");
    expect(result.value.queueItems[0].result).toEqual({ ok: true });
  });

  it("expired run is not restored", () => {
    const now = Date.now();

    // Write a run manually with an old updatedAt
    const runPayload = JSON.stringify({
      version: 1,
      updatedAt: now - WORKFLOW_BATCH_RUN_TTL_MS - 1000, // expired
      value: {
        ...emptyWorkflowBatchRun,
        version: 1,
        runId: "run-expired",
        createdAt: now - WORKFLOW_BATCH_RUN_TTL_MS - 2000,
        input: "expired",
        queueItems: [
          { id: "1", productName: "test", status: "analyzed" as const, result: null, taskId: null, error: "", batchMeta: null },
        ],
      },
    });

    store.set(WORKFLOW_BATCH_RUN_KEY, runPayload);

    const result = runCache.readLocalRun();
    expect(result.restored).toBe(false);
  });

  it("corrupted JSON does not crash and returns fallback", () => {
    store.set(WORKFLOW_BATCH_RUN_KEY, "{not valid json");
    const result = runCache.readLocalRun();
    expect(result.restored).toBe(false);
  });
});
