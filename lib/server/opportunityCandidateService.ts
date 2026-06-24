import { prisma } from "@/lib/server/db";
import type { Prisma } from "@prisma/client";

/* ── Types ─────────────────────────────────────── */

export type CandidateStatus = "pending" | "worth_analyzing" | "analyzed" | "paused" | "rejected";

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

export async function updateCandidate(
  id: string,
  update: CandidateUpdate,
): Promise<CandidateItem | null> {
  const existing = await prisma.opportunityCandidate.findUnique({ where: { id } });
  if (!existing) return null;

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

export async function deleteCandidate(id: string): Promise<boolean> {
  const existing = await prisma.opportunityCandidate.findUnique({ where: { id } });
  if (!existing) return false;
  await prisma.opportunityCandidate.delete({ where: { id } });
  return true;
}

export async function importLocalCandidates(
  items: CandidateInput[],
): Promise<{ imported: number; skipped: number }> {
  const result = await upsertCandidates(items);
  return { imported: result.created + result.updated, skipped: 0 };
}
