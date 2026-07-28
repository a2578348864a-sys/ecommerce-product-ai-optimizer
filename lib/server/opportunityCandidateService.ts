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
import {
  ProductResearchImageConflictError,
  mergeCandidateProductImageSnapshot,
  readCandidateProductImageSnapshot,
} from "@/lib/productResearchImage";
import { buildCandidateEvidenceReview } from "@/lib/server/candidateEvidenceReview";
import { stableHash } from "@/lib/upstream/pipeline";

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

export type MarketScreeningCandidateIdentity = {
  schemaVersion: "market-screening-candidate-identity.v1";
  productionRegistrationId: string;
  batchManifestHash: string;
  manifestId: string;
  marketplace: string;
  productKey: string;
  asin: string;
  identityHash: string;
  evidenceHash: string;
};

export type MarketScreeningCandidateErrorCode =
  | "candidate_contract_invalid"
  | "candidate_identity_conflict"
  | "candidate_legacy_identity_conflict"
  | "candidate_evidence_conflict"
  | "candidate_has_linked_task"
  | "candidate_not_ready";

export class MarketScreeningCandidateError extends Error {
  constructor(
    public readonly code: MarketScreeningCandidateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MarketScreeningCandidateError";
  }
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : null;
}

function marketScreeningIdentityCore(input: {
  productionRegistrationId: string;
  batchManifestHash: string;
  manifestId: string;
  marketplace: string;
  productKey: string;
  asin: string;
}) {
  return {
    schemaVersion: "market-screening-candidate-identity.v1" as const,
    productionRegistrationId: input.productionRegistrationId,
    batchManifestHash: input.batchManifestHash,
    manifestId: input.manifestId,
    marketplace: input.marketplace,
    productKey: input.productKey,
    asin: input.asin,
  };
}

export function buildMarketScreeningCandidateIdentity(input: {
  productionRegistrationId: string;
  batchManifestHash: string;
  manifestId: string;
  marketplace: string;
  productKey: string;
  asin: string;
  evidenceHash: string;
}): MarketScreeningCandidateIdentity {
  const productionRegistrationId = text(input.productionRegistrationId);
  const batchManifestHash = sha256(input.batchManifestHash);
  const manifestId = text(input.manifestId);
  const marketplace = text(input.marketplace).toUpperCase();
  const productKey = text(input.productKey);
  const asin = text(input.asin).toUpperCase();
  const evidenceHash = sha256(input.evidenceHash);
  if (!productionRegistrationId
    || !batchManifestHash
    || !manifestId
    || !/^[A-Z]{2,8}$/u.test(marketplace)
    || !/^[A-Z0-9]{10}$/u.test(asin)
    || productKey !== `amazon:${marketplace}:${asin}`
    || !evidenceHash) {
    throw new MarketScreeningCandidateError(
      "candidate_contract_invalid",
      "市场筛选 Candidate 身份合同无效。",
    );
  }
  const core = marketScreeningIdentityCore({
    productionRegistrationId,
    batchManifestHash,
    manifestId,
    marketplace,
    productKey,
    asin,
  });
  return {
    ...core,
    identityHash: stableHash(core),
    evidenceHash,
  };
}

export function parseMarketScreeningCandidateIdentity(
  sourceMetaJson: string,
): MarketScreeningCandidateIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceMetaJson);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.marketScreeningIdentity)) return null;
  const stored = parsed.marketScreeningIdentity;
  if (stored.schemaVersion !== "market-screening-candidate-identity.v1") return null;
  try {
    const identity = buildMarketScreeningCandidateIdentity({
      productionRegistrationId: String(stored.productionRegistrationId ?? ""),
      batchManifestHash: String(stored.batchManifestHash ?? ""),
      manifestId: String(stored.manifestId ?? ""),
      marketplace: String(stored.marketplace ?? ""),
      productKey: String(stored.productKey ?? ""),
      asin: String(stored.asin ?? ""),
      evidenceHash: String(stored.evidenceHash ?? ""),
    });
    return stored.identityHash === identity.identityHash ? identity : null;
  } catch {
    return null;
  }
}

function hasRelevantInvalidMarketScreeningIdentity(
  sourceMetaJson: string,
  expected: MarketScreeningCandidateIdentity,
): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceMetaJson);
  } catch {
    return false;
  }
  if (!isRecord(parsed) || !isRecord(parsed.marketScreeningIdentity)) return false;
  const stored = parsed.marketScreeningIdentity;
  return stored.identityHash === expected.identityHash
    || (stored.productionRegistrationId === expected.productionRegistrationId
      && stored.productKey === expected.productKey);
}

export function resolveMarketScreeningCandidate<T extends {
  name: string;
  sourceMetaJson: string;
}>(
  candidates: readonly T[],
  displayName: string,
  expected: MarketScreeningCandidateIdentity,
): { kind: "reuse"; candidate: T } | { kind: "create" } {
  const validExpected = buildMarketScreeningCandidateIdentity(expected);
  if (validExpected.identityHash !== expected.identityHash) {
    throw new MarketScreeningCandidateError(
      "candidate_contract_invalid",
      "市场筛选 Candidate 身份 Hash 无效。",
    );
  }

  const identityMatches: Array<{
    candidate: T;
    identity: MarketScreeningCandidateIdentity;
  }> = [];
  let legacyTitleConflict = false;
  let relevantInvalidIdentityConflict = false;
  const normalizedTitle = normalizeCandidateIdentity(displayName);
  for (const candidate of candidates) {
    const identity = parseMarketScreeningCandidateIdentity(candidate.sourceMetaJson);
    if (identity?.identityHash === expected.identityHash) {
      identityMatches.push({ candidate, identity });
      continue;
    }
    if (!identity) {
      if (hasRelevantInvalidMarketScreeningIdentity(candidate.sourceMetaJson, expected)) {
        relevantInvalidIdentityConflict = true;
      } else if (normalizeCandidateIdentity(candidate.name) === normalizedTitle) {
        legacyTitleConflict = true;
      }
    }
  }

  if (relevantInvalidIdentityConflict) {
    throw new MarketScreeningCandidateError(
      "candidate_identity_conflict",
      "候选池存在损坏的重复市场商品身份。",
    );
  }
  if (identityMatches.length > 1) {
    throw new MarketScreeningCandidateError(
      "candidate_identity_conflict",
      "候选池存在重复市场商品身份。",
    );
  }
  if (identityMatches.length === 1) {
    const match = identityMatches[0];
    if (match.identity.evidenceHash !== expected.evidenceHash) {
      throw new MarketScreeningCandidateError(
        "candidate_evidence_conflict",
        "同一市场商品身份的关键证据 Hash 冲突。",
      );
    }
    return { kind: "reuse", candidate: match.candidate };
  }
  if (legacyTitleConflict) {
    throw new MarketScreeningCandidateError(
      "candidate_legacy_identity_conflict",
      "同名旧 Candidate 缺少稳定市场商品身份。",
    );
  }
  return { kind: "create" };
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

export async function selectMarketScreeningCandidateForResearch(
  input: CandidateSaveItem,
  identity: MarketScreeningCandidateIdentity,
  validateCandidate?: (candidate: CandidateItem) => void,
): Promise<{ candidate: CandidateItem; created: boolean }> {
  if (input.status !== "pending" || input.convertedTaskId !== null) {
    throw new MarketScreeningCandidateError(
      "candidate_contract_invalid",
      "市场筛选 Candidate 初始状态无效。",
    );
  }
  const storedIdentity = parseMarketScreeningCandidateIdentity(input.sourceMetaJson);
  if (!storedIdentity
    || storedIdentity.identityHash !== identity.identityHash
    || storedIdentity.evidenceHash !== identity.evidenceHash) {
    throw new MarketScreeningCandidateError(
      "candidate_contract_invalid",
      "市场筛选 Candidate 来源身份未正确绑定。",
    );
  }

  return prisma.$transaction(async (tx) => {
    const existingRecords = await tx.opportunityCandidate.findMany();
    const resolution = resolveMarketScreeningCandidate(existingRecords, input.name, identity);
    let record: typeof existingRecords[number];
    let created = false;

    if (resolution.kind === "reuse") {
      record = resolution.candidate;
    } else {
      record = await tx.opportunityCandidate.create({
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
      created = true;
    }

    if (record.convertedTaskId) {
      throw new MarketScreeningCandidateError(
        "candidate_has_linked_task",
        "该 Candidate 已绑定研究任务。",
      );
    }
    if (!isValidCandidateStatus(record.status)
      || record.status === "paused"
      || record.status === "rejected") {
      throw new MarketScreeningCandidateError(
        "candidate_not_ready",
        "该 Candidate 当前状态不可研究。",
      );
    }
    const incomingProductImage = readCandidateProductImageSnapshot(input.sourceMetaJson);
    let mergedProductImage: { changed: boolean; sourceMetaJson: string };
    try {
      mergedProductImage = mergeCandidateProductImageSnapshot(
        record.sourceMetaJson,
        incomingProductImage,
      );
    } catch (error) {
      if (error instanceof ProductResearchImageConflictError) {
        throw new MarketScreeningCandidateError(
          "candidate_evidence_conflict",
          "同一市场商品身份的商品图片 Hash 冲突。",
        );
      }
      throw error;
    }
    validateCandidate?.(toCandidateItem(record));
    const shouldPromote = record.status === "pending";
    if (shouldPromote || mergedProductImage.changed) {
      assertCandidateSourceUpdateAllowed({
        sourceMetaJson: record.sourceMetaJson,
        reviewIntegrity: buildCandidateEvidenceReview(record).integrity,
        currentStatus: record.status,
        targetStatus: shouldPromote ? "worth_analyzing" : record.status,
        sourceReviewAcknowledged: true,
        requestedFields: [
          ...(shouldPromote ? ["status"] : []),
          ...(mergedProductImage.changed ? ["sourceMetaJson"] : []),
        ],
      });
      record = await tx.opportunityCandidate.update({
        where: { id: record.id },
        data: {
          ...(shouldPromote ? { status: "worth_analyzing" } : {}),
          ...(mergedProductImage.changed
            ? { sourceMetaJson: mergedProductImage.sourceMetaJson }
            : {}),
          lastActionAt: new Date(),
        },
      });
    }
    if (record.status !== "worth_analyzing" && record.status !== "analyzed") {
      throw new MarketScreeningCandidateError(
        "candidate_not_ready",
        "该 Candidate 当前状态不可研究。",
      );
    }
    return { candidate: toCandidateItem(record), created };
  });
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
        if (matches[0].convertedTaskId) {
          throw new CandidateSourceSaveError("candidate_source_conflict", "已转为任务的 Candidate 不能被同名 Legacy 输入覆盖。");
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
