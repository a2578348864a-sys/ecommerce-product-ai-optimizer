import { createHash } from "node:crypto";

export const PRODUCT_RESEARCH_RECORD_SCHEMA = "product-research-record.v1" as const;
export const PRODUCT_RESEARCH_HASH_SCHEMA = "product-research-hash.v1" as const;
export const PRODUCT_RESEARCH_VERIFICATION_SCHEMA = "product-research-verification.v1" as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISITOR_ACTOR_PATTERN = /^visitor:[a-f0-9]{16}$/;
const MAX_TEXT_LENGTH = 1_000;
const MAX_EVENT_COUNT = 50;
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_REVISION = 1_000_000;

export type ProductResearchDecisionStatus =
  | "creative_ready"
  | "needs_information"
  | "abandoned";

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
  const normalized = value.trim();
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
    && event.reason === input.reason
    && event.nextAction === input.nextAction;
}

function assertRecordSize(record: ProductResearchRecordV1): void {
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > MAX_RECORD_BYTES) {
    throw new ProductResearchRecordError("research_record_too_large", "researchRecord exceeds 128 KiB");
  }
}

export function isProductResearchDecisionStatus(value: unknown): value is ProductResearchDecisionStatus {
  return value === "creative_ready" || value === "needs_information" || value === "abandoned";
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

export function parseProductResearchRecord(value: unknown): ProductResearchRecordV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, [
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
