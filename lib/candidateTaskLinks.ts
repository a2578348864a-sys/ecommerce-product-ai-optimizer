/**
 * Phase Candidate-Status-M.1: Candidate ↔ Task link derivation.
 *
 * All functions are pure — no network, no env, no DB writes.
 * Links are derived from task.result.sourceMeta.candidateId.
 * Old tasks without resultJson / sourceMeta degrade gracefully.
 */

export type LinkedTaskInfo = {
  taskId: string;
  title: string;
  createdAt: string;
  source: string;
  sourceTitle?: string;
  analyzedName?: string;
};

export type CandidateSourceMeta = {
  candidateId?: string;
  sourceTitle?: string;
  originalName?: string;
  analyzedName?: string;
  entry?: string;
  from?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function createdAtTimestamp(value: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareLinkedTasksNewestFirst(a: LinkedTaskInfo, b: LinkedTaskInfo): number {
  const aTimestamp = createdAtTimestamp(a.createdAt);
  const bTimestamp = createdAtTimestamp(b.createdAt);

  if (aTimestamp !== null && bTimestamp !== null && aTimestamp !== bTimestamp) {
    return bTimestamp - aTimestamp;
  }
  if (aTimestamp !== null && bTimestamp === null) return -1;
  if (aTimestamp === null && bTimestamp !== null) return 1;
  return b.taskId.localeCompare(a.taskId);
}

/**
 * Extract candidate sourceMeta from a single task record.
 * Handles result being an object, JSON string, null, or absent.
 */
export function extractCandidateSourceMeta(task: {
  result?: unknown;
  title?: string | null;
  source?: string;
}): CandidateSourceMeta | null {
  const result = task.result;
  if (!isRecord(result)) return null;
  if (!isRecord(result.sourceMeta)) return null;

  const candidateId = text(result.sourceMeta.candidateId);
  const from = text(result.sourceMeta.from);
  // Only return if this task genuinely links to a candidate
  if (!candidateId || from !== "opportunity") return null;

  return {
    candidateId,
    sourceTitle: text(result.sourceMeta.sourceTitle) || text(result.sourceMeta.opportunitySource) || undefined,
    originalName: text(result.sourceMeta.originalName) || undefined,
    analyzedName: text(result.sourceMeta.analyzedName) || undefined,
    entry: text(result.sourceMeta.entry) || undefined,
    from,
  };
}

/**
 * Check whether a task record originated from the candidate pool.
 */
export function isTaskFromCandidate(task: {
  result?: unknown;
}): boolean {
  return extractCandidateSourceMeta(task) !== null;
}

/**
 * Build a map from candidateId → linked tasks.
 *
 * Tasks without a valid sourceMeta.candidateId are skipped.
 * Multiple tasks can link to the same candidateId.
 * Results are sorted by createdAt descending within each candidate group.
 */
export function buildCandidateTaskLinkMap(
  tasks: Array<{
    id: string;
    title?: string | null;
    createdAt?: string;
    source?: string;
    result?: unknown;
  }>,
): Map<string, LinkedTaskInfo[]> {
  const map = new Map<string, LinkedTaskInfo[]>();

  for (const task of tasks) {
    const meta = extractCandidateSourceMeta(task);
    if (!meta?.candidateId) continue;

    const info: LinkedTaskInfo = {
      taskId: task.id,
      title: text(task.title) || text(meta.analyzedName) || text(meta.originalName) || "未命名任务",
      createdAt: typeof task.createdAt === "string" ? task.createdAt : "",
      source: task.source || "",
      sourceTitle: meta.sourceTitle,
      analyzedName: meta.analyzedName,
    };

    const existing = map.get(meta.candidateId);
    if (existing) {
      existing.push(info);
      existing.sort(compareLinkedTasksNewestFirst);
    } else {
      map.set(meta.candidateId, [info]);
    }
  }

  return map;
}

const SAFE_TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

function canonicalTaskId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return SAFE_TASK_ID_PATTERN.test(normalized) ? normalized : null;
}

export function resolveCandidateTaskLinks<T extends { convertedTaskId?: unknown }>(
  candidate: T,
  snapshotLinks: readonly LinkedTaskInfo[],
): LinkedTaskInfo[] {
  const taskId = canonicalTaskId(candidate.convertedTaskId);
  if (!taskId) return [...snapshotLinks];

  const canonical = snapshotLinks.find((task) => task.taskId === taskId) ?? {
    taskId,
    title: "关联任务",
    createdAt: "",
    source: "",
  };
  const seen = new Set([taskId]);
  const resolved = [canonical];

  for (const task of snapshotLinks) {
    if (seen.has(task.taskId)) continue;
    seen.add(task.taskId);
    resolved.push(task);
  }

  return resolved;
}
