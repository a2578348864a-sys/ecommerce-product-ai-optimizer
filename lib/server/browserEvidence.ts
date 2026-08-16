/**
 * V3.3 — Browser Evidence（browser-evidence.v1）合同与 namespace 读写
 *
 * 只保存"capturedAt 时页面观察值"（snapshot），不升级为业务事实。
 * 写入必须走 mutateTaskResultJson（writer 所有权 + 乐观并发）；读取 fail-soft。
 * 6 字段上限；ASIN mismatch hard reject；Wrong Entity = 0 硬门禁。
 */
import { randomUUID } from "node:crypto";
import type { AccessContext } from "@/lib/server/accessPassword";
import {
  TaskResultJsonMutationError,
  mutateTaskResultJson,
  type TaskResultJsonStorageVersionInput,
} from "@/lib/server/taskResultJsonMutation";
import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
import { prisma } from "@/lib/server/db";
import { getResearchTaskCandidateId } from "@/lib/productResearchImage";
import { parseAsinFromDetailUrl } from "@/tools/collectors/amazon/detail-page-extract";
import { resolveBrowserEvidenceAsinFromResultJson } from "@/lib/server/taskIdentityInheritance";
import type {
  AmazonDetailPageExtraction,
  AmazonDetailFieldValue,
} from "@/tools/collectors/amazon/detail-page-extract";

export const BROWSER_EVIDENCE_SCHEMA = "browser-evidence.v1" as const;
export const BROWSER_EVIDENCE_SNAPSHOT_LIMIT = 20;
/** 单快照序列化大小上限（有界存储：防 resultJson 无限增长） */
export const BROWSER_EVIDENCE_SNAPSHOT_MAX_BYTES = 16 * 1024;

export type BrowserEvidenceFieldStatus = "correct" | "unknown";

export type BrowserEvidenceField<T> = {
  value: T | null;
  status: BrowserEvidenceFieldStatus;
  reason: string | null;
  nature: "snapshot";
};

export type BrowserEvidenceSnapshot = {
  evidenceId: string;
  sourceType: "browser";
  sourceSite: "amazon";
  pageUrl: string;
  marketplace: string | null;
  locale: string | null;
  currency: "USD" | "JPY" | "other" | null;
  entityBinding: {
    bound: boolean;
    urlAsin: string | null;
    pageAsin: string | null;
    proof: {
      urlMatchesExpected: boolean;
      pageAnchorMatchesExpected: boolean;
      productContainerFound: boolean;
    };
  };
  collectorVersion: string;
  capturedAt: string;
  fields: {
    asin: BrowserEvidenceField<string>;
    title: BrowserEvidenceField<string>;
    price: BrowserEvidenceField<number>;
    bsr: BrowserEvidenceField<number>;
    rating: BrowserEvidenceField<number>;
    reviewCount: BrowserEvidenceField<number>;
  };
  failureReasons: string[];
  confirmedBy: { mode: "owner" | "visitor"; actorRef: string };
  confirmedAt: string;
};

export type BrowserEvidenceV1 = {
  schema: typeof BROWSER_EVIDENCE_SCHEMA;
  version: 1;
  candidateId: string | null;
  targetAsin: string | null;
  snapshots: BrowserEvidenceSnapshot[];
  updatedAt: string;
};

export type BrowserEvidenceSaveInput = {
  context: AccessContext;
  taskId: string;
  expectedStorageVersion: TaskResultJsonStorageVersionInput;
  snapshot: BrowserEvidenceSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function parseField<T>(value: unknown, validate?: (v: unknown) => v is T): BrowserEvidenceField<T> | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (status !== "correct" && status !== "unknown") return null;
  if (value.nature !== "snapshot") return null;
  const reason = value.reason === null ? null : text(value.reason, 120);
  if (value.reason !== null && reason === null) return null;
  const rawValue = value.value;
  if (rawValue !== null && validate && !validate(rawValue)) return null;
  if (status === "correct" && rawValue === null) return null;
  return {
    value: rawValue as T | null,
    status,
    reason,
    nature: "snapshot",
  };
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 严格解析已保存的 browserEvidence namespace；结构非法 → null */
export function parseBrowserEvidence(value: unknown): BrowserEvidenceV1 | null {
  if (!isRecord(value)) return null;
  if (value.schema !== BROWSER_EVIDENCE_SCHEMA || value.version !== 1) return null;
  const candidateId = value.candidateId == null ? null : text(value.candidateId, 120);
  if (value.candidateId != null && candidateId === null) return null;
  const targetAsin = value.targetAsin == null ? null : text(value.targetAsin, 32);
  if (value.targetAsin != null && targetAsin === null) return null;
  if (!Array.isArray(value.snapshots) || value.snapshots.length > BROWSER_EVIDENCE_SNAPSHOT_LIMIT) return null;
  const snapshots: BrowserEvidenceSnapshot[] = [];
  for (const raw of value.snapshots) {
    const snapshot = parseSnapshot(raw);
    if (!snapshot) return null;
    snapshots.push(snapshot);
  }
  const updatedAt = text(value.updatedAt, 40);
  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) return null;
  return {
    schema: BROWSER_EVIDENCE_SCHEMA,
    version: 1,
    candidateId,
    targetAsin,
    snapshots,
    updatedAt,
  };
}

function parseSnapshot(value: unknown): BrowserEvidenceSnapshot | null {
  if (!isRecord(value)) return null;
  // 有界存储（read fail-soft）：超限快照视为不可信，整体忽略
  try {
    if (JSON.stringify(value).length > BROWSER_EVIDENCE_SNAPSHOT_MAX_BYTES) return null;
  } catch {
    return null;
  }
  const evidenceId = text(value.evidenceId, 64);
  if (!evidenceId || !/^[a-z0-9-]{8,64}$/i.test(evidenceId)) return null;
  if (value.sourceType !== "browser" || value.sourceSite !== "amazon") return null;
  const pageUrl = text(value.pageUrl, 2048);
  const capturedAt = text(value.capturedAt, 40);
  const confirmedAt = text(value.confirmedAt, 40);
  const collectorVersion = text(value.collectorVersion, 80);
  const marketplace = value.marketplace === null ? null : text(value.marketplace, 64);
  const locale = value.locale === null ? null : text(value.locale, 40);
  if (value.marketplace !== null && marketplace === null) return null;
  if (value.locale !== null && locale === null) return null;
  const currency = value.currency;
  if (currency !== null && currency !== "USD" && currency !== "JPY" && currency !== "other") return null;
  if (!isRecord(value.entityBinding)) return null;
  const bound = value.entityBinding.bound === true;
  const urlAsin = value.entityBinding.urlAsin === null ? null : text(value.entityBinding.urlAsin, 32);
  const pageAsin = value.entityBinding.pageAsin === null ? null : text(value.entityBinding.pageAsin, 32);
  const proof = isRecord(value.entityBinding.proof)
    ? {
        urlMatchesExpected: value.entityBinding.proof.urlMatchesExpected === true,
        pageAnchorMatchesExpected: value.entityBinding.proof.pageAnchorMatchesExpected === true,
        productContainerFound: value.entityBinding.proof.productContainerFound === true,
      }
    : null;
  if (!proof) return null;
  if (!isRecord(value.fields)) return null;
  const asin = parseField<string>(value.fields.asin, (v): v is string => typeof v === "string");
  const title = parseField<string>(value.fields.title, (v): v is string => typeof v === "string");
  const price = parseField<number>(value.fields.price, isFiniteNumber);
  const bsr = parseField<number>(value.fields.bsr, isFiniteNumber);
  const rating = parseField<number>(value.fields.rating, isFiniteNumber);
  const reviewCount = parseField<number>(value.fields.reviewCount, isFiniteNumber);
  if (!asin || !title || !price || !bsr || !rating || !reviewCount) return null;
  if (!Array.isArray(value.failureReasons) || value.failureReasons.some((r) => typeof r !== "string")) return null;
  if (!isRecord(value.confirmedBy)) return null;
  const confirmedMode = value.confirmedBy.mode;
  if (confirmedMode !== "owner" && confirmedMode !== "visitor") return null;
  const actorRef = text(value.confirmedBy.actorRef, 120);
  if (!actorRef) return null;
  if (!pageUrl || !capturedAt || !confirmedAt || !collectorVersion) return null;
  if (Number.isNaN(Date.parse(capturedAt)) || Number.isNaN(Date.parse(confirmedAt))) return null;
  return {
    evidenceId,
    sourceType: "browser",
    sourceSite: "amazon",
    pageUrl,
    marketplace,
    locale,
    currency: currency as BrowserEvidenceSnapshot["currency"],
    entityBinding: { bound, urlAsin, pageAsin, proof },
    collectorVersion,
    capturedAt,
    fields: { asin, title, price, bsr, rating, reviewCount },
    failureReasons: value.failureReasons as string[],
    confirmedBy: { mode: confirmedMode, actorRef },
    confirmedAt,
  };
}

/** 从详情页提取结果构建快照（映射 6 字段 + 币种 + 绑定 + 失败原因） */
export function buildBrowserEvidenceSnapshot(input: {
  extraction: AmazonDetailPageExtraction;
  targetAsin: string;
  pageUrl: string;
  locale: string | null;
  collectorVersion: string;
  capturedAt: string;
  confirmedBy: { mode: "owner" | "visitor"; actorRef: string };
}): BrowserEvidenceSnapshot {
  const f = input.extraction.fields;
  const field = <T,>(value: AmazonDetailFieldValue): BrowserEvidenceField<T> => ({
    value: value.value as T | null,
    status: value.status,
    reason: value.reason,
    nature: "snapshot",
  });
  const failureReasons = Object.values(f)
    .map((item) => item.reason)
    .filter((reason): reason is string => reason !== null);
  const priceReason = f.price.reason;
  const currency: BrowserEvidenceSnapshot["currency"] = priceReason?.startsWith("currency_not_usd:")
    ? (priceReason.slice("currency_not_usd:".length) as BrowserEvidenceSnapshot["currency"])
    : f.price.value !== null ? "USD" : null;
  return {
    evidenceId: randomUUID(),
    sourceType: "browser",
    sourceSite: "amazon",
    pageUrl: input.pageUrl,
    marketplace: "amazon.com",
    locale: input.locale,
    currency,
    entityBinding: {
      bound: input.extraction.entityBound,
      urlAsin: input.extraction.urlAsin,
      pageAsin: input.extraction.pageAsin,
      proof: input.extraction.bindingProof,
    },
    collectorVersion: input.collectorVersion,
    capturedAt: input.capturedAt,
    fields: {
      asin: field<string>(f.asin),
      title: field<string>(f.title),
      price: field<number>(f.price),
      bsr: field<number>(f.bsr),
      rating: field<number>(f.rating),
      reviewCount: field<number>(f.reviews),
    },
    failureReasons,
    confirmedBy: input.confirmedBy,
    confirmedAt: input.capturedAt,
  };
}

/** 读取已保存的 browserEvidence（fail-soft：缺失/非法 → null，不报错） */
export async function readBrowserEvidence(
  context: AccessContext,
  taskId: string,
): Promise<BrowserEvidenceV1 | null> {
  const snapshot = await readBrowserEvidenceSnapshot(context, taskId);
  const result = parseResultJson(snapshot.resultJson);
  const raw = result[BROWSER_EVIDENCE_NAMESPACE];
  const parsed = raw === undefined ? null : parseBrowserEvidence(raw);
  if (parsed === null) return null;
  return parsed;
}

export async function readBrowserEvidenceSnapshot(
  context: AccessContext,
  taskId: string,
): Promise<{ updatedAt: Date | string; resultJson: string; candidateId: string | null }> {
  if (context.mode === "demo") {
    if (!isSandboxTaskId(taskId)) {
      throw new BrowserEvidenceError("not_found", 404, "任务不存在。");
    }
    const task = getSandboxTask(context.demoAccessId, taskId);
    if (!task) {
      throw new BrowserEvidenceError("not_found", 404, "任务不存在。");
    }
    return {
      updatedAt: task.updatedAt,
      resultJson: task.resultJson,
      candidateId: getResearchTaskCandidateId(parseResultJson(task.resultJson)),
    };
  }
  if (isSandboxTaskId(taskId)) {
    throw new BrowserEvidenceError("not_found", 404, "任务不存在。");
  }
  const task = await prisma.viralAnalysisRecord.findFirst({
    where: { id: taskId },
    select: { id: true, updatedAt: true, resultJson: true },
  });
  if (!task) {
    throw new BrowserEvidenceError("not_found", 404, "任务不存在。");
  }
  return {
    updatedAt: task.updatedAt,
    resultJson: task.resultJson,
    candidateId: getResearchTaskCandidateId(parseResultJson(task.resultJson)),
  };
}

/** 任务绑定的商品 ASIN（先 task.productUrl，仅 amazon.com 详情页 URL；缺失时回退
 *  resultJson 权威身份 candidateAnalysisContext.facts：仅 marketplace 明确为 US 系才返回；
 *  非 US 市场 fail-closed（collect 端固定导航 amazon.com））；无绑定 → null */
export async function readBrowserEvidenceTaskAsin(
  context: AccessContext,
  taskId: string,
): Promise<string | null> {
  if (context.mode === "demo") {
    if (!isSandboxTaskId(taskId)) return null;
    const task = getSandboxTask(context.demoAccessId, taskId);
    if (!task) return null;
    const fromUrl = parseAsinFromDetailUrl(task.productUrl ?? "");
    if (fromUrl) return fromUrl;
    return resolveBrowserEvidenceAsinFromResultJson(task.resultJson ?? "{}");
  }
  if (isSandboxTaskId(taskId)) return null;
  const task = await prisma.viralAnalysisRecord.findFirst({
    where: { id: taskId },
    select: { id: true, productUrl: true, resultJson: true },
  });
  if (!task) return null;
  const fromUrl = parseAsinFromDetailUrl(task.productUrl ?? "");
  if (fromUrl) return fromUrl;
  return resolveBrowserEvidenceAsinFromResultJson(task.resultJson ?? "{}");
}

/** 保存（追加快照；dedupe 幂等；上限 20；candidateId 以任务权威绑定为准） */
export async function saveBrowserEvidence(input: BrowserEvidenceSaveInput): Promise<{
  kind: "saved" | "duplicate";
  evidence: BrowserEvidenceV1;
  updatedAt: string;
}> {
  try {
    // write-hard 自校验（fail-closed）：任何结构非法/超白名单/超限快照 → 拒绝保存，不做自动清洗
    assertSnapshotWritable(input.snapshot);
    const snapshot = await readBrowserEvidenceSnapshot(input.context, input.taskId);
    const result = parseResultJson(snapshot.resultJson);
    const existing = parseBrowserEvidence(result[BROWSER_EVIDENCE_NAMESPACE]);
    const duplicate = existing?.snapshots.some((item) => (
      item.capturedAt === input.snapshot.capturedAt
      && item.pageUrl === input.snapshot.pageUrl
      && item.fields.asin.value === input.snapshot.fields.asin.value
    )) === true;

    const mutation = await mutateTaskResultJson({
      context: input.context,
      taskId: input.taskId,
      writer: "browser-evidence",
      expectedStorageVersion: input.expectedStorageVersion,
      mutate: (current) => {
        const prior = parseBrowserEvidence(current[BROWSER_EVIDENCE_NAMESPACE]);
        const priorCount = prior?.snapshots.length ?? 0;
        if (!duplicate && priorCount >= BROWSER_EVIDENCE_SNAPSHOT_LIMIT) {
          throw new BrowserEvidenceError(
            "browser_evidence_snapshot_limit",
            409,
            "浏览器证据快照已达上限（20），请先删除旧快照。",
          );
        }
        const nextSnapshots = duplicate
          ? (prior?.snapshots ?? [])
          : [input.snapshot, ...(prior?.snapshots ?? [])];
        const candidateId = snapshot.candidateId;
        const next: BrowserEvidenceV1 = {
          schema: BROWSER_EVIDENCE_SCHEMA,
          version: 1,
          candidateId,
          targetAsin: input.snapshot.fields.asin.value ?? input.snapshot.entityBinding.pageAsin,
          snapshots: nextSnapshots,
          updatedAt: new Date().toISOString(),
        };
        return {
          result: { ...current, [BROWSER_EVIDENCE_NAMESPACE]: next },
          value: { saved: !duplicate, next },
        };
      },
    });
    const saved = mutation.value as { saved: boolean; next: BrowserEvidenceV1 };
    return {
      kind: saved.saved ? "saved" : "duplicate",
      evidence: saved.next,
      updatedAt: mutation.updatedAt,
    };
  } catch (error) {
    if (error instanceof BrowserEvidenceError) throw error;
    if (error instanceof TaskResultJsonMutationError) {
      throw new BrowserEvidenceError(error.code, error.status, error.message);
    }
    throw error;
  }
}

export class BrowserEvidenceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BrowserEvidenceError";
  }
}

/**
 * 写入前结构自校验（fail-closed）：
 * - snapshot 必须是合法 browser-evidence.v1 结构（6 字段白名单、nature=snapshot、绑定 proof 完整）
 * - 序列化大小 ≤ BROWSER_EVIDENCE_SNAPSHOT_MAX_BYTES（有界存储）
 * 任何一条不满足 → 拒绝保存；绝不"自动清洗后继续保存"。
 */
function assertSnapshotWritable(snapshot: BrowserEvidenceSnapshot): void {
  // 1) 字段白名单（write-hard：超白名单字段 → 拒绝，不自动清洗）
  const fieldKeys = Object.keys(snapshot.fields);
  const whitelist = ["asin", "title", "price", "bsr", "rating", "reviewCount"];
  if (
    fieldKeys.length !== whitelist.length
    || whitelist.some((key) => !Object.prototype.hasOwnProperty.call(snapshot.fields, key))
  ) {
    throw new BrowserEvidenceError(
      "invalid_snapshot",
      422,
      "浏览器证据快照字段超白名单（仅允许 asin/title/price/bsr/rating/reviewCount 六项），已拒绝保存。",
    );
  }
  // 2) 实体绑定证明必须完整且全部成立（write-hard）
  const proof = snapshot.entityBinding.proof;
  if (!proof.urlMatchesExpected || !proof.pageAnchorMatchesExpected || !proof.productContainerFound) {
    throw new BrowserEvidenceError(
      "invalid_snapshot",
      422,
      "浏览器证据快照的实体绑定证明无效，已拒绝保存。",
    );
  }
  // 3) 有界存储：序列化大小上限
  let serializedLength: number;
  try {
    serializedLength = JSON.stringify(snapshot).length;
  } catch {
    throw new BrowserEvidenceError("invalid_snapshot", 422, "快照结构无法序列化，已拒绝保存。");
  }
  if (serializedLength > BROWSER_EVIDENCE_SNAPSHOT_MAX_BYTES) {
    throw new BrowserEvidenceError(
      "browser_evidence_payload_too_large",
      413,
      `单条浏览器证据快照超过大小上限（${BROWSER_EVIDENCE_SNAPSHOT_MAX_BYTES} 字节），已拒绝保存。`,
    );
  }
  // 4) 结构合法性（6 字段白名单 + nature=snapshot + 类型校验）——复用严格 parse 作为最终兜底
  const probe = parseBrowserEvidence({
    schema: BROWSER_EVIDENCE_SCHEMA,
    version: 1,
    candidateId: null,
    targetAsin: null,
    snapshots: [snapshot],
    updatedAt: new Date().toISOString(),
  });
  if (!probe || probe.snapshots.length !== 1) {
    throw new BrowserEvidenceError(
      "invalid_snapshot",
      422,
      "浏览器证据快照结构非法，已拒绝保存。",
    );
  }
}

function parseResultJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const BROWSER_EVIDENCE_NAMESPACE = "browserEvidence" as const;
