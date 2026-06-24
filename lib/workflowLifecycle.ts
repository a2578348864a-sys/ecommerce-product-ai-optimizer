/**
 * Phase 4-E.2.1 — Workflow Task Product Lifecycle State Machine MVP
 *
 * Stores state in resultJson.productLifecycle — no schema changes, no new tables.
 * Pure functions + validation helpers.
 */

// ── Types ───────────────────────────────────────

export type LifecycleStatus =
  | "new_candidate"
  | "analysis_ready"
  | "analyzed"
  | "watching"
  | "ready_to_test"
  | "abandoned";

export type LifecycleReasonCode =
  | "workflow_saved"
  | "manual_watch"
  | "manual_ready_to_test"
  | "manual_abandon"
  | "weak_evidence"
  | "high_compliance_risk"
  | "ip_risk"
  | "low_margin"
  | "high_competition"
  | "supply_uncertain"
  | "logistics_risk"
  | "not_beginner_friendly"
  | "other";

export interface LifecycleHistoryEntry {
  from: string | null;
  to: string;
  reasonCode?: string;
  reasonText?: string;
  at: string;
  by: "user" | "system";
}

export interface ProductLifecycle {
  status: LifecycleStatus;
  statusLabel: string;
  reasonCode?: string;
  reasonText?: string;
  updatedAt: string;
  updatedBy: "user" | "system";
  source: "opportunity_candidate" | "workflow_task";
  history: LifecycleHistoryEntry[];
}

// ── Constants ───────────────────────────────────

const VALID_STATUSES: LifecycleStatus[] = [
  "new_candidate", "analysis_ready", "analyzed", "watching", "ready_to_test", "abandoned",
];

/** Legal state transitions */
const TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  new_candidate: ["analysis_ready", "abandoned"],
  analysis_ready: ["analyzed", "abandoned"],
  analyzed: ["watching", "ready_to_test", "abandoned"],
  watching: ["ready_to_test", "abandoned"],
  ready_to_test: ["abandoned"],
  abandoned: [], // terminal
};

const VALID_REASON_CODES: LifecycleReasonCode[] = [
  "workflow_saved", "manual_watch", "manual_ready_to_test", "manual_abandon",
  "weak_evidence", "high_compliance_risk", "ip_risk", "low_margin",
  "high_competition", "supply_uncertain", "logistics_risk", "not_beginner_friendly", "other",
];

const STATUS_LABELS: Record<LifecycleStatus, string> = {
  new_candidate: "新候选",
  analysis_ready: "待分析",
  analyzed: "已分析",
  watching: "观察中",
  ready_to_test: "准备测款",
  abandoned: "已放弃",
};

const STATUS_DESCRIPTIONS: Record<LifecycleStatus, string> = {
  new_candidate: "从机会来源识别出的商品线索，尚未进入正式分析。",
  analysis_ready: "候选商品信息基本完整，可以进入 workflow 分析。",
  analyzed: "已生成 AI 分析报告，等待人工复核和运营决策。",
  watching: "暂不进入测款，建议继续补充竞品、利润、货源、合规等证据。",
  ready_to_test: "初步通过，可以准备 listing、供应商确认、利润测算和小单测试计划。",
  abandoned: "该候选已停止推进，保留原因用于复盘，避免重复踩坑。",
};

const NEXT_ACTIONS: Record<LifecycleStatus, string> = {
  new_candidate: "补充商品信息后可以进入分析。",
  analysis_ready: "点击进入单品分析，获取 AI 评估报告。",
  analyzed: "先确认 sourcing / risk / summary / listing 四步结果，再选择观察、准备测款或放弃。",
  watching: "补充竞品、利润、供应商和合规信息。证据充分后可准备测款。",
  ready_to_test: "准备 listing 草稿、小单预算和供应商确认。如发现重大风险可放弃。",
  abandoned: "查看放弃原因，避免重复分析同类商品。",
};

const MAX_HISTORY = 20;

// ── Validation ──────────────────────────────────

export function isValidLifecycleStatus(value: unknown): value is LifecycleStatus {
  return typeof value === "string" && VALID_STATUSES.includes(value as LifecycleStatus);
}

export function isValidLifecycleReasonCode(value: unknown): value is LifecycleReasonCode {
  return typeof value === "string" && VALID_REASON_CODES.includes(value as LifecycleReasonCode);
}

export function isValidLifecycleTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  const allowed = TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

// ── Labels & Display ────────────────────────────

export function getLifecycleStatusLabel(status: LifecycleStatus): string {
  return STATUS_LABELS[status] || status;
}

export function getLifecycleStatusDescription(status: LifecycleStatus): string {
  return STATUS_DESCRIPTIONS[status] || "";
}

export function getLifecycleNextAction(status: LifecycleStatus): string {
  return NEXT_ACTIONS[status] || "请人工判断后续动作。";
}

/** Get available next states for a given status */
export function getAvailableTransitions(from: LifecycleStatus): LifecycleStatus[] {
  return TRANSITIONS[from] || [];
}

// ── Normalize / Parse ───────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeProductLifecycle(raw: unknown, fallbackStatus?: LifecycleStatus): ProductLifecycle | null {
  if (!isRecord(raw)) return null;

  const status = raw.status;
  if (!isValidLifecycleStatus(status)) return null;

  const now = new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : now;
  const updatedBy = raw.updatedBy === "user" ? "user" : "system";
  const source = raw.source === "opportunity_candidate" ? "opportunity_candidate" : "workflow_task";
  const reasonCode = isValidLifecycleReasonCode(raw.reasonCode) ? raw.reasonCode : undefined;
  const reasonText = typeof raw.reasonText === "string" ? raw.reasonText.slice(0, 300) : undefined;

  let history: LifecycleHistoryEntry[] = [];
  if (Array.isArray(raw.history)) {
    history = raw.history
      .filter((h): h is Record<string, unknown> => isRecord(h))
      .map((h) => ({
        from: typeof h.from === "string" ? h.from : null,
        to: typeof h.to === "string" ? h.to : "unknown",
        reasonCode: typeof h.reasonCode === "string" ? h.reasonCode : undefined,
        reasonText: typeof h.reasonText === "string" ? h.reasonText.slice(0, 300) : undefined,
        at: typeof h.at === "string" ? h.at : now,
        by: (h.by === "user" ? "user" : "system") as "user" | "system",
      }))
      .slice(-MAX_HISTORY);
  }

  return {
    status: status as LifecycleStatus,
    statusLabel: getLifecycleStatusLabel(status as LifecycleStatus),
    ...(reasonCode ? { reasonCode } : {}),
    ...(reasonText ? { reasonText } : {}),
    updatedAt,
    updatedBy,
    source,
    history,
  };
}

// ── Create / Transition ─────────────────────────

/** Create initial productLifecycle when a workflow task is saved */
export function createInitialProductLifecycle(): ProductLifecycle {
  const now = new Date().toISOString();
  return {
    status: "analyzed",
    statusLabel: "已分析",
    reasonCode: "workflow_saved",
    reasonText: "workflow 分析结果已保存为任务，等待人工复核和运营决策。",
    updatedAt: now,
    updatedBy: "system",
    source: "workflow_task",
    history: [
      {
        from: null,
        to: "analyzed",
        reasonCode: "workflow_saved",
        reasonText: "workflow 分析结果已保存为任务，等待人工复核和运营决策。",
        at: now,
        by: "system",
      },
    ],
  };
}

/** Transition productLifecycle to a new status with validation */
export function transitionLifecycle(
  current: ProductLifecycle | null,
  to: LifecycleStatus,
  reasonCode?: string,
  reasonText?: string,
): { ok: true; lifecycle: ProductLifecycle } | { ok: false; error: { code: string; message: string } } {
  const from: LifecycleStatus = current?.status || "analyzed"; // fallback for old tasks

  if (!isValidLifecycleStatus(to)) {
    return { ok: false, error: { code: "invalid_status", message: "无效的状态值。" } };
  }

  if (!isValidLifecycleTransition(from, to)) {
    return { ok: false, error: { code: "invalid_transition", message: `无法从「${getLifecycleStatusLabel(from)}」切换到「${getLifecycleStatusLabel(to)}」。` } };
  }

  if (reasonCode && !isValidLifecycleReasonCode(reasonCode)) {
    return { ok: false, error: { code: "invalid_reason_code", message: "无效的原因代码。" } };
  }

  if (reasonCode === "other" && (!reasonText || !reasonText.trim())) {
    return { ok: false, error: { code: "reason_text_required", message: "选择「其他」原因时，必须填写具体说明。" } };
  }

  const now = new Date().toISOString();
  const safeReasonText = reasonText ? reasonText.slice(0, 300) : undefined;

  const historyEntry: LifecycleHistoryEntry = {
    from,
    to,
    ...(reasonCode ? { reasonCode } : {}),
    ...(safeReasonText ? { reasonText: safeReasonText } : {}),
    at: now,
    by: "user",
  };

  const history = current?.history ? [...current.history, historyEntry].slice(-MAX_HISTORY) : [historyEntry];

  const lifecycle: ProductLifecycle = {
    status: to,
    statusLabel: getLifecycleStatusLabel(to),
    ...(reasonCode ? { reasonCode } : {}),
    ...(safeReasonText ? { reasonText: safeReasonText } : {}),
    updatedAt: now,
    updatedBy: "user",
    source: current?.source || "workflow_task",
    history,
  };

  return { ok: true, lifecycle };
}

/**
 * Derive a display lifecycle from task data.
 * Phase 4-E.2.1: Prefers persisted productLifecycle, falls back to frontend-derived.
 */
export function deriveDisplayLifecycle(
  result: unknown,
  reviewState: Record<string, unknown> | null,
  decisionStatus: string | null,
): ProductLifecycle | null {
  // 1) Persisted productLifecycle takes priority
  if (isRecord(result) && result.productLifecycle) {
    const parsed = normalizeProductLifecycle(result.productLifecycle);
    if (parsed) return parsed;
  }

  // 2) Fallback: derive basic analyzed state for workflow tasks
  if (isRecord(result) && (result.sourceMeta || result.finalReport || result.steps)) {
    const now = new Date().toISOString();
    return {
      status: "analyzed",
      statusLabel: "已分析",
      updatedAt: now,
      updatedBy: "system",
      source: "workflow_task",
      history: [],
    };
  }

  return null;
}
