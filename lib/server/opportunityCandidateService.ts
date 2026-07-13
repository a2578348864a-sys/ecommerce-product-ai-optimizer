import { prisma } from "@/lib/server/db";
import type { Prisma } from "@prisma/client";
import {
  assertCandidateSourceUpdateAllowed,
  getCandidateSourceIntegrity,
  type CandidateSourceIntegrity,
} from "@/lib/candidateSourceIntegrity";
import {
  CandidateSourceSaveError,
  normalizeCandidateIdentity,
  parseStoredCandidateSourceMeta,
  type CandidateSaveItem,
} from "@/lib/server/candidateSourceSave";
import { buildCandidateEvidenceReview } from "@/lib/server/candidateEvidenceReview";

/* ── Types ─────────────────────────────────────── */

export type CandidateStatus = "pending" | "worth_analyzing" | "analyzed" | "paused" | "rejected";

export type CandidateDeleteResult = "deleted" | "not_found" | "linked_task";

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "worth_analyzing",
  "analyzed",
  "paused",
  "rejected",
]);

export function isValidCandidateStatus(value: unknown): value is CandidateStatus {
  return typeof value === "string" && VALID_STATUSES.has(value);
}

export type CandidateInput = {
  name: string;
  rawInput?: string;
  link?: string | null;
  score?: number;
  source?: string;
  keyword?: string;
  riskLevel?: string;
  riskLabel?: string;
  summaryLabel?: string;
  status?: CandidateStatus;
  sourceMetaJson?: string;
  analysisJson?: string;
  convertedTaskId?: string | null;
};

export type CandidateUpdate = {
  status?: CandidateStatus;
  convertedTaskId?: string | null;
  lastActionAt?: string;
  link?: string | null;
  score?: number;
  keyword?: string;
};

export type CandidateUpdatePolicyContext = {
  sourceReviewAcknowledged?: unknown;
  requestedFields?: readonly string[];
};

export type CandidateItem = {
  id: string;
  name: string;
  rawInput: string;
  link: string | null;
  score: number;
  source: string;
  keyword: string;
  riskLevel: string;
  riskLabel: string;
  summaryLabel: string;
  status: CandidateStatus;
  sourceMetaJson: string;
  analysisJson: string;
  convertedTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  lastActionAt: string | null;
  sourceIntegrity: CandidateSourceIntegrity;
};

export type CandidateListResult = {
  items: CandidateItem[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
};

/* ── Helpers ───────────────────────────────────── */

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeStatus(value: unknown): CandidateStatus {
  return isValidCandidateStatus(value) ? value : "pending";
}

function toCandidateItem(record: {
  id: string;
  name: string;
  rawInput: string;
  link: string | null;
  score: number;
  source: string;
  keyword: string;
  riskLevel: string;
  riskLabel: string;
  summaryLabel: string;
  status: string;
  sourceMetaJson: string;
  analysisJson: string;
  convertedTaskId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastActionAt: Date | null;
}): CandidateItem {
  return {
    id: record.id,
    name: record.name,
    rawInput: record.rawInput,
    link: record.link,
    score: record.score,
    source: record.source,
    keyword: record.keyword,
    riskLevel: record.riskLevel,
    riskLabel: record.riskLabel,
    summaryLabel: record.summaryLabel,
    status: normalizeStatus(record.status),
    sourceMetaJson: record.sourceMetaJson,
    analysisJson: record.analysisJson,
    convertedTaskId: record.convertedTaskId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    lastActionAt: record.lastActionAt?.toISOString() ?? null,
    sourceIntegrity: getCandidateSourceIntegrity(record.sourceMetaJson),
  };
}

/* ── Queries ───────────────────────────────────── */

export async function listCandidates(params: {
  status?: string;
  q?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}): Promise<CandidateListResult> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 100);
  const offset = Math.max(0, params.offset ?? 0);
  const status = params.status && isValidCandidateStatus(params.status) ? params.status : undefined;
  const q = text(params.q);

  const where: Prisma.OpportunityCandidateWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { name: { contains: q } } : {}),
  };

  const orderBy: Prisma.OpportunityCandidateOrderByWithRelationInput =
    params.sort === "score"
      ? { score: "desc" }
      : { updatedAt: "desc" };

  const [records, total] = await Promise.all([
    prisma.opportunityCandidate.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
    }),
    prisma.opportunityCandidate.count({ where }),
  ]);

  const nextOffset = offset + records.length;
  return {
    items: records.map(toCandidateItem),
    total,
    hasMore: nextOffset < total,
    nextOffset: nextOffset < total ? nextOffset : null,
  };
}

export async function upsertCandidates(inputs: CandidateInput[]): Promise<{
  items: CandidateItem[];
  created: number;
  updated: number;
}> {
  let created = 0;
  let updated = 0;
  const results: CandidateItem[] = [];

  for (const input of inputs) {
    const name = text(input.name);
    if (!name) continue;

    const existing = await prisma.opportunityCandidate.findFirst({
      where: { name: normalizeKey(name) },
    });

    if (existing) {
      // Update existing: refresh score/summary/risk but preserve manual status
      const updatedRecord = await prisma.opportunityCandidate.update({
        where: { id: existing.id },
        data: {
          score: clampScore(input.score ?? existing.score),
          rawInput: text(input.rawInput, existing.rawInput),
          link: input.link !== undefined ? (text(input.link) || null) : existing.link,
          source: text(input.source, existing.source),
          keyword: text(input.keyword, existing.keyword),
          riskLevel: text(input.riskLevel, existing.riskLevel),
          riskLabel: text(input.riskLabel, existing.riskLabel),
          summaryLabel: text(input.summaryLabel, existing.summaryLabel),
          ...(input.sourceMetaJson ? { sourceMetaJson: input.sourceMetaJson } : {}),
          ...(input.analysisJson ? { analysisJson: input.analysisJson } : {}),
          updatedAt: new Date(),
        },
      });
      results.push(toCandidateItem(updatedRecord));
      updated++;
    } else {
      const createdRecord = await prisma.opportunityCandidate.create({
        data: {
          name,
          rawInput: text(input.rawInput, name),
          link: text(input.link) || null,
          score: clampScore(input.score),
          source: text(input.source, "机会雷达"),
          keyword: text(input.keyword),
          riskLevel: text(input.riskLevel),
          riskLabel: text(input.riskLabel),
          summaryLabel: text(input.summaryLabel),
          status: isValidCandidateStatus(input.status) ? input.status : "pending",
          sourceMetaJson: input.sourceMetaJson || "{}",
          analysisJson: input.analysisJson || "{}",
          convertedTaskId: text(input.convertedTaskId) || null,
          lastActionAt: new Date(),
        },
      });
      results.push(toCandidateItem(createdRecord));
      created++;
    }
  }

  return { items: results, created, updated };
}

export async function saveSignedCandidates(inputs: CandidateSaveItem[]): Promise<{
  items: CandidateItem[];
  created: number;
  updated: 0;
  unchanged: number;
}> {
  return prisma.$transaction(async (tx) => {
    const existingRecords = await tx.opportunityCandidate.findMany();
    const existingByIdentity = new Map<string, typeof existingRecords>();
    for (const record of existingRecords) {
      const identity = normalizeCandidateIdentity(record.name);
      const matches = existingByIdentity.get(identity);
      if (matches) matches.push(record);
      else existingByIdentity.set(identity, [record]);
    }

    const decisions: Array<
      | { kind: "unchanged"; record: typeof existingRecords[number] }
      | { kind: "create"; input: CandidateSaveItem }
    > = [];
    let unchanged = 0;

    for (const input of inputs) {
      if (!input.evidenceHash || !/^[a-f0-9]{64}$/.test(input.evidenceHash)) {
        throw new CandidateSourceSaveError("candidate_batch_invalid", "Signed Candidate 缺少有效 Evidence Hash。");
      }
      const matches = existingByIdentity.get(normalizeCandidateIdentity(input.name)) ?? [];
      if (matches.length > 1) {
        throw new CandidateSourceSaveError("candidate_source_conflict", "候选池已有重复身份，无法安全写入。");
      }
      if (matches.length === 1) {
        const stored = parseStoredCandidateSourceMeta(matches[0].sourceMetaJson);
        if (stored.integrity !== "signed_source_v2" || stored.evidenceHash !== input.evidenceHash) {
          throw new CandidateSourceSaveError("candidate_source_conflict", "同名 Candidate 来源证据冲突。");
        }
        decisions.push({ kind: "unchanged", record: matches[0] });
        unchanged += 1;
      } else {
        decisions.push({ kind: "create", input });
      }
    }

    const items: CandidateItem[] = [];
    let created = 0;
    for (const decision of decisions) {
      if (decision.kind === "unchanged") {
        items.push(toCandidateItem(decision.record));
        continue;
      }
      const input = decision.input;
      const createdRecord = await tx.opportunityCandidate.create({
        data: {
          name: input.name,
          rawInput: input.rawInput,
          link: input.link,
          score: clampScore(input.score),
          source: input.source,
          keyword: input.keyword,
          riskLevel: input.riskLevel,
          riskLabel: input.riskLabel,
          summaryLabel: input.summaryLabel,
          status: "pending",
          sourceMetaJson: input.sourceMetaJson,
          analysisJson: input.analysisJson,
          convertedTaskId: null,
          lastActionAt: new Date(),
        },
      });
      items.push(toCandidateItem(createdRecord));
      created += 1;
    }

    return { items, created, updated: 0 as const, unchanged };
  });
}

export async function saveLegacyCandidates(inputs: CandidateSaveItem[]): Promise<{
  items: CandidateItem[];
  created: number;
  updated: number;
}> {
  return prisma.$transaction(async (tx) => {
    const existingRecords = await tx.opportunityCandidate.findMany();
    const existingByIdentity = new Map<string, typeof existingRecords>();
    for (const record of existingRecords) {
      const identity = normalizeCandidateIdentity(record.name);
      const matches = existingByIdentity.get(identity);
      if (matches) matches.push(record);
      else existingByIdentity.set(identity, [record]);
    }

    const batchIdentities = new Set<string>();
    const decisions: Array<
      | { kind: "update"; record: typeof existingRecords[number]; input: CandidateSaveItem }
      | { kind: "create"; input: CandidateSaveItem }
    > = [];
    for (const input of inputs) {
      const identity = normalizeCandidateIdentity(input.name);
      if (batchIdentities.has(identity)) {
        throw new CandidateSourceSaveError("candidate_source_conflict", "Legacy Candidate 批次包含重复身份。");
      }
      batchIdentities.add(identity);
      const matches = existingByIdentity.get(identity) ?? [];
      if (matches.length > 1) {
        throw new CandidateSourceSaveError("candidate_source_conflict", "候选池已有重复身份，无法安全写入。");
      }
      if (matches.length === 1) {
        const stored = parseStoredCandidateSourceMeta(matches[0].sourceMetaJson);
        if (stored.integrity === "signed_source_v2") {
          throw new CandidateSourceSaveError("candidate_source_conflict", "未验证来源不能覆盖已验证 Candidate。");
        }
        decisions.push({ kind: "update", record: matches[0], input });
      } else {
        decisions.push({ kind: "create", input });
      }
    }

    const items: CandidateItem[] = [];
    let created = 0;
    let updated = 0;
    for (const decision of decisions) {
      const input = decision.input;
      if (decision.kind === "update") {
        const updatedRecord = await tx.opportunityCandidate.update({
          where: { id: decision.record.id },
          data: {
            score: clampScore(input.score),
            rawInput: input.rawInput,
            link: input.link,
            source: input.source,
            keyword: input.keyword,
            riskLevel: input.riskLevel,
            riskLabel: input.riskLabel,
            summaryLabel: input.summaryLabel,
            sourceMetaJson: input.sourceMetaJson,
            analysisJson: input.analysisJson,
            status: "pending",
            lastActionAt: new Date(),
            updatedAt: new Date(),
          },
        });
        items.push(toCandidateItem(updatedRecord));
        updated += 1;
        continue;
      }
      const createdRecord = await tx.opportunityCandidate.create({
        data: {
          name: input.name,
          rawInput: input.rawInput,
          link: input.link,
          score: clampScore(input.score),
          source: input.source,
          keyword: input.keyword,
          riskLevel: input.riskLevel,
          riskLabel: input.riskLabel,
          summaryLabel: input.summaryLabel,
          status: input.status,
          sourceMetaJson: input.sourceMetaJson,
          analysisJson: input.analysisJson,
          convertedTaskId: input.convertedTaskId,
          lastActionAt: new Date(),
        },
      });
      items.push(toCandidateItem(createdRecord));
      created += 1;
    }
    return { items, created, updated };
  });
}

export async function updateCandidate(
  id: string,
  update: CandidateUpdate,
  policy: CandidateUpdatePolicyContext = {},
): Promise<CandidateItem | null> {
  const existing = await prisma.opportunityCandidate.findUnique({ where: { id } });
  if (!existing) return null;

  assertCandidateSourceUpdateAllowed({
    sourceMetaJson: existing.sourceMetaJson,
    reviewIntegrity: buildCandidateEvidenceReview(existing).integrity,
    currentStatus: existing.status,
    targetStatus: update.status,
    sourceReviewAcknowledged: policy.sourceReviewAcknowledged,
    requestedFields: policy.requestedFields ?? Object.keys(update),
  });

  const data: Prisma.OpportunityCandidateUpdateInput = {};

  if (update.status !== undefined) {
    if (!isValidCandidateStatus(update.status)) return null;
    data.status = update.status;
    data.lastActionAt = new Date();
  }

  if (update.convertedTaskId !== undefined) {
    data.convertedTaskId = text(update.convertedTaskId) || null;
  }

  if (update.link !== undefined) {
    data.link = text(update.link) || null;
  }

  if (update.score !== undefined) {
    data.score = clampScore(update.score);
  }

  if (update.keyword !== undefined) {
    data.keyword = text(update.keyword);
  }

  if (update.lastActionAt !== undefined) {
    data.lastActionAt = update.lastActionAt ? new Date(update.lastActionAt) : null;
  }

  const updated = await prisma.opportunityCandidate.update({ where: { id }, data });
  return toCandidateItem(updated);
}

export async function deleteCandidate(id: string): Promise<CandidateDeleteResult> {
  const deleted = await prisma.opportunityCandidate.deleteMany({
    where: { id, convertedTaskId: null },
  });
  if (deleted.count === 1) return "deleted";

  const remaining = await prisma.opportunityCandidate.findUnique({
    where: { id },
    select: { id: true },
  });
  return remaining ? "linked_task" : "not_found";
}

export async function importLocalCandidates(
  items: CandidateInput[],
): Promise<{ imported: number; skipped: number }> {
  const result = await upsertCandidates(items);
  return { imported: result.created + result.updated, skipped: 0 };
}
