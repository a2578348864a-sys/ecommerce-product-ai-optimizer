import "server-only";

import type { AccessContext } from "@/lib/server/accessPassword";
import {
  TaskResultJsonMutationError,
  mutateTaskResultJson,
} from "@/lib/server/taskResultJsonMutation";
import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
import { prisma } from "@/lib/server/db";

/**
 * 竞品 Evidence（competitor-evidence.v1）——最小合同见
 * docs/v3/changes/phase-2/competitor-evidence-contract.md。
 * 只允许人工添加（sourceKind=manual）；上限 5；按规范化 ASIN 去重；
 * 写入经 mutateTaskResultJson（writer 所有权 + 乐观并发）。
 */

export const COMPETITOR_EVIDENCE_SCHEMA = "competitor-evidence.v1" as const;
export const COMPETITOR_EVIDENCE_VERSION = 1 as const;
export const COMPETITOR_EVIDENCE_MAX_ASINS = 5 as const;
export const COMPETITOR_EVIDENCE_NAMESPACE = "competitorEvidence" as const;

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
const MAX_NOTE_LENGTH = 500;

export type CompetitorEvidenceActor = { mode: "owner" | "visitor"; actorRef: string };

export type CompetitorAsinEntry = {
  asin: string;
  sourceKind: "manual" | "browser_use";
  addedBy: CompetitorEvidenceActor;
  addedAt: string;
  note?: string;
  /** browser_use 自动采集的可追溯来源（无来源证据不可自动写入） */
  collectedBy?: { tool: "browser-use"; version: string };
  sourceUrl?: string;
  capturedAt?: string;
  reasonCodes?: string[];
  /** 轮 15：竞品 Amazon 详情页五点（reference-only，绝不写回当前商品属性；旧数据无此字段继续解析） */
  detailBullets?: {
    bullets: string[];
    capturedAt: string;
    sourceUrl: string | null;
  } | null;
};

export type CompetitorEvidenceV1 = {
  schema: typeof COMPETITOR_EVIDENCE_SCHEMA;
  version: typeof COMPETITOR_EVIDENCE_VERSION;
  candidateId: string | null;
  asins: CompetitorAsinEntry[];
  updatedAt: string;
};

export class CompetitorEvidenceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CompetitorEvidenceError";
  }
}

export function normalizeCompetitorAsin(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidCompetitorAsin(raw: string): boolean {
  return ASIN_PATTERN.test(normalizeCompetitorAsin(raw));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asIsoDate(value: unknown): string {
  const text = asString(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseEntry(value: unknown): CompetitorAsinEntry | null {
  if (!isRecord(value)) return null;
  const asin = normalizeCompetitorAsin(asString(value.asin));
  if (!ASIN_PATTERN.test(asin)) return null;
  const sourceKind = asString(value.sourceKind);
  if (sourceKind !== "manual" && sourceKind !== "browser_use") return null;
  const sourceUrl = value.sourceUrl === undefined ? undefined : asString(value.sourceUrl);
  const capturedAt = value.capturedAt === undefined ? undefined : asIsoDate(value.capturedAt);
  const collectedBy = value.collectedBy === undefined ? undefined : value.collectedBy;
  const reasonCodes = value.reasonCodes === undefined ? undefined : Array.isArray(value.reasonCodes)
    ? value.reasonCodes.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 9)
    : undefined;
  const detailBullets = value.detailBullets === undefined || value.detailBullets === null
    ? undefined
    : (() => {
        if (!isRecord(value.detailBullets)) return undefined;
        const rawBullets = value.detailBullets.bullets;
        if (!Array.isArray(rawBullets)) return undefined;
        const bullets = rawBullets.filter((b): b is string => typeof b === "string" && b.trim().length > 0)
          .map((b) => b.slice(0, 500)).slice(0, 5);
        if (bullets.length === 0) return undefined;
        const captured = asIsoDate(value.detailBullets.capturedAt);
        if (!captured) return undefined;
        const srcUrl = value.detailBullets.sourceUrl === undefined || value.detailBullets.sourceUrl === null
          ? null
          : asString(value.detailBullets.sourceUrl);
        return { bullets, capturedAt: captured, sourceUrl: srcUrl };
      })();
  if (sourceKind === "browser_use") {
    if (collectedBy === undefined) return null;
    if (!isRecord(collectedBy) || collectedBy.tool !== "browser-use") return null;
    if (typeof collectedBy.version !== "string" || !collectedBy.version) return null;
    if (!sourceUrl || !capturedAt) return null;
  }
  const actor = value.addedBy;
  if (!isRecord(actor)) return null;
  const mode = asString(actor.mode);
  if (mode !== "owner" && mode !== "visitor") return null;
  const actorRef = asString(actor.actorRef);
  if (!actorRef) return null;
  const addedAt = asIsoDate(value.addedAt);
  if (!addedAt) return null;
  const note = value.note === undefined ? undefined : asString(value.note).slice(0, MAX_NOTE_LENGTH);
  return {
    asin,
    sourceKind,
    addedBy: { mode, actorRef },
    addedAt,
    ...(note ? { note } : {}),
    ...(detailBullets ? { detailBullets } : {}),
    ...(sourceKind === "browser_use" && collectedBy !== undefined
      ? {
          collectedBy: { tool: "browser-use" as const, version: (collectedBy as { version: string }).version },
          sourceUrl: sourceUrl as string,
          capturedAt: capturedAt as string,
          ...(reasonCodes && reasonCodes.length > 0 ? { reasonCodes } : {}),
        }
      : {}),
  };
}

export function parseCompetitorEvidence(value: unknown): CompetitorEvidenceV1 | null {
  if (!isRecord(value)) return null;
  if (value.schema !== COMPETITOR_EVIDENCE_SCHEMA) return null;
  if (value.version !== COMPETITOR_EVIDENCE_VERSION) return null;
  if (!Array.isArray(value.asins)) return null;
  const asins: CompetitorAsinEntry[] = [];
  for (const item of value.asins) {
    const entry = parseEntry(item);
    if (!entry) return null;
    asins.push(entry);
  }
  const updatedAt = asIsoDate(value.updatedAt);
  if (!updatedAt) return null;
  return {
    schema: COMPETITOR_EVIDENCE_SCHEMA,
    version: COMPETITOR_EVIDENCE_VERSION,
    candidateId: value.candidateId === null || value.candidateId === undefined
      ? null
      : asString(value.candidateId),
    asins,
    updatedAt,
  };
}

export function emptyCompetitorEvidence(candidateId: string | null): CompetitorEvidenceV1 {
  return {
    schema: COMPETITOR_EVIDENCE_SCHEMA,
    version: COMPETITOR_EVIDENCE_VERSION,
    candidateId,
    asins: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function parseResultJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function readCompetitorEvidenceSnapshot(
  context: AccessContext,
  taskId: string,
): Promise<{ updatedAt: Date | string; resultJson: string; candidateId: string | null }> {
  if (context.mode === "demo") {
    if (!isSandboxTaskId(taskId)) {
      throw new CompetitorEvidenceError("not_found", 404, "任务不存在。");
    }
    const task = getSandboxTask(context.demoAccessId, taskId);
    if (!task) {
      throw new CompetitorEvidenceError("not_found", 404, "任务不存在。");
    }
    return {
      updatedAt: task.updatedAt,
      resultJson: task.resultJson,
      candidateId: null,
    };
  }
  if (isSandboxTaskId(taskId)) {
    throw new CompetitorEvidenceError("not_found", 404, "任务不存在。");
  }
  const task = await prisma.viralAnalysisRecord.findFirst({
    where: { id: taskId },
    select: { id: true, updatedAt: true, resultJson: true },
  });
  if (!task) {
    throw new CompetitorEvidenceError("not_found", 404, "任务不存在。");
  }
  return {
    updatedAt: task.updatedAt,
    resultJson: task.resultJson,
    candidateId: null,
  };
}

export async function getCompetitorEvidence(
  context: AccessContext,
  taskId: string,
): Promise<CompetitorEvidenceV1> {
  const snapshot = await readCompetitorEvidenceSnapshot(context, taskId);
  const result = parseResultJson(snapshot.resultJson);
  const raw = result[COMPETITOR_EVIDENCE_NAMESPACE];
  const parsed = raw === undefined ? null : parseCompetitorEvidence(raw);
  if (parsed === null) {
    return emptyCompetitorEvidence(snapshot.candidateId);
  }
  return parsed;
}

export async function addCompetitorAsin(input: {
  context: AccessContext;
  taskId: string;
  asin: string;
  note?: string;
  /** 轮 9：Browser Use 自动采集确认写入的必需可追溯来源（无来源不允许自动写入） */
  autoProvenance?: {
    collector: { tool: "browser-use"; version: string };
    sourceUrl: string;
    capturedAt: string;
    reasonCodes?: string[];
  };
  expectedStorageVersion?: {
    resultJsonHash: string;
    updatedAt: string;
  };
  /** 轮 15：竞品 Amazon 详情页五点（reference-only；写入前必须附 provenance） */
  detailBullets?: {
    bullets: string[];
    capturedAt: string;
    sourceUrl: string | null;
  } | null;
}): Promise<CompetitorEvidenceV1> {
  const normalized = normalizeCompetitorAsin(input.asin);
  if (!ASIN_PATTERN.test(normalized)) {
    throw new CompetitorEvidenceError("invalid_asin", 400, "ASIN 格式无效（应为 10 位大写字母数字）。");
  }
  const note = input.note === undefined ? undefined : input.note.trim().slice(0, MAX_NOTE_LENGTH);
  if (input.autoProvenance !== undefined) {
    if (!input.autoProvenance.collector || input.autoProvenance.collector.tool !== "browser-use"
      || typeof input.autoProvenance.collector.version !== "string" || !input.autoProvenance.collector.version) {
      throw new CompetitorEvidenceError("invalid_auto_provenance", 400, "自动采集来源信息缺失（collector）。");
    }
    const url = asString(input.autoProvenance.sourceUrl);
    const capturedAt = asIsoDate(input.autoProvenance.capturedAt);
    if (!url || !capturedAt) {
      throw new CompetitorEvidenceError("invalid_auto_provenance", 400, "自动采集来源信息缺失（sourceUrl/capturedAt）。");
    }
    input.autoProvenance = { collector: input.autoProvenance.collector, sourceUrl: url, capturedAt, reasonCodes: input.autoProvenance.reasonCodes };
  }
  try {
    const mutation = await mutateTaskResultJson({
      context: input.context,
      taskId: input.taskId,
      writer: "competitor-evidence",
      expectedStorageVersion: input.expectedStorageVersion,
      mutate: (current) => {
        const currentEvidence = parseCompetitorEvidence(current[COMPETITOR_EVIDENCE_NAMESPACE])
          ?? emptyCompetitorEvidence(null);
        if (currentEvidence.asins.some((entry) => entry.asin === normalized)) {
          throw new CompetitorEvidenceError(
            "duplicate_asin",
            400,
            "该 ASIN 已在竞品列表中。",
          );
        }
        if (currentEvidence.asins.length >= COMPETITOR_EVIDENCE_MAX_ASINS) {
          throw new CompetitorEvidenceError(
            "competitor_evidence_limit_exceeded",
            400,
            `竞品列表最多维护 ${COMPETITOR_EVIDENCE_MAX_ASINS} 个 ASIN。`,
          );
        }
        const isAuto = input.autoProvenance !== undefined;
        const nextEvidence: CompetitorEvidenceV1 = {
          ...currentEvidence,
          asins: [
            ...currentEvidence.asins,
            {
              asin: normalized,
              sourceKind: isAuto ? "browser_use" : "manual",
              addedBy: {
                mode: input.context.mode === "demo" ? "visitor" : "owner",
                actorRef: input.context.mode === "demo"
                  ? `visitor:${input.context.demoAccessId}`
                  : "owner:v1",
              },
              addedAt: new Date().toISOString(),
              ...(note ? { note } : {}),
              ...(isAuto ? {
                collectedBy: input.autoProvenance!.collector,
                sourceUrl: input.autoProvenance!.sourceUrl,
                capturedAt: input.autoProvenance!.capturedAt,
                ...(input.autoProvenance!.reasonCodes && input.autoProvenance!.reasonCodes.length > 0
                  ? { reasonCodes: input.autoProvenance!.reasonCodes.slice(0, 9) }
                  : {}),
              } : {}),
              ...(input.detailBullets && input.detailBullets.bullets.length > 0
                ? {
                    detailBullets: {
                      bullets: input.detailBullets.bullets.slice(0, 5),
                      capturedAt: asIsoDate(input.detailBullets.capturedAt) || new Date().toISOString(),
                      sourceUrl: input.detailBullets.sourceUrl,
                    },
                  }
                : {}),
            },
          ],
          updatedAt: new Date().toISOString(),
        };
        return {
          result: { ...current, [COMPETITOR_EVIDENCE_NAMESPACE]: nextEvidence },
          value: nextEvidence,
        };
      },
    });
    return mutation.value;
  } catch (error) {
    if (error instanceof CompetitorEvidenceError) throw error;
    if (error instanceof TaskResultJsonMutationError) {
      throw new CompetitorEvidenceError(error.code, error.status, error.message);
    }
    throw error;
  }
}

export async function removeCompetitorAsin(input: {
  context: AccessContext;
  taskId: string;
  asin: string;
  expectedStorageVersion?: {
    resultJsonHash: string;
    updatedAt: string;
  };
  /** 轮 15：竞品 Amazon 详情页五点（reference-only；写入前必须附 provenance） */
  detailBullets?: {
    bullets: string[];
    capturedAt: string;
    sourceUrl: string | null;
  } | null;
}): Promise<CompetitorEvidenceV1> {
  const normalized = normalizeCompetitorAsin(input.asin);
  try {
    const mutation = await mutateTaskResultJson({
      context: input.context,
      taskId: input.taskId,
      writer: "competitor-evidence",
      expectedStorageVersion: input.expectedStorageVersion,
      mutate: (current) => {
        const currentEvidence = parseCompetitorEvidence(current[COMPETITOR_EVIDENCE_NAMESPACE])
          ?? emptyCompetitorEvidence(null);
        const nextEvidence: CompetitorEvidenceV1 = {
          ...currentEvidence,
          asins: currentEvidence.asins.filter((entry) => entry.asin !== normalized),
          updatedAt: new Date().toISOString(),
        };
        return {
          result: { ...current, [COMPETITOR_EVIDENCE_NAMESPACE]: nextEvidence },
          value: nextEvidence,
        };
      },
    });
    return mutation.value;
  } catch (error) {
    if (error instanceof CompetitorEvidenceError) throw error;
    if (error instanceof TaskResultJsonMutationError) {
      throw new CompetitorEvidenceError(error.code, error.status, error.message);
    }
    throw error;
  }
}
