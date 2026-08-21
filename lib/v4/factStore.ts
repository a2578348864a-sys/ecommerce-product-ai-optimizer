/**
 * V4 P3 — V4FactRecord 存取 + SupplierClaim→ConfirmedFact validator（Lead 冻结）。
 * 追加式 revision；只有人工逐项确认才晋级；撤销产生新 revision，历史完整。
 */
import "server-only";

import { prisma } from "@/lib/server/db";

export type FactStatus = "confirmed" | "rejected" | "unknown" | "conflict" | "revoked";

export type FactRecord = {
  id: string;
  runId: string;
  candidateId: string;
  offerIdentity: string;
  variantKey: string;
  field: string;
  value: string;
  status: FactStatus;
  confirmationMethod: string | null;
  claimRefs: string[];
  documentRefs: string[];
  actor: string;
  revision: number;
  revokedByRevision: number | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type ConfirmFactInput = {
  runId: string;
  candidateId: string;
  offerIdentity: string;
  variantKey: string;
  field: string;
  value: string;
  status: FactStatus;
  confirmationMethod?: string | null;
  claimRefs?: string[];
  documentRefs?: string[];
  actor: string;
  detail?: Record<string, unknown>;
};

export type FactStoreDb = {
  v4FactRecord: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
  };
};

function parseRecord(row: Record<string, unknown>): FactRecord {
  return {
    id: String(row.id),
    runId: String(row.runId),
    candidateId: String(row.candidateId),
    offerIdentity: String(row.offerIdentity),
    variantKey: String(row.variantKey),
    field: String(row.field),
    value: String(row.value),
    status: String(row.status) as FactStatus,
    confirmationMethod: row.confirmationMethod ? String(row.confirmationMethod) : null,
    claimRefs: safeJsonArray(row.claimRefsJson),
    documentRefs: safeJsonArray(row.documentRefsJson),
    actor: String(row.actor),
    revision: Number(row.revision),
    revokedByRevision: row.revokedByRevision != null ? Number(row.revokedByRevision) : null,
    detail: safeJsonObject(row.detailJson),
    createdAt: String(row.createdAt),
  };
}

function safeJsonArray(v: unknown): string[] {
  try { const p = JSON.parse(String(v ?? "[]")); return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
}
function safeJsonObject(v: unknown): Record<string, unknown> {
  try { const p = JSON.parse(String(v ?? "{}")); return typeof p === "object" && p !== null ? p : {}; } catch { return {}; }
}

/** 计算某 (run, offer, variant) 下各 field 的当前 revision。 */
async function currentRevisions(db: FactStoreDb, runId: string, offerIdentity: string, variantKey: string, field: string): Promise<number> {
  const rows = await db.v4FactRecord.findMany({ where: { runId, offerIdentity, variantKey, field } });
  let max = 0;
  for (const r of rows) max = Math.max(max, Number(r.revision));
  return max;
}

/** 追加一条事实记录（自动 revision = 当前 max + 1；撤销时标记被撤销记录）。 */
export async function appendFact(db: FactStoreDb, input: ConfirmFactInput): Promise<FactRecord> {
  const current = await currentRevisions(db, input.runId, input.offerIdentity, input.variantKey, input.field);
  const revision = current + 1;
  const row = await db.v4FactRecord.create({
    data: {
      runId: input.runId,
      candidateId: input.candidateId,
      offerIdentity: input.offerIdentity,
      variantKey: input.variantKey,
      field: input.field,
      value: input.value,
      status: input.status,
      confirmationMethod: input.confirmationMethod ?? null,
      claimRefsJson: JSON.stringify(input.claimRefs ?? []),
      documentRefsJson: JSON.stringify(input.documentRefs ?? []),
      actor: input.actor,
      revision,
      revokedByRevision: null,
      detailJson: JSON.stringify(input.detail ?? {}),
    },
  });
  return parseRecord(row);
}

/** 撤销某条已确认事实 → 新 revision（status=revoked），原记录标记 revokedByRevision。 */
export async function revokeFact(db: FactStoreDb, input: { runId: string; offerIdentity: string; variantKey: string; field: string; actor: string; reason?: string }): Promise<FactRecord | null> {
  const current = await currentRevisions(db, input.runId, input.offerIdentity, input.variantKey, input.field);
  if (current === 0) return null;
  const rows = await db.v4FactRecord.findMany({ where: { runId: input.runId, offerIdentity: input.offerIdentity, variantKey: input.variantKey, field: input.field } });
  // 找到当前最新行并标记撤销（需要 update —— FactStoreDb 增加 update）
  const latest = rows.find((r) => Number(r.revision) === current);
  const withUpdate = db as FactStoreDb & { v4FactRecord: { update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>> } };
  if (latest && withUpdate.v4FactRecord.update) {
    await withUpdate.v4FactRecord.update({ where: { id: String(latest.id) }, data: { revokedByRevision: current + 1 } });
  }
  return appendFact(db, {
    runId: input.runId,
    candidateId: String(latest?.candidateId ?? ""),
    offerIdentity: input.offerIdentity,
    variantKey: input.variantKey,
    field: input.field,
    value: String(latest?.value ?? ""),
    status: "revoked",
    actor: input.actor,
    detail: { reason: input.reason ?? "" },
  });
}

/** 当前事实视图（每 field 最新一行；revoked 显示但标记）。 */
export async function currentFacts(db: FactStoreDb, runId: string, offerIdentity: string, variantKey: string): Promise<FactRecord[]> {
  const rows = await db.v4FactRecord.findMany({ where: { runId, offerIdentity, variantKey } });
  const byField = new Map<string, FactRecord>();
  for (const r of rows) {
    const rec = parseRecord(r);
    const prev = byField.get(rec.field);
    if (!prev || rec.revision > prev.revision) byField.set(rec.field, rec);
  }
  return [...byField.values()].sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * SupplierClaim → ConfirmedFact validator（D1）：
 * 自动晋级阻断 = 任何无 confirmationMethod 的确认请求失败；页面 304/宣传 claim 不得以
 * claimRefs 单方晋级；conflict 状态必须显式记录双方。
 */
export function validateFactConfirmation(input: ConfirmFactInput): { ok: true } | { ok: false; reason: string } {
  if (input.status === "confirmed" && !input.confirmationMethod) {
    return { ok: false, reason: "auto_promotion_blocked: confirmationMethod required" };
  }
  if (input.status === "confirmed" && (!input.claimRefs || input.claimRefs.length === 0) && (!input.documentRefs || input.documentRefs.length === 0)) {
    return { ok: false, reason: "auto_promotion_blocked: no claimRefs or documentRefs" };
  }
  if (input.status === "conflict") {
    if (!input.detail || typeof input.detail.otherValue === "undefined") {
      return { ok: false, reason: "conflict_requires_other_value" };
    }
  }
  return { ok: true };
}

/** prisma 包装（测试可注入）。 */
export function createPrismaFactStore(): FactStoreDb {
  return prisma as unknown as FactStoreDb;
}
