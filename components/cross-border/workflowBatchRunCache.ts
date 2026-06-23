/**
 * workflowBatchRunCache — localStorage-based analysis run persistence
 *
 * Responsibilities:
 * - Save full queueItems (with result/status/taskId) to WORKFLOW_BATCH_RUN_KEY
 * - Restore analysis results on page remount without re-calling AI
 * - Separate from WORKFLOW_BATCH_DRAFT_KEY which only saves input draft
 *
 * Dependencies: readLocalDraft / writeLocalDraft / clearLocalDraft from hooks/useLocalDraft
 */

import { clearLocalDraft, readLocalDraft, writeLocalDraft } from "@/hooks/useLocalDraft";

/* ── Types ────────────────────────────────────── */

export type QueueStatus = "queued" | "running" | "analyzed" | "saved" | "failed" | "save_failed";

export type WorkflowBatchRunItem = {
  id: string;
  productName: string;
  status: QueueStatus;
  result: Record<string, unknown> | null;
  taskId: string | null;
  error: string;
  batchMeta: {
    batchId: string;
    batchName: string;
    batchIndex: number;
    batchTotal: number;
    source: "workflow_batch_mvp";
  } | null;
};

export type WorkflowBatchRun = {
  version: number;
  runId: string;
  createdAt: number;
  input: string;
  batchId: string | null;
  queueItems: WorkflowBatchRunItem[];
  lastSavedTaskId: string | null;
  lastSavedProductName: string;
};

/* ── Constants ────────────────────────────────── */

export const WORKFLOW_BATCH_RUN_KEY = "qx:workflow-batch-run:v1";
export const WORKFLOW_BATCH_RUN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
export const WORKFLOW_BATCH_RUN_VERSION = 1;

export const emptyWorkflowBatchRun: WorkflowBatchRun = {
  version: WORKFLOW_BATCH_RUN_VERSION,
  runId: "",
  createdAt: 0,
  input: "",
  batchId: null,
  queueItems: [],
  lastSavedTaskId: null,
  lastSavedProductName: "",
};

/* ── Helpers ──────────────────────────────────── */

export function makeRunId() {
  return `run-${Date.now()}`;
}

/** True when the run contains at least one analyzed or saved item. */
export function hasRunContent(run: WorkflowBatchRun) {
  return run.queueItems.some(
    (item) => item.status === "analyzed" || item.status === "saved"
  );
}

/**
 * Strip provider raw response, debug fields, and large raw arrays from a
 * workflow result.  Keeps every field needed for UI rendering and save-task.
 *
 * Preserved:
 *  - finalReport, sourcing, risk, summary, listing
 *  - costGuard, warnings (small summary), status, ok, workflowId, productName
 *
 * Dropped:
 *  - rawResponse, providerRaw, debug, rawSteps, providerWarnings, rawWarnings,
 *    _debug, _raw, and any key starting with "_"
 */
export function stripLargeResult(result: Record<string, unknown>): Record<string, unknown> {
  const dropPrefixes = ["_", "debug", "raw"];
  const dropExact = new Set([
    "rawResponse",
    "providerRaw",
    "rawSteps",
    "providerWarnings",
    "rawWarnings",
  ]);

  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(result)) {
    // Drop keys matching exact blocklist
    if (dropExact.has(key)) continue;

    // Drop keys starting with forbidden prefixes
    if (dropPrefixes.some((p) => key.startsWith(p))) continue;

    // Recursively clean nested objects (but not arrays of primitives)
    if (value && typeof value === "object" && !Array.isArray(value)) {
      // Shallow-clean one level for known step objects
      const nested = value as Record<string, unknown>;
      const nestedCleaned: Record<string, unknown> = {};
      for (const [nk, nv] of Object.entries(nested)) {
        if (dropExact.has(nk)) continue;
        if (dropPrefixes.some((p) => nk.startsWith(p))) continue;
        nestedCleaned[nk] = nv;
      }
      cleaned[key] = nestedCleaned;
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidBatchMeta(value: unknown): value is WorkflowBatchRunItem["batchMeta"] {
  if (!isRecord(value)) return false;
  return (
    typeof value.batchId === "string"
    && typeof value.batchName === "string"
    && typeof value.batchIndex === "number"
    && typeof value.batchTotal === "number"
    && value.source === "workflow_batch_mvp"
  );
}

function isValidQueueStatus(value: unknown): value is QueueStatus {
  const valid: QueueStatus[] = [
    "queued", "running", "analyzed", "saved", "failed", "save_failed",
  ];
  return typeof value === "string" && (valid as string[]).includes(value);
}

/**
 * Validate and sanitize a run object read from localStorage.
 * Returns a clean run or null if the data is irrecoverably broken.
 */
export function sanitizeRun(raw: unknown): WorkflowBatchRun | null {
  try {
    if (!isRecord(raw)) return null;

    const version = raw.version;
    if (typeof version !== "number" || !Number.isFinite(version)) return null;

    const runId = typeof raw.runId === "string" ? raw.runId : "";
    const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : 0;
    const input = typeof raw.input === "string" ? raw.input.slice(0, 4000) : "";
    const batchId = typeof raw.batchId === "string" ? raw.batchId : null;
    const lastSavedTaskId = typeof raw.lastSavedTaskId === "string" ? raw.lastSavedTaskId : null;
    const lastSavedProductName = typeof raw.lastSavedProductName === "string" ? raw.lastSavedProductName : "";

    const queueItems: WorkflowBatchRunItem[] = [];

    if (Array.isArray(raw.queueItems)) {
      for (const item of raw.queueItems) {
        if (!isRecord(item)) continue;
        if (typeof item.id !== "string" || !item.id) continue;
        if (typeof item.productName !== "string" || !item.productName.trim()) continue;

        const status: QueueStatus = isValidQueueStatus(item.status) ? item.status : "queued";
        const taskId = typeof item.taskId === "string" ? item.taskId : null;
        const error = typeof item.error === "string" ? item.error : "";
        const batchMeta = isValidBatchMeta(item.batchMeta) ? item.batchMeta : null;

        let result: Record<string, unknown> | null = null;
        if (isRecord(item.result)) {
          result = stripLargeResult(item.result);
        }

        queueItems.push({
          id: item.id,
          productName: item.productName.trim(),
          status,
          result,
          taskId,
          error,
          batchMeta,
        });
      }
    }

    return {
      version,
      runId,
      createdAt,
      input,
      batchId: batchId && queueItems.length > 0 ? batchId : null,
      queueItems: queueItems.slice(0, 3), // max 3 items
      lastSavedTaskId,
      lastSavedProductName,
    };
  } catch {
    return null;
  }
}

/* ── Storage wrappers ─────────────────────────── */

export function readLocalRun() {
  return readLocalDraft<WorkflowBatchRun>(
    WORKFLOW_BATCH_RUN_KEY,
    emptyWorkflowBatchRun,
    { ttlMs: WORKFLOW_BATCH_RUN_TTL_MS, version: WORKFLOW_BATCH_RUN_VERSION },
  );
}

export function writeLocalRun(run: WorkflowBatchRun) {
  return writeLocalDraft(WORKFLOW_BATCH_RUN_KEY, run, {
    ttlMs: WORKFLOW_BATCH_RUN_TTL_MS,
    version: WORKFLOW_BATCH_RUN_VERSION,
  });
}

export function clearLocalRun() {
  clearLocalDraft(WORKFLOW_BATCH_RUN_KEY);
}
