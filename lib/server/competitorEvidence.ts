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
  sourceKind: "manual";
  addedBy: CompetitorEvidenceActor;
  addedAt: string;
  note?: string;
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
  if (sourceKind !== "manual") return null;
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
    sourceKind: "manual",
    addedBy: { mode, actorRef },
    addedAt,
    ...(note ? { note } : {}),
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
  expectedStorageVersion?: {
    resultJsonHash: string;
    updatedAt: string;
  };
}): Promise<CompetitorEvidenceV1> {
  const normalized = normalizeCompetitorAsin(input.asin);
  if (!ASIN_PATTERN.test(normalized)) {
    throw new CompetitorEvidenceError("invalid_asin", 400, "ASIN 格式无效（应为 10 位大写字母数字）。");
  }
  const note = input.note === undefined ? undefined : input.note.trim().slice(0, MAX_NOTE_LENGTH);
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
        const nextEvidence: CompetitorEvidenceV1 = {
          ...currentEvidence,
          asins: [
            ...currentEvidence.asins,
            {
              asin: normalized,
              sourceKind: "manual",
              addedBy: {
                mode: input.context.mode === "demo" ? "visitor" : "owner",
                actorRef: input.context.mode === "demo"
                  ? `visitor:${input.context.demoAccessId}`
                  : "owner:v1",
              },
              addedAt: new Date().toISOString(),
              ...(note ? { note } : {}),
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
