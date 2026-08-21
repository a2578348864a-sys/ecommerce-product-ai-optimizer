/**
 * V4 P1 — Research Run 公共契约类型（Lead 冻结，D6 in P1_CONTRACT）。
 *
 * 与项目书 schemas/research-run-state.schema.json（schemaVersion researchRun.v4）
 * 对齐的 TypeScript 视图；运行 id 采用 cuid（仓库惯例，book schema 的 format:uuid
 * 为提示性约束，见 P1_CONTRACT D5）。
 *
 * 本文件是公共契约：Graph、UI、API 均只依赖本文件导出，禁止散落裸字符串。
 */
import "server-only";

export const RESEARCH_RUN_SCHEMA_VERSION = "researchRun.v4" as const;
export const RESEARCH_GRAPH_VERSION = "research-graph.v4.1" as const;

export const RESEARCH_RUN_STATUSES = [
  "draft",
  "planning",
  "running",
  "waiting_human",
  "waiting_auth",
  "waiting_input",
  "paused_budget",
  "revising",
  "failed_recoverable",
  "failed_terminal",
  "cancelled",
  "completed",
] as const;
export type ResearchRunStatus = (typeof RESEARCH_RUN_STATUSES)[number];

export const RESEARCH_RUN_NODES = [
  "load_context",
  "validate_identity",
  "assess_gaps",
  "build_plan",
  "dispatch_tool",
  "validate_output",
  "merge_evidence",
  "detect_conflicts",
  "revise_plan",
  "synthesize_market",
  "gate_a",
  "supplier_research",
  "product_fact_gate",
  "commercial_check",
  "gate_b",
  "content_handoff",
  "content_skills",
  "content_review",
  "complete",
  "fail",
  "cancel",
] as const;
export type ResearchRunNode = (typeof RESEARCH_RUN_NODES)[number];

export const RESEARCH_RUN_MODES = ["local_live", "public_replay"] as const;
export type ResearchRunMode = (typeof RESEARCH_RUN_MODES)[number];

export const WAIT_KINDS = ["human_decision", "authentication", "input", "budget"] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];

export type ResearchRunWait = {
  kind: WaitKind;
  reasonCode: string;
  instructions?: string;
  requestedAt: string;
};

export const ERROR_CODES = [
  "AUTH_REQUIRED",
  "CAPTCHA_OR_BOT_CHECK",
  "WRONG_ENTITY",
  "DOM_CHANGED",
  "RATE_LIMITED",
  "TIMEOUT",
  "BUDGET_EXCEEDED",
  "SCHEMA_INVALID",
  "SOURCE_STALE",
  "PERMISSION_DENIED",
  "USER_CANCELLED",
  "UNKNOWN_RECOVERABLE",
  "TERMINAL_UNSUPPORTED",
] as const;
export type ResearchRunErrorCode = (typeof ERROR_CODES)[number];

export type ResearchRunError = {
  code: ResearchRunErrorCode;
  recoverable: boolean;
  safeMessage?: string;
  occurredAt: string;
};

export type ResearchBudget = {
  maxWallClockMs: number;
  maxBrowserSteps: number;
  maxLlmTokens: number;
  maxImageCalls: number;
  maxCost: number;
  currency: string;
  usedBrowserSteps: number;
  usedLlmTokens: number;
  usedImageCalls: number;
  usedCost: number;
};

export type ResearchRunCheckpoint = {
  checkpointId: string;
  businessRevision: number;
  createdAt: string;
};

export type ResearchRunState = {
  schemaVersion: typeof RESEARCH_RUN_SCHEMA_VERSION;
  runId: string;
  candidateId: string;
  ownerScope?: string;
  sandboxId?: string | null;
  mode: ResearchRunMode;
  status: ResearchRunStatus;
  currentNode: ResearchRunNode;
  revision: number;
  planRevision: number;
  automaticPlanRevisionCount: number;
  activeQuestionId?: string | null;
  activeToolCallId?: string | null;
  evidenceRevision: number;
  factRevision?: number | null;
  policyPackVersion?: string | null;
  budget: ResearchBudget;
  wait?: ResearchRunWait | null;
  checkpoint?: ResearchRunCheckpoint | null;
  lastError?: ResearchRunError | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

/** 结构化事件（不含模型私有思维链；D6）。 */
export type ResearchRunEvent = {
  seq: number;
  type:
    | "run_created"
    | "node_entered"
    | "node_completed"
    | "plan_created"
    | "plan_revised"
    | "tool_dispatched"
    | "tool_result_validated"
    | "evidence_merged"
    | "conflict_detected"
    | "waiting_human"
    | "human_decision"
    | "resumed"
    | "cancelled"
    | "budget_paused"
    | "failed"
    | "completed";
  node: ResearchRunNode;
  payloadJson: string;
  createdAt: string;
};

export type SideEffectJournalEntry = {
  id: string;
  runId: string;
  idempotencyKey: string;
  inputHash: string;
  action: string;
  status: "recorded" | "committed" | "skipped_duplicate" | "failed";
  detailJson: string;
  createdAt: string;
};

/** resume 动作载荷（API 契约 D9）。decision 支持通用 continue/stop 与书内权威 Gate 选项（human-decision.schema）。 */
export type ResumePayload =
  | { kind: "human_decision"; decision: "continue" | "stop" | "continue_sourcing" | "needs_information" | "abandon" | "content_ready" | "revise_product"; note?: string }
  | { kind: "input"; value: string }
  | { kind: "retry" };

/** 状态合法转换（简化判定表；终态不可再写）。 */
/** 默认预算（确定性；与 graph.initialBudget 同源，避免循环依赖）。 */
export function defaultResearchBudget(): ResearchBudget {
  return {
    maxWallClockMs: 120_000,
    maxBrowserSteps: 100,
    maxLlmTokens: 100_000,
    maxImageCalls: 20,
    maxCost: 10,
    currency: "USD",
    usedBrowserSteps: 0,
    usedLlmTokens: 0,
    usedImageCalls: 0,
    usedCost: 0,
  };
}

export function isTerminalStatus(status: ResearchRunStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "failed_terminal";
}

export function canTransit(from: ResearchRunStatus, to: ResearchRunStatus): boolean {
  if (isTerminalStatus(from)) return false;
  if (to === "cancelled") return from !== "completed";
  if (to === "failed_terminal") return from !== "completed";
  if (to === "failed_recoverable") return from !== "completed" && from !== "cancelled";
  if (to === "completed") return from !== "cancelled" && from !== "failed_terminal";
  return true;
}
