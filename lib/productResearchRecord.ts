import { createHash } from "node:crypto";
import {
  isProductResearchDecisionStatus,
  type ProductResearchDecisionStatus,
} from "@/lib/productResearchDecisionContract";

export {
  PRODUCT_RESEARCH_DECISION_OPTIONS,
  getProductResearchDecisionLabel,
  isProductResearchDecisionStatus,
  type ProductResearchDecisionStatus,
} from "@/lib/productResearchDecisionContract";

export const PRODUCT_RESEARCH_RECORD_SCHEMA = "product-research-record.v1" as const;
export const PRODUCT_RESEARCH_HASH_SCHEMA = "product-research-hash.v1" as const;
export const PRODUCT_RESEARCH_VERIFICATION_SCHEMA = "product-research-verification.v1" as const;
/** V3 Current Research Normalization：Research Completion 正式命名空间（resultJson 顶层，无 DB migration）。
 *  语义：同一 canonical Research Task 的 lifecycle 收口标记——completed = 本轮研究完成（最终人工判断可继续）；
 *  abandoned = 放弃研究。Evidence 原始数据不复制、不删除。 */
export const RESEARCH_COMPLETION_SCHEMA = "research-completion.v1" as const;

export type ResearchCompletionStatus = "completed" | "abandoned";

export type ResearchCompletionV1 = {
  schema: typeof RESEARCH_COMPLETION_SCHEMA;
  status: ResearchCompletionStatus;
  completedAt: string;
  decisionId: string;
  revision: number;
  finalStatus: ProductResearchDecisionStatus;
  /** V3 UX Closure：完成时记录的研究证据内容指纹（staleness 契约） */
  evidenceHash?: string;
  /**
   * V3 Research Staleness UX Closure：重新确认研究（reconfirm）时保留的上一版本完成快照。
   * 重新确认 = 创建 Completion Version N+1（revision+1、更新 completedAt/evidenceHash），
   * 历史 Version N 由 reconfirmedFrom 审计保留——不修改、不删除历史完成信息。
   */
  reconfirmedFrom?: {
    revision: number;
    completedAt: string;
    evidenceHash: string | null;
  };
};

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISITOR_ACTOR_PATTERN = /^visitor:[a-f0-9]{16}$/;
const MAX_TEXT_LENGTH = 1_000;
const MAX_EVENT_COUNT = 50;
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_REVISION = 1_000_000;

export type ProductResearchWorkflowStatus = "completed" | "partial_failed";

export type ProductResearchActor =
  | { mode: "owner"; actorRef: "owner:v1" }
  | { mode: "visitor"; actorRef: string };

export type ProductResearchReviewState = {
  sourcingReviewed: boolean;
  riskReviewed: boolean;
  summaryReviewed: boolean;
  listingReviewed: boolean;
  reviewedCount: number;
  totalReviewSteps: number;
  allReviewed: boolean;
};

export type ProductResearchDecisionInput = {
  decisionId: string;
  status: ProductResearchDecisionStatus;
  reason: string;
  nextAction?: string | null;
};

export type ProductResearchDecisionEvent = {
  decisionId: string;
  revision: number;
  status: ProductResearchDecisionStatus;
  reason: string;
  nextAction: string | null;
  researchHash: string;
  decidedAt: string;
  actor: ProductResearchActor;
};

type NormalizedDecision = Pick<
  ProductResearchDecisionEvent,
  "decisionId" | "status" | "reason" | "nextAction"
>;

export type ProductResearchRecordV1 = {
  schema: typeof PRODUCT_RESEARCH_RECORD_SCHEMA;
  revision: number;
  researchHash: string;
  candidateId: string;
  runId: string;
  contextHash: string;
  createdAt: string;
  updatedAt: string;
  latestDecision: ProductResearchDecisionEvent;
  decisionEvents: ProductResearchDecisionEvent[];
};

export type ProductResearchHashInput = {
  schema: typeof PRODUCT_RESEARCH_HASH_SCHEMA;
  candidateId: string;
  runId: string;
  contextHash: string;
  inputHash: string;
  resultHash: string;
  workflowStatus: ProductResearchWorkflowStatus;
  reviewState: ProductResearchReviewState;
};

export type ProductResearchVerificationV1 = Omit<ProductResearchHashInput, "schema"> & {
  schema: typeof PRODUCT_RESEARCH_VERIFICATION_SCHEMA;
};

export type ProductResearchDecisionSummary = {
  schema: typeof PRODUCT_RESEARCH_RECORD_SCHEMA;
  status: ProductResearchDecisionStatus;
  label: string;
  reasonSummary: string;
  nextActionSummary: string | null;
  revision: number;
  decidedAt: string;
  legacy: false;
};

export class ProductResearchRecordError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProductResearchRecordError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isBoundedIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 120;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_REVISION;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return "null";
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function normalizeText(value: unknown, field: "reason" | "nextAction", required: boolean): string | null {
  if (value === null || value === undefined) {
    if (required) throw new ProductResearchRecordError(`${field === "reason" ? "reason" : "next_action"}_required`, `${field} is required`);
    return null;
  }
  if (typeof value !== "string") {
    throw new ProductResearchRecordError(`invalid_${field}`, `${field} must be a string`);
  }
  const normalized = value.normalize("NFC").trim();
  if (!normalized) {
    if (required) throw new ProductResearchRecordError(`${field === "reason" ? "reason" : "next_action"}_required`, `${field} is required`);
    return null;
  }
  if (normalized.length > MAX_TEXT_LENGTH) {
    throw new ProductResearchRecordError(`${field}_too_long`, `${field} is too long`);
  }
  return normalized;
}

function parseActor(value: unknown): ProductResearchActor | null {
  if (!isRecord(value) || !hasExactKeys(value, ["mode", "actorRef"])) return null;
  if (value.mode === "owner" && value.actorRef === "owner:v1") {
    return { mode: "owner", actorRef: "owner:v1" };
  }
  if (value.mode === "visitor" && typeof value.actorRef === "string" && VISITOR_ACTOR_PATTERN.test(value.actorRef)) {
    return { mode: "visitor", actorRef: value.actorRef };
  }
  return null;
}

function parseDecisionEvent(value: unknown): ProductResearchDecisionEvent | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "decisionId",
    "revision",
    "status",
    "reason",
    "nextAction",
    "researchHash",
    "decidedAt",
    "actor",
  ])) return null;
  if (typeof value.decisionId !== "string" || !UUID_PATTERN.test(value.decisionId)) return null;
  if (!isRevision(value.revision) || !isHash(value.researchHash)) return null;
  if (!isProductResearchDecisionStatus(value.status)) return null;
  if (typeof value.reason !== "string" || !value.reason || value.reason !== value.reason.trim() || value.reason.length > MAX_TEXT_LENGTH) return null;
  if (value.nextAction !== null && (
    typeof value.nextAction !== "string"
    || !value.nextAction
    || value.nextAction !== value.nextAction.trim()
    || value.nextAction.length > MAX_TEXT_LENGTH
  )) return null;
  if (!isIsoDate(value.decidedAt)) return null;
  const actor = parseActor(value.actor);
  if (!actor) return null;
  return {
    decisionId: value.decisionId.toLowerCase(),
    revision: value.revision,
    status: value.status,
    reason: value.reason,
    nextAction: value.nextAction,
    researchHash: value.researchHash,
    decidedAt: value.decidedAt,
    actor,
  };
}

function normalizeDecision(input: ProductResearchDecisionInput): NormalizedDecision {
  if (typeof input.decisionId !== "string" || !UUID_PATTERN.test(input.decisionId)) {
    throw new ProductResearchRecordError("invalid_decision_id", "decisionId must be a UUID");
  }
  if (!isProductResearchDecisionStatus(input.status)) {
    throw new ProductResearchRecordError("invalid_decision_status", "decision status is invalid");
  }
  const reason = normalizeText(input.reason, "reason", true)!;
  const nextAction = normalizeText(input.nextAction, "nextAction", input.status === "needs_information");
  return {
    decisionId: input.decisionId.toLowerCase(),
    status: input.status,
    reason,
    nextAction,
  };
}

function validateDecisionForWorkflow(input: {
  decision: Pick<ProductResearchDecisionEvent, "status">;
  workflowStatus: ProductResearchWorkflowStatus;
  reviewState: ProductResearchReviewState;
}): void {
  if (input.workflowStatus === "partial_failed" && input.decision.status !== "needs_information") {
    throw new ProductResearchRecordError("partial_failed_requires_information", "partial_failed only allows needs_information");
  }
  // V3 Current Research Normalization：totalReviewSteps === 0 表示无 Agent workflow 复核流程
  // （candidate_research 等直接人工收集 Evidence 的当前 Research），creative_ready 无复核要求。
  if (input.reviewState.totalReviewSteps === 0) return;
  if (input.decision.status === "creative_ready" && (
    input.workflowStatus !== "completed"
    || input.reviewState.totalReviewSteps !== 4
    || input.reviewState.reviewedCount !== 4
    || !input.reviewState.sourcingReviewed
    || !input.reviewState.riskReviewed
    || !input.reviewState.summaryReviewed
    || !input.reviewState.listingReviewed
    || !input.reviewState.allReviewed
  )) {
    throw new ProductResearchRecordError("creative_ready_not_allowed", "creative_ready requires a completed run and four reviewed process steps");
  }
}

function sameDecisionPayload(
  event: ProductResearchDecisionEvent,
  input: NormalizedDecision,
): boolean {
  return event.decisionId === input.decisionId
    && event.status === input.status
    && event.reason.normalize("NFC") === input.reason
    && (event.nextAction === null
      ? input.nextAction === null
      : event.nextAction.normalize("NFC") === input.nextAction);
}

function assertRecordSize(record: ProductResearchRecordV1): void {
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > MAX_RECORD_BYTES) {
    throw new ProductResearchRecordError("research_record_too_large", "researchRecord exceeds 128 KiB");
  }
}

export function buildProductResearchActor(
  context: { mode: "owner" } | { mode: "demo"; demoAccessId: string },
): ProductResearchActor {
  if (context.mode === "owner") return { mode: "owner", actorRef: "owner:v1" };
  const digest = createHash("sha256").update(context.demoAccessId, "utf8").digest("hex").slice(0, 16);
  return { mode: "visitor", actorRef: `visitor:${digest}` };
}

export function buildProductResearchHash(input: ProductResearchHashInput): string {
  if (!parseProductResearchHashInput(input)) {
    throw new ProductResearchRecordError("invalid_research_hash_input", "research hash input is invalid");
  }
  return sha256Canonical(input);
}

export function createProductResearchVerification(
  input: ProductResearchHashInput,
): ProductResearchVerificationV1 {
  if (!parseProductResearchHashInput(input)) {
    throw new ProductResearchRecordError("invalid_research_hash_input", "research hash input is invalid");
  }
  const { schema: _schema, ...rest } = input;
  return { schema: PRODUCT_RESEARCH_VERIFICATION_SCHEMA, ...rest };
}

export function parseProductResearchHashInput(value: unknown): ProductResearchHashInput | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schema",
    "candidateId",
    "runId",
    "contextHash",
    "inputHash",
    "resultHash",
    "workflowStatus",
    "reviewState",
  ])) return null;
  if (value.schema !== PRODUCT_RESEARCH_HASH_SCHEMA) return null;
  if (!isBoundedIdentity(value.candidateId) || !isBoundedIdentity(value.runId)) return null;
  if (!isHash(value.contextHash) || !isHash(value.inputHash) || !isHash(value.resultHash)) return null;
  if (value.workflowStatus !== "completed" && value.workflowStatus !== "partial_failed") return null;
  const reviewState = parseProductResearchReviewState(value.reviewState);
  if (!reviewState) return null;
  return {
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId: value.candidateId,
    runId: value.runId,
    contextHash: value.contextHash,
    inputHash: value.inputHash,
    resultHash: value.resultHash,
    workflowStatus: value.workflowStatus,
    reviewState,
  };
}

export function parseProductResearchVerification(value: unknown): ProductResearchVerificationV1 | null {
  if (!isRecord(value) || value.schema !== PRODUCT_RESEARCH_VERIFICATION_SCHEMA) return null;
  const { schema: _schema, ...rest } = value;
  const parsed = parseProductResearchHashInput({ schema: PRODUCT_RESEARCH_HASH_SCHEMA, ...rest });
  if (!parsed) return null;
  const { schema: _hashSchema, ...verification } = parsed;
  return { schema: PRODUCT_RESEARCH_VERIFICATION_SCHEMA, ...verification };
}

export function parseProductResearchReviewState(value: unknown): ProductResearchReviewState | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "sourcingReviewed",
    "riskReviewed",
    "summaryReviewed",
    "listingReviewed",
    "reviewedCount",
    "totalReviewSteps",
    "allReviewed",
  ])) return null;
  const booleans = [
    value.sourcingReviewed,
    value.riskReviewed,
    value.summaryReviewed,
    value.listingReviewed,
    value.allReviewed,
  ];
  if (!booleans.every((item) => typeof item === "boolean")) return null;
  if (!Number.isSafeInteger(value.reviewedCount) || !Number.isSafeInteger(value.totalReviewSteps)) return null;
  // V3 Current Research Normalization：totalReviewSteps === 0 = 无 Agent workflow 复核流程
  // （candidate_research 等直接人工收集 Evidence 的当前 Research）；4 = 既有 Agent 复核步骤。
  if (value.totalReviewSteps === 0) {
    if (Number(value.reviewedCount) !== 0 || value.allReviewed !== true) return null;
    const noneReviewed = !value.sourcingReviewed && !value.riskReviewed && !value.summaryReviewed && !value.listingReviewed;
    if (!noneReviewed) return null;
    return {
      sourcingReviewed: false,
      riskReviewed: false,
      summaryReviewed: false,
      listingReviewed: false,
      reviewedCount: 0,
      totalReviewSteps: 0,
      allReviewed: true,
    };
  }
  if (Number(value.reviewedCount) < 0 || Number(value.reviewedCount) > 4 || value.totalReviewSteps !== 4) return null;
  const counted = [value.sourcingReviewed, value.riskReviewed, value.summaryReviewed, value.listingReviewed]
    .filter(Boolean).length;
  if (value.reviewedCount !== counted || value.allReviewed !== (counted === 4)) return null;
  return {
    sourcingReviewed: value.sourcingReviewed as boolean,
    riskReviewed: value.riskReviewed as boolean,
    summaryReviewed: value.summaryReviewed as boolean,
    listingReviewed: value.listingReviewed as boolean,
    reviewedCount: value.reviewedCount as number,
    totalReviewSteps: 4,
    allReviewed: value.allReviewed as boolean,
  };
}

export function createInitialProductResearchRecord(input: {
  candidateId: string;
  runId: string;
  contextHash: string;
  researchHash: string;
  workflowStatus: ProductResearchWorkflowStatus;
  reviewState: ProductResearchReviewState;
  decision: ProductResearchDecisionInput;
  actor: ProductResearchActor;
  now?: string;
}): ProductResearchRecordV1 {
  if (!isBoundedIdentity(input.candidateId) || !isBoundedIdentity(input.runId)) {
    throw new ProductResearchRecordError("invalid_research_binding", "candidateId or runId is invalid");
  }
  if (!isHash(input.contextHash) || !isHash(input.researchHash)) {
    throw new ProductResearchRecordError("invalid_research_hash", "research hash binding is invalid");
  }
  const actor = parseActor(input.actor);
  if (!actor) throw new ProductResearchRecordError("invalid_actor", "actor must be server-derived");
  const reviewState = parseProductResearchReviewState(input.reviewState);
  if (!reviewState) throw new ProductResearchRecordError("invalid_review_state", "review state is invalid");
  const normalized = normalizeDecision(input.decision);
  validateDecisionForWorkflow({ decision: normalized, workflowStatus: input.workflowStatus, reviewState });
  const now = input.now ?? new Date().toISOString();
  if (!isIsoDate(now)) throw new ProductResearchRecordError("invalid_decision_time", "server decision time is invalid");
  const event: ProductResearchDecisionEvent = {
    ...normalized,
    revision: 1,
    researchHash: input.researchHash,
    decidedAt: now,
    actor,
  };
  const record: ProductResearchRecordV1 = {
    schema: PRODUCT_RESEARCH_RECORD_SCHEMA,
    revision: 1,
    researchHash: input.researchHash,
    candidateId: input.candidateId,
    runId: input.runId,
    contextHash: input.contextHash,
    createdAt: now,
    updatedAt: now,
    latestDecision: event,
    decisionEvents: [event],
  };
  assertRecordSize(record);
  return record;
}

export function appendProductResearchDecision(input: {
  record: ProductResearchRecordV1;
  expectedRevision: number;
  workflowStatus: ProductResearchWorkflowStatus;
  reviewState: ProductResearchReviewState;
  decision: ProductResearchDecisionInput;
  actor: ProductResearchActor;
  now?: string;
}): { kind: "updated" | "idempotent"; record: ProductResearchRecordV1 } {
  const current = parseProductResearchRecord(input.record);
  if (!current) throw new ProductResearchRecordError("invalid_research_record", "research record is invalid");
  const actor = parseActor(input.actor);
  if (!actor) throw new ProductResearchRecordError("invalid_actor", "actor must be server-derived");
  const reviewState = parseProductResearchReviewState(input.reviewState);
  if (!reviewState) throw new ProductResearchRecordError("invalid_review_state", "review state is invalid");
  const normalized = normalizeDecision(input.decision);
  const duplicate = current.decisionEvents.find((event) => event.decisionId === normalized.decisionId);
  if (duplicate) {
    if (sameDecisionPayload(duplicate, normalized)) return { kind: "idempotent", record: current };
    throw new ProductResearchRecordError("decision_id_conflict", "decisionId was already used with a different payload");
  }
  if (!isRevision(input.expectedRevision) || input.expectedRevision !== current.revision) {
    throw new ProductResearchRecordError("revision_conflict", "the research record has changed");
  }
  if (current.revision >= MAX_REVISION) {
    throw new ProductResearchRecordError("revision_limit_reached", "research record revision limit reached");
  }
  if (current.decisionEvents.length >= MAX_EVENT_COUNT) {
    throw new ProductResearchRecordError("decision_history_limit_reached", "decision history limit reached");
  }
  validateDecisionForWorkflow({ decision: normalized, workflowStatus: input.workflowStatus, reviewState });
  const now = input.now ?? new Date().toISOString();
  if (!isIsoDate(now)) throw new ProductResearchRecordError("invalid_decision_time", "server decision time is invalid");
  const event: ProductResearchDecisionEvent = {
    ...normalized,
    revision: current.revision + 1,
    researchHash: current.researchHash,
    decidedAt: now,
    actor,
  };
  const record: ProductResearchRecordV1 = {
    ...current,
    revision: current.revision + 1,
    updatedAt: now,
    latestDecision: event,
    decisionEvents: [...current.decisionEvents, event],
  };
  assertRecordSize(record);
  return { kind: "updated", record };
}

/**
 * V3 Current Research Normalization：Research Completion 解析（fail-closed）。
 * evidenceHash（可选）：完成研究时记录的证据内容指纹（V3 UX Closure Staleness）。
 * 解析宽松保留该字段（不参与 hasExactKeys 校验），旧数据无此字段视为"未绑定版本"。
 */
export function parseResearchCompletion(value: unknown): ResearchCompletionV1 | null {
  if (!isRecord(value) || value.schema !== RESEARCH_COMPLETION_SCHEMA) return null;
  if (value.status !== "completed" && value.status !== "abandoned") return null;
  if (typeof value.completedAt !== "string" || !isIsoDate(value.completedAt)) return null;
  if (typeof value.decisionId !== "string" || !UUID_PATTERN.test(value.decisionId)) return null;
  if (!isRevision(value.revision)) return null;
  if (!isProductResearchDecisionStatus(value.finalStatus)) return null;
  const evidenceHash = typeof value.evidenceHash === "string" && HASH_PATTERN.test(value.evidenceHash)
    ? value.evidenceHash
    : null;
  // V3 Research Staleness UX Closure：reconfirmedFrom（上一版本完成快照）宽松解析保留
  let reconfirmedFrom: ResearchCompletionV1["reconfirmedFrom"];
  if (isRecord(value.reconfirmedFrom)) {
    const from = value.reconfirmedFrom;
    if (isRevision(from.revision)
      && typeof from.completedAt === "string" && isIsoDate(from.completedAt)
      && (from.evidenceHash === null || (typeof from.evidenceHash === "string" && HASH_PATTERN.test(from.evidenceHash)))) {
      reconfirmedFrom = {
        revision: from.revision,
        completedAt: from.completedAt,
        evidenceHash: typeof from.evidenceHash === "string" ? from.evidenceHash : null,
      };
    }
  }
  return {
    schema: RESEARCH_COMPLETION_SCHEMA,
    status: value.status,
    completedAt: value.completedAt,
    decisionId: value.decisionId.toLowerCase(),
    revision: value.revision,
    finalStatus: value.finalStatus,
    ...(evidenceHash ? { evidenceHash } : {}),
    ...(reconfirmedFrom ? { reconfirmedFrom } : {}),
  };
}

export function getResearchCompletion(value: unknown): ResearchCompletionV1 | null {
  if (!isRecord(value)) return null;
  return parseResearchCompletion(value.researchCompletion);
}

/** 参与证据指纹的证据命名空间（完成研究后新增/更新这些内容 → 研究状态需重新确认） */
const EVIDENCE_FINGERPRINT_NAMESPACES = [
  "browserEvidence",
  "reviewEvidence",
  "vocAnalysis",
  "sourcingEvidence",
  "keywordEvidence",
  "competitorEvidence",
  "aiEvidenceSummary",
  "candidateAnalysisContext",
  "factCandidates",
] as const;

/**
 * V3 Research Staleness UX Closure — STALENESS_POLICY（市场观察与重复证据敏感度）。
 *
 * 规则：
 * 1. DUPLICATE_EVIDENCE → NO_STALE：browserEvidence 快照指纹剥离 evidenceId/capturedAt/
 *    collectorVersion 等采集元数据——完全相同字段值重复采集/重复保存不触发 Stale。
 * 2. MARKET_OBSERVATION_VOLATILITY → NO_STALE：price/rating/reviewCount/bsr 属 Market
 *    Observation（市场状态观察），正常短期波动（如 BSR 5→4、价格小幅变化）不强制整个
 *    Research Stale。仅当快照的商品身份（asin/title）或商品规格证据（productInfo 规格行）
 *    变化时视为 MEANINGFUL_RESEARCH_CHANGE → STALE。
 * 3. 其余命名空间（review/voc/sourcing/keyword/competitor/aiSummary/context/factCandidates）
 *    语义内容变化 → STALE（新证据或事实变更）。
 *
 * 实现：快照先经 normalizeBrowserEvidenceForFingerprint 归一化（去采集元数据 + market
 * 观察字段值打平为固定占位），再进入 canonical hash——完成时与之后使用同一归一化，
 * 使「重复采集」与「市场波动」前后指纹一致（NO_STALE），而真实新证据/身份变化失配。
 */

/** Market Observation 字段（浏览器快照中）——波动不触发 Stale */
const BROWSER_MARKET_OBSERVATION_FIELDS = new Set(["price", "rating", "reviewCount", "bsr", "reviews"]);

/** 快照归一化：保留商品身份与规格证据；剥离采集元数据与市场观察值 */
function normalizeBrowserEvidenceForFingerprint(snapshot: unknown): unknown {
  if (!isRecord(snapshot)) return snapshot;
  const fields = isRecord(snapshot.fields) ? snapshot.fields : null;
  const normalizedFields: Record<string, unknown> = {};
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (BROWSER_MARKET_OBSERVATION_FIELDS.has(key)) {
        // 市场观察：仅保留字段存在性（值波动不参与指纹），新增/移除字段仍算变化
        normalizedFields[key] = "__market_observation__";
      } else {
        normalizedFields[key] = value;
      }
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (key === "evidenceId" || key === "capturedAt" || key === "collectorVersion") continue;
    out[key] = key === "fields" ? normalizedFields : value;
  }
  return out;
}

/** 浏览器证据命名空间归一化（供指纹）：快照数组逐项归一化 + 语义去重（同语义快照只计一次） */
function normalizeBrowserEvidenceForFingerprintNamespace(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === "snapshots" && Array.isArray(v)) {
      // 语义去重：相同归一化快照（如重复采集同商品页，仅 capturedAt/evidenceId 不同）
      // 只保留一个——「新增同语义采集」不改变指纹 → 不触发 Stale。
      const seen = new Set<string>();
      const unique: unknown[] = [];
      for (const snapshot of v) {
        const normalized = normalizeBrowserEvidenceForFingerprint(snapshot);
        const key2 = sha256Canonical(normalized);
        if (!seen.has(key2)) {
          seen.add(key2);
          unique.push(normalized);
        }
      }
      out[key] = unique;
    } else {
      out[key] = v;
    }
  }
  return out;
}

/**
 * V3 UX Closure — 计算研究证据内容指纹（canonical hash of evidence 命名空间）。
 * 完成研究时记录；之后证据命名空间的「语义内容」变化 → hash 失配 → NEEDS_RECONFIRMATION。
 * V3 Research Staleness UX Closure：browserEvidence 经 STALENESS_POLICY 归一化
 * （去采集元数据 + market observation 值打平）——重复采集/市场波动不触发 Stale。
 */
export function computeResearchEvidenceHash(result: Record<string, unknown> | null): string | null {
  if (!isRecord(result)) return null;
  const fingerprint: Record<string, unknown> = {};
  for (const key of EVIDENCE_FINGERPRINT_NAMESPACES) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      fingerprint[key] = key === "browserEvidence"
        ? normalizeBrowserEvidenceForFingerprintNamespace(result[key])
        : result[key];
    }
  }
  if (Object.keys(fingerprint).length === 0) return null;
  return sha256Canonical(fingerprint);
}

export type ResearchStaleState = {
  /** completion 是否存在（无 completion 无 stale 语义） */
  completed: boolean;
  /** 研究资料是否在完成研究后发生变化 */
  stale: boolean;
  /** 完成时记录的证据指纹（无则 null = 旧数据未绑定版本） */
  completionEvidenceHash: string | null;
  /** 当前证据指纹 */
  currentEvidenceHash: string | null;
};

/**
 * V3 UX Closure — 判定完成研究后的证据 stale 状态。
 * completion.evidenceHash 与当前 evidence hash 失配（或 completion 无 hash 而当前有证据变化）→ stale。
 * 旧数据（completion 无 evidenceHash）不自动视为 stale（兼容），仅在 completion 存在 hash 后启用。
 */
export function getResearchStaleState(result: Record<string, unknown> | null): ResearchStaleState {
  const completion = getResearchCompletion(result);
  if (!completion || completion.status !== "completed") {
    return { completed: false, stale: false, completionEvidenceHash: null, currentEvidenceHash: null };
  }
  const currentEvidenceHash = computeResearchEvidenceHash(result);
  const completionEvidenceHash = completion.evidenceHash ?? null;
  const stale = completionEvidenceHash !== null
    && currentEvidenceHash !== null
    && completionEvidenceHash !== currentEvidenceHash;
  return { completed: true, stale, completionEvidenceHash, currentEvidenceHash };
}

export type EvidenceChangeSinceCompletionItem = {
  /** 证据类型（命名空间中文名） */
  evidenceType: string;
  /** 来源（sourceSite / source 标记） */
  source: string;
  /** 捕获/更新时间 */
  capturedAt: string;
  /** 变化摘要（Changed Fields / New Evidence） */
  summary: string;
};

/**
 * V3 Research Staleness UX Closure — NEW_EVIDENCE_SINCE_LAST_COMPLETION 投影。
 * 基于 completion.completedAt 列出完成研究后新增/变更的证据（供重新确认 UI 展示）。
 * 只读、纯函数；不清空、不修改任何证据。
 */
export function describeEvidenceChangesSinceCompletion(
  result: Record<string, unknown> | null,
): EvidenceChangeSinceCompletionItem[] {
  if (!isRecord(result)) return [];
  const completion = getResearchCompletion(result);
  const since = completion?.completedAt;
  const items: EvidenceChangeSinceCompletionItem[] = [];
  if (!since) return items;

  // 1) browserEvidence：capturedAt 晚于 completion 的快照 = 新增采集
  const browser = isRecord(result.browserEvidence) ? result.browserEvidence : null;
  if (browser) {
    const snapshots = Array.isArray(browser.snapshots) ? browser.snapshots : [];
    for (const snap of snapshots) {
      if (!isRecord(snap)) continue;
      const capturedAt = typeof snap.capturedAt === "string" ? snap.capturedAt : "";
      if (!capturedAt || capturedAt <= since) continue;
      const fields = isRecord(snap.fields) ? snap.fields : null;
      const asin = fields && isRecord(fields.asin) && typeof fields.asin.value === "string"
        ? fields.asin.value
        : "";
      const changed: string[] = [];
      for (const key of ["title", "price", "rating", "reviewCount", "bsr", "reviews"]) {
        const f = fields && isRecord(fields[key]) ? fields[key] : null;
        if (f && f.value !== null && f.value !== undefined) changed.push(key);
      }
      items.push({
        evidenceType: "Amazon 页面证据",
        source: "browserEvidence",
        capturedAt,
        summary: `新增采集${asin ? `（ASIN ${asin}）` : ""}${changed.length > 0 ? `：${changed.join(" / ")}` : ""}`,
      });
    }
  }

  // 2) 其他证据命名空间：完成时不存在 / 之后出现的命名空间（存在性变化）
  const namespaceLabels: Array<[string, string]> = [
    ["reviewEvidence", "买家评论"],
    ["vocAnalysis", "VOC 分析"],
    ["sourcingEvidence", "供应线索"],
    ["keywordEvidence", "关键词证据"],
    ["competitorEvidence", "竞品证据"],
    ["aiEvidenceSummary", "AI 证据总结"],
  ];
  for (const [key, label] of namespaceLabels) {
    const value = result[key];
    if (value === undefined) continue;
    const updatedAt = isRecord(value) && typeof value.updatedAt === "string" ? value.updatedAt : "";
    if (updatedAt && updatedAt > since) {
      items.push({
        evidenceType: label,
        source: key,
        capturedAt: updatedAt,
        summary: "内容更新（Changed Fields / New Evidence）",
      });
    }
  }
  return items;
}

export function parseProductResearchRecord(value: unknown): ProductResearchRecordV1 | null {  if (!isRecord(value) || !hasExactKeys(value, [
    "schema",
    "revision",
    "researchHash",
    "candidateId",
    "runId",
    "contextHash",
    "createdAt",
    "updatedAt",
    "latestDecision",
    "decisionEvents",
  ])) return null;
  if (value.schema !== PRODUCT_RESEARCH_RECORD_SCHEMA || !isRevision(value.revision)) return null;
  if (!isHash(value.researchHash) || !isHash(value.contextHash)) return null;
  if (!isBoundedIdentity(value.candidateId) || !isBoundedIdentity(value.runId)) return null;
  if (!isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)) return null;
  if (!Array.isArray(value.decisionEvents) || value.decisionEvents.length < 1 || value.decisionEvents.length > MAX_EVENT_COUNT) return null;
  if (value.revision !== value.decisionEvents.length) return null;
  const events = value.decisionEvents.map(parseDecisionEvent);
  if (events.some((event) => !event)) return null;
  const parsedEvents = events as ProductResearchDecisionEvent[];
  if (new Set(parsedEvents.map((event) => event.decisionId)).size !== parsedEvents.length) return null;
  if (parsedEvents.some((event, index) => (
    event.revision !== index + 1 || event.researchHash !== value.researchHash
  ))) return null;
  const latestDecision = parseDecisionEvent(value.latestDecision);
  if (!latestDecision || canonicalJson(latestDecision) !== canonicalJson(parsedEvents.at(-1))) return null;
  const record: ProductResearchRecordV1 = {
    schema: PRODUCT_RESEARCH_RECORD_SCHEMA,
    revision: value.revision,
    researchHash: value.researchHash,
    candidateId: value.candidateId,
    runId: value.runId,
    contextHash: value.contextHash,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    latestDecision,
    decisionEvents: parsedEvents,
  };
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > MAX_RECORD_BYTES) return null;
  return record;
}

export function getProductResearchRecord(value: unknown): ProductResearchRecordV1 | null {
  if (!isRecord(value)) return null;
  return parseProductResearchRecord(value.researchRecord);
}

export function hasProductResearchRecordNamespace(value: unknown): boolean {
  return isRecord(value)
    && isRecord(value.researchRecord)
    && value.researchRecord.schema === PRODUCT_RESEARCH_RECORD_SCHEMA;
}

export function getProductResearchVerification(value: unknown): ProductResearchVerificationV1 | null {
  if (!isRecord(value)) return null;
  return parseProductResearchVerification(value.researchVerification);
}

export function verifyProductResearchHash(
  record: ProductResearchRecordV1,
  verification: ProductResearchVerificationV1,
): boolean {
  const { schema: _schema, ...rest } = verification;
  return record.candidateId === verification.candidateId
    && record.runId === verification.runId
    && record.contextHash === verification.contextHash
    && record.researchHash === buildProductResearchHash({ schema: PRODUCT_RESEARCH_HASH_SCHEMA, ...rest });
}

export function mergeProductResearchRecord(
  result: Record<string, unknown>,
  record: ProductResearchRecordV1,
  verification?: ProductResearchVerificationV1,
): Record<string, unknown> {
  return {
    ...result,
    researchRecord: record,
    ...(verification ? { researchVerification: verification } : {}),
  };
}

export function productResearchDecisionToCompatibilityStatus(
  status: ProductResearchDecisionStatus,
): "continue" | "need_info" | "rejected" {
  if (status === "creative_ready") return "continue";
  if (status === "needs_information") return "need_info";
  return "rejected";
}

export function toProductResearchDecisionSummary(
  record: ProductResearchRecordV1,
): ProductResearchDecisionSummary {
  const labels: Record<ProductResearchDecisionStatus, string> = {
    creative_ready: "进入创作准备",
    needs_information: "待补信息",
    abandoned: "放弃研究",
  };
  const summarize = (value: string | null) => value && value.length > 240 ? `${value.slice(0, 237)}...` : value;
  return {
    schema: PRODUCT_RESEARCH_RECORD_SCHEMA,
    status: record.latestDecision.status,
    label: labels[record.latestDecision.status],
    reasonSummary: summarize(record.latestDecision.reason) ?? "",
    nextActionSummary: summarize(record.latestDecision.nextAction),
    revision: record.revision,
    decidedAt: record.latestDecision.decidedAt,
    legacy: false,
  };
}
