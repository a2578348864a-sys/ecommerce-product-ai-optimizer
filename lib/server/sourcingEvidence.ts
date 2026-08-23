/**
 * V3.5 — Sourcing Evidence 存储（sourcing-evidence.v1，writer 所有权）
 *
 * Contract §26/§27/§28/§29/§42/§43/§69：
 * - 复用 versioned taskResultJson（taskResultJson.sourcingEvidence），不新增 Prisma 表。
 * - Search Results ≠ Evidence：只有 Human Confirm 后才经 save 写入（§17/§43）。
 * - save 时服务端从 Preview Store 取回完整候选，客户端只传 previewId + selection（§69 server-side revalidate）。
 * - Preview Store 绑定 subjectKey（owner:v1 / visitor:{demoAccessId}）+ taskId，防跨主体/跨任务取用（§42/§44）。
 * - 敏感字段（receiveAddress / 账号标识）在 normalize 层已丢弃，此处不再次接触原始输出。
 */

import "server-only";

import { randomUUID } from "node:crypto";
import type { AccessContext } from "@/lib/server/accessPassword";
import {
  TaskResultJsonMutationError,
  mutateTaskResultJson,
} from "@/lib/server/taskResultJsonMutation";
import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
import { prisma } from "@/lib/server/db";
import {
  SOURCING_EVIDENCE_SCHEMA,
  type AcquisitionCandidate,
  type AcquisitionMethod,
  type AcquisitionRunTrace,
  type HumanConfirmedEntry,
  type SourcingEvidenceV1,
} from "@/lib/upstream/1688/contracts";

export const SOURCING_EVIDENCE_NAMESPACE = "sourcingEvidence" as const;

export class SourcingEvidenceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SourcingEvidenceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/** 严格解析已保存的 SourcingEvidenceV1（结构不满足 → null，fail-closed 不静默读坏数据） */
export function parseSourcingEvidence(value: unknown): SourcingEvidenceV1 | null {
  if (!isRecord(value)) return null;
  if (value.schema !== SOURCING_EVIDENCE_SCHEMA) return null;
  const taskId = asString(value.taskId);
  const capturedAt = asString(value.capturedAt);
  if (!taskId || !capturedAt) return null;
  if (!isRecord(value.acquisition)) return null;
  const method = value.acquisition.method;
  if (method !== "keyword" && method !== "image" && method !== "url") return null;
  if (!Array.isArray(value.candidates)) return null;
  if (!Array.isArray(value.humanConfirmed)) return null;
  for (const entry of value.humanConfirmed) {
    if (!isRecord(entry) || !/^\d{5,20}$/.test(asString(entry.offerId))) return null;
  }
  return {
    schema: SOURCING_EVIDENCE_SCHEMA,
    taskId,
    capturedAt,
    acquisition: {
      method,
      query: asString(value.acquisition.query),
      runTrace: isRecord(value.acquisition.runTrace)
        ? value.acquisition.runTrace as AcquisitionRunTrace
        : { source: "1688", method, query: "", timestamp: capturedAt, driverVersion: "unknown", resolverVersion: null, success: false, failClosedReason: "missing_trace" },
    },
    candidates: value.candidates as AcquisitionCandidate[],
    humanConfirmed: value.humanConfirmed as HumanConfirmedEntry[],
    updatedAt: asString(value.updatedAt),
  };
}

function parseResultJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function readSourcingEvidenceSnapshot(
  context: AccessContext,
  taskId: string,
): Promise<{ updatedAt: Date | string; resultJson: string }> {
  if (context.mode === "demo") {
    if (!isSandboxTaskId(taskId)) {
      throw new SourcingEvidenceError("not_found", 404, "任务不存在。");
    }
    const task = getSandboxTask(context.demoAccessId, taskId);
    if (!task) {
      throw new SourcingEvidenceError("not_found", 404, "任务不存在。");
    }
    return { updatedAt: task.updatedAt, resultJson: task.resultJson };
  }
  if (isSandboxTaskId(taskId)) {
    throw new SourcingEvidenceError("not_found", 404, "任务不存在。");
  }
  const task = await prisma.viralAnalysisRecord.findFirst({
    where: { id: taskId },
    select: { id: true, updatedAt: true, resultJson: true },
  });
  if (!task) {
    throw new SourcingEvidenceError("not_found", 404, "任务不存在。");
  }
  return { updatedAt: task.updatedAt, resultJson: task.resultJson };
}

export async function getSourcingEvidence(
  context: AccessContext,
  taskId: string,
): Promise<SourcingEvidenceV1 | null> {
  const snapshot = await readSourcingEvidenceSnapshot(context, taskId);
  const result = parseResultJson(snapshot.resultJson);
  const raw = result[SOURCING_EVIDENCE_NAMESPACE];
  if (raw === undefined) return null;
  return parseSourcingEvidence(raw);
}

/**
 * 保存 Sourcing Evidence（Human Confirm 后）。
 * 只保存 humanConfirmed 指定的候选；未确认候选不写入（Search Result ≠ Evidence）。
 */
export async function saveSourcingEvidence(input: {
  context: AccessContext;
  taskId: string;
  method: AcquisitionMethod;
  query: string;
  runTrace: AcquisitionRunTrace;
  candidates: AcquisitionCandidate[];
  confirmedOfferIds: string[];
  noteByOfferId?: Record<string, string>;
  expectedStorageVersion: { resultJsonHash: string; updatedAt: string };
}): Promise<SourcingEvidenceV1> {
  const confirmedSet = new Set(input.confirmedOfferIds.map((id) => id.trim()).filter((id) => /^\d{5,20}$/.test(id)));
  if (confirmedSet.size === 0) {
    throw new SourcingEvidenceError("no_confirmed_candidates", 400, "没有人工确认的候选，未保存任何证据。");
  }
  const confirmedCandidates = input.candidates.filter((candidate) => confirmedSet.has(candidate.offerId));
  if (confirmedCandidates.length !== confirmedSet.size) {
    throw new SourcingEvidenceError("candidate_mismatch", 400, "确认列表与服务端候选不一致，已拒绝保存。");
  }
  const now = new Date().toISOString();
  const newEntries: HumanConfirmedEntry[] = [...confirmedSet].map((offerId) => ({
    offerId,
    confirmedAt: now,
    note: input.noteByOfferId?.[offerId]?.trim().slice(0, 500) || null,
  }));
  try {
    const mutation = await mutateTaskResultJson({
      context: input.context,
      taskId: input.taskId,
      writer: "sourcing-evidence",
      expectedStorageVersion: input.expectedStorageVersion,
      mutate: (current) => {
        const existingRaw = current[SOURCING_EVIDENCE_NAMESPACE];
        const existing = parseSourcingEvidence(existingRaw);
        const candidates = [...(existing?.candidates ?? [])];
        const humanConfirmed = [...(existing?.humanConfirmed ?? [])];
        const seen = new Set(candidates.map((candidate) => candidate.offerId));
        for (const candidate of confirmedCandidates) {
          if (!seen.has(candidate.offerId)) {
            candidates.push(candidate);
            seen.add(candidate.offerId);
          }
        }
        for (const entry of newEntries) {
          const index = humanConfirmed.findIndex((item) => item.offerId === entry.offerId);
          if (index >= 0) humanConfirmed[index] = entry;
          else humanConfirmed.push(entry);
        }
        const next: SourcingEvidenceV1 = {
          schema: SOURCING_EVIDENCE_SCHEMA,
          taskId: input.taskId,
          capturedAt: existing?.capturedAt ?? now,
          acquisition: {
            method: input.method,
            query: input.query,
            runTrace: input.runTrace,
          },
          candidates,
          humanConfirmed,
          updatedAt: now,
        };
        return {
          result: { ...current, [SOURCING_EVIDENCE_NAMESPACE]: next },
          value: next,
        };
      },
    });
    return mutation.value;
  } catch (error) {
    if (error instanceof SourcingEvidenceError) throw error;
    if (error instanceof TaskResultJsonMutationError) {
      throw new SourcingEvidenceError(error.code, error.status, error.message);
    }
    throw error;
  }
}

// ── Preview Store（服务端内存暂存；TTL + 主体/任务绑定，防跨用户取用） ──

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const PREVIEW_MAX_ENTRIES = 64;

export type SourcingPreviewEntry = {
  previewId: string;
  subjectKey: string;
  taskId: string;
  method: AcquisitionMethod;
  query: string;
  runTrace: AcquisitionRunTrace;
  candidates: AcquisitionCandidate[];
  capturedAt: string;
  expiresAt: number;
};

export function sourcingPreviewSubjectKey(context: AccessContext): string {
  return context.mode === "demo" ? `visitor:${context.demoAccessId}` : "owner:v1";
}

class SourcingPreviewStore {
  private entries = new Map<string, SourcingPreviewEntry>();

  put(entry: SourcingPreviewEntry): string {
    this.prune();
    if (this.entries.size >= PREVIEW_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest === "string") this.entries.delete(oldest);
    }
    this.entries.set(entry.previewId, entry);
    return entry.previewId;
  }

  take(previewId: string, claim: { subjectKey: string; taskId: string }): SourcingPreviewEntry | null {
    this.prune();
    const entry = this.entries.get(previewId);
    if (!entry) return null;
    // 跨主体 / 跨任务一律不可用（fail-closed）
    if (entry.subjectKey !== claim.subjectKey || entry.taskId !== claim.taskId) return null;
    this.entries.delete(previewId);
    return entry;
  }

  /** 轮 14：peek 只读校验（不删除）——保存链在 CAS 成功前不得消耗预览。 */
  peek(previewId: string, claim: { subjectKey: string; taskId: string }): SourcingPreviewEntry | null {
    this.prune();
    const entry = this.entries.get(previewId);
    if (!entry) return null;
    if (entry.subjectKey !== claim.subjectKey || entry.taskId !== claim.taskId) return null;
    return entry;
  }

  /** 轮 14：consume 仅在保存成功调用（一次性作废）；未命中/主体不匹配返回 false。 */
  consume(previewId: string, claim: { subjectKey: string; taskId: string }): boolean {
    this.prune();
    const entry = this.entries.get(previewId);
    if (!entry) return false;
    if (entry.subjectKey !== claim.subjectKey || entry.taskId !== claim.taskId) return false;
    this.entries.delete(previewId);
    return true;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }
}

const previewStore = new SourcingPreviewStore();

export function createSourcingPreview(input: {
  context: AccessContext;
  taskId: string;
  method: AcquisitionMethod;
  query: string;
  runTrace: AcquisitionRunTrace;
  candidates: AcquisitionCandidate[];
}): SourcingPreviewEntry {
  const now = new Date().toISOString();
  const entry: SourcingPreviewEntry = {
    previewId: randomUUID(),
    subjectKey: sourcingPreviewSubjectKey(input.context),
    taskId: input.taskId,
    method: input.method,
    query: input.query,
    runTrace: input.runTrace,
    candidates: input.candidates,
    capturedAt: now,
    expiresAt: Date.now() + PREVIEW_TTL_MS,
  };
  previewStore.put(entry);
  return entry;
}

export function takeSourcingPreview(
  previewId: string,
  claim: { subjectKey: string; taskId: string },
): SourcingPreviewEntry | null {
  return previewStore.take(previewId, claim);
}

/** 轮 14：读取预览（不消耗）；CAS 成功前使用。 */
export function peekSourcingPreview(
  previewId: string,
  claim: { subjectKey: string; taskId: string },
): SourcingPreviewEntry | null {
  return previewStore.peek(previewId, claim);
}

/** 轮 14：保存成功后一次性作废预览。 */
export function consumeSourcingPreview(
  previewId: string,
  claim: { subjectKey: string; taskId: string },
): boolean {
  return previewStore.consume(previewId, claim);
}

/** 供测试：清空 preview store */
export function resetSourcingPreviewStoreForTests(): void {
  previewStore["entries"].clear();
}
