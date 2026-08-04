import { createHash } from "node:crypto";

/**
 * Creative Handoff Request Ledger — 合同外内部幂等账本。
 *
 * 位于 resultJson.creativeHandoffRequestLedger（与 creativeHandoff 并列），
 * 不位于 product-creative-handoff.v1 内部；只由 creative-handoff Writer 拥有；
 * Browser 永不返回。
 *
 * 冻结容量：32 条 / 24 KiB UTF-8。超过 fail-closed。
 */

export const CREATIVE_HANDOFF_REQUEST_LEDGER_SCHEMA = "creative-handoff-request-ledger.v1" as const;
export const CREATIVE_HANDOFF_REQUEST_LEDGER_NAMESPACE = "creativeHandoffRequestLedger" as const;
export const CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_ENTRIES = 32;
export const CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_UTF8_BYTES = 24 * 1024;

export const CREATIVE_HANDOFF_LEDGER_ACTIONS = ["create", "revoke"] as const;
export type CreativeHandoffLedgerAction = typeof CREATIVE_HANDOFF_LEDGER_ACTIONS[number];

export const CREATIVE_HANDOFF_LEDGER_OUTCOMES = ["created", "appended", "revoked"] as const;
export type CreativeHandoffLedgerOutcomeKind = typeof CREATIVE_HANDOFF_LEDGER_OUTCOMES[number];

export const CREATIVE_HANDOFF_REQUEST_KEY_SCHEMA = "creative-handoff-request-key.v1" as const;
export const CREATIVE_HANDOFF_REQUEST_FINGERPRINT_SCHEMA = "creative-handoff-request-fingerprint.v1" as const;

const HASH64 = /^[a-f0-9]{64}$/;

export type CreativeHandoffLedgerEntry = {
  requestKeyHash: string; // "sha256:<64hex>"
  requestFingerprint: string; // "sha256:<64hex>"
  action: CreativeHandoffLedgerAction;
  outcomeKind: CreativeHandoffLedgerOutcomeKind;
  outcomeRevision: number;
  recordedAt: string; // RFC3339
};

export type CreativeHandoffRequestLedgerV1 = {
  schema: typeof CREATIVE_HANDOFF_REQUEST_LEDGER_SCHEMA;
  version: 1;
  entries: CreativeHandoffLedgerEntry[];
};

export type CreativeHandoffLedgerLookup =
  | { kind: "replay"; entry: CreativeHandoffLedgerEntry }
  | { kind: "conflict"; entry: CreativeHandoffLedgerEntry }
  | { kind: "outcome_missing"; entry: CreativeHandoffLedgerEntry }
  | { kind: "fresh" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function isHashWithPrefix(value: unknown): boolean {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isSafeIntegerBetween(value: unknown, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

export function createEmptyRequestLedger(): CreativeHandoffRequestLedgerV1 {
  return { schema: CREATIVE_HANDOFF_REQUEST_LEDGER_SCHEMA, version: 1, entries: [] };
}

/**
 * 严格内部 Parser — exact keys、枚举、hash 格式、时间、Revision 整数。
 */
export function parseRequestLedger(value: unknown): CreativeHandoffRequestLedgerV1 | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ["schema", "version", "entries"])
    || value.schema !== CREATIVE_HANDOFF_REQUEST_LEDGER_SCHEMA
    || value.version !== 1
    || !Array.isArray(value.entries)
    || value.entries.length > CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_ENTRIES) {
    return null;
  }
  for (const raw of value.entries) {
    if (!isRecord(raw)
      || !hasExactKeys(raw, ["requestKeyHash", "requestFingerprint", "action", "outcomeKind", "outcomeRevision", "recordedAt"])
      || !isHashWithPrefix(raw.requestKeyHash)
      || !isHashWithPrefix(raw.requestFingerprint)
      || !CREATIVE_HANDOFF_LEDGER_ACTIONS.includes(raw.action as CreativeHandoffLedgerAction)
      || !CREATIVE_HANDOFF_LEDGER_OUTCOMES.includes(raw.outcomeKind as CreativeHandoffLedgerOutcomeKind)
      || !isSafeIntegerBetween(raw.outcomeRevision, 1, 10)
      || !isIsoDate(raw.recordedAt)) {
      return null;
    }
  }
  const ledger = {
    schema: CREATIVE_HANDOFF_REQUEST_LEDGER_SCHEMA,
    version: 1 as const,
    entries: value.entries.map((entry) => ({
      requestKeyHash: entry.requestKeyHash as string,
      requestFingerprint: entry.requestFingerprint as string,
      action: entry.action as CreativeHandoffLedgerAction,
      outcomeKind: entry.outcomeKind as CreativeHandoffLedgerOutcomeKind,
      outcomeRevision: entry.outcomeRevision as number,
      recordedAt: entry.recordedAt as string,
    })),
  };
  if (Buffer.byteLength(JSON.stringify(ledger), "utf8") > CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_UTF8_BYTES) return null;
  return ledger;
}

export class RequestLedgerError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RequestLedgerError";
  }
}

export function ledgerByteLength(ledger: unknown): number {
  return Buffer.byteLength(JSON.stringify(ledger), "utf8");
}

/**
 * 追加一条账本条目。容量校验失败 fail-closed（抛错，不静默淘汰）。
 */
export function appendRequestLedgerEntry(
  current: CreativeHandoffRequestLedgerV1 | null,
  entry: CreativeHandoffLedgerEntry,
): CreativeHandoffRequestLedgerV1 {
  const ledger = current ? parseRequestLedger(current) : createEmptyRequestLedger();
  if (!ledger) throw new RequestLedgerError("idempotency_ledger_invalid", 500, "幂等账本结构异常，已阻止写入。");
  if (ledger.entries.length >= CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_ENTRIES) {
    throw new RequestLedgerError("idempotency_ledger_capacity_exceeded", 422, "幂等账本已达上限。");
  }
  if (ledger.entries.some((item) => item.requestKeyHash === entry.requestKeyHash)) {
    throw new RequestLedgerError("idempotency_ledger_duplicate_key", 409, "幂等账本已存在该请求键。");
  }
  const next: CreativeHandoffRequestLedgerV1 = {
    schema: CREATIVE_HANDOFF_REQUEST_LEDGER_SCHEMA,
    version: 1,
    entries: [...ledger.entries, entry],
  };
  if (ledgerByteLength(next) > CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_UTF8_BYTES) {
    throw new RequestLedgerError("idempotency_ledger_capacity_exceeded", 422, "幂等账本大小已达上限。");
  }
  const parsed = parseRequestLedger(next);
  if (!parsed) throw new RequestLedgerError("idempotency_ledger_invalid", 500, "幂等账本写入失败。");
  return parsed;
}

// ─── Request Key Hash ─────────────────────────────

/**
 * requestKeyHash：服务端计算，绑定 subject kind + 内部主体 + taskId + action + requestId。
 * 只持久化 SHA-256 结果，不保存原始输入。
 */
export function buildRequestKeyHash(input: {
  subjectKind: "owner" | "visitor";
  subjectRef: string;
  taskId: string;
  action: CreativeHandoffLedgerAction;
  requestId: string;
}): string {
  const canonical = JSON.stringify({
    schema: CREATIVE_HANDOFF_REQUEST_KEY_SCHEMA,
    subjectKind: input.subjectKind,
    subjectRef: input.subjectRef,
    taskId: input.taskId,
    action: input.action,
    requestId: input.requestId,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

// ─── Request Fingerprint ──────────────────────────

/**
 * requestFingerprint：服务端对浏览器允许的语义字段 Canonical 后计算。
 * 不得包含当前时间、随机值、handoffId、actor、recordedAt、outcomeRevision。
 */
export function buildRequestFingerprint(input: {
  action: CreativeHandoffLedgerAction;
  // create
  selectedFactIds?: string[];
  creativePreferences?: Record<string, unknown>;
  expectedStorageVersion?: { resultJsonHash?: string; resultJson?: string; updatedAt: string | Date };
  expectedResearchRevision?: number;
  expectedCurrentHandoffRevision?: number;
  confirmed?: boolean;
  // revoke
  revokeReasonCode?: string;
}): string {
  const canonical = JSON.stringify({
    schema: CREATIVE_HANDOFF_REQUEST_FINGERPRINT_SCHEMA,
    action: input.action,
    selectedFactIds: (input.selectedFactIds ?? []).slice().sort(),
    creativePreferences: input.creativePreferences ?? undefined,
    expectedStorageVersion: input.expectedStorageVersion === undefined
      ? undefined
      : { ...input.expectedStorageVersion, updatedAt: new Date(input.expectedStorageVersion.updatedAt).toISOString() },
    expectedResearchRevision: input.expectedResearchRevision ?? undefined,
    expectedCurrentHandoffRevision: input.expectedCurrentHandoffRevision ?? undefined,
    confirmed: input.confirmed ?? undefined,
    revokeReasonCode: input.revokeReasonCode ?? undefined,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * 查找 Ledger。
 * - 同 requestKeyHash + 同 fingerprint → replay
 * - 同 requestKeyHash + 不同 fingerprint → conflict
 * - 找不到 → fresh
 */
export function lookupRequestLedger(
  ledger: CreativeHandoffRequestLedgerV1,
  requestKeyHash: string,
  requestFingerprint: string,
): CreativeHandoffLedgerLookup {
  const entry = ledger.entries.find((item) => item.requestKeyHash === requestKeyHash);
  if (!entry) return { kind: "fresh" };
  if (entry.requestFingerprint === requestFingerprint) return { kind: "replay", entry };
  return { kind: "conflict", entry };
}
