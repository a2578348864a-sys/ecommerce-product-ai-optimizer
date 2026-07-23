import {
  parseCandidateEvidenceSnapshot,
  type CandidateEvidenceSnapshot,
} from "@/lib/candidateEvidence";
import {
  parseCandidateEvidenceReviewV1,
  type CandidateEvidenceReviewV1,
} from "@/lib/candidateEvidenceReview";
import {
  requiresCandidateSourceReview,
  type CandidateSourceIntegrity,
} from "@/lib/candidateSourceIntegrity";
import {
  parseR22MarketDecisionSnapshot,
  type R22MarketDecisionSnapshot,
} from "@/lib/r22DecisionModel";

export const OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY = "qx:opportunity-candidate-pool:v1";
export const OPPORTUNITY_CANDIDATE_POOL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OPPORTUNITY_CANDIDATE_POOL_VERSION = 1;

export type CandidateStatus = "pending" | "worth_analyzing" | "analyzed" | "paused" | "rejected";
export type CandidatePoolFilter = "all" | CandidateStatus;
export type CandidatePoolSort = "score" | "updated";
export type CandidateIdentitySource = "server" | "local_draft";
export type CandidateQueueState = "pending_review" | "pending_analysis" | "analyzing" | "converted" | "rejected";
export type CandidatePoolCounts = Readonly<{
  all: number;
  pending: number;
  worth_analyzing: number;
  analyzed: number;
  paused: number;
  rejected: number;
}>;

export type CandidateQueuePresentation = {
  state: CandidateQueueState;
  label: "待查看" | "待分析" | "分析中" | "已转任务" | "已放弃";
  nextAction: string;
};

export type OpportunityCandidateInput = {
  name: string;
  rawInput?: string;
  link?: string | null;
  score?: number;
  scoreAvailable?: boolean;
  source?: string;
  keyword?: string;
  riskLevel?: string;
  riskLabel?: string;
  summaryLabel?: string;
  evidenceSnapshot?: CandidateEvidenceSnapshot | null;
  r22MarketDecisionSnapshot?: R22MarketDecisionSnapshot | null;
};

export type OpportunityCandidatePoolItem = {
  id: string;
  identitySource: CandidateIdentitySource;
  sourceIntegrity: CandidateSourceIntegrity;
  sourceReview?: CandidateEvidenceReviewV1;
  name: string;
  rawInput: string;
  link: string | null;
  score: number;
  /** False only when the original score field was missing or invalid; legacy items may omit it. */
  scoreAvailable?: boolean;
  source: string;
  keyword: string;
  riskLevel: string;
  riskLabel: string;
  summaryLabel: string;
  evidenceSnapshot?: CandidateEvidenceSnapshot | null;
  /** Trusted only when received from the current authenticated server response; never restored from localStorage. */
  r22MarketDecisionSnapshot?: R22MarketDecisionSnapshot | null;
  candidateStatus: CandidateStatus;
  convertedTaskId?: string | null;
  createdAt: number;
  updatedAt: number;
  lastActionAt: number | null;
};

type StoredCandidatePool = {
  version: number;
  updatedAt: number;
  value: OpportunityCandidatePoolItem[];
};

export type ParseCandidatePoolResult = {
  items: OpportunityCandidatePoolItem[];
  shouldClear: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function clampScore(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(100, Math.max(0, Math.round(numberValue)));
}

function hasValidScore(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string" || value.trim().length === 0) return false;
  return Number.isFinite(Number(value));
}

const SAFE_TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

function canonicalTaskId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return SAFE_TASK_ID_PATTERN.test(normalized) ? normalized : null;
}

function timestamp(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashText(value: string) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function getCandidateDedupeKey(input: Pick<OpportunityCandidateInput, "name" | "link" | "rawInput">) {
  const name = normalizeKey(text(input.name));
  if (name) return `name:${name}`;
  const link = normalizeKey(text(input.link));
  if (link) return `link:${link}`;
  return `raw:${normalizeKey(text(input.rawInput))}`;
}

export function makeCandidateId(input: Pick<OpportunityCandidateInput, "name" | "link" | "rawInput">) {
  return `opp-${hashText(getCandidateDedupeKey(input))}`;
}

export function isLocalDraftCandidateId(candidateId: string | null | undefined) {
  return typeof candidateId === "string" && candidateId.startsWith("opp-");
}

export function isAuthoritativeCandidateId(candidateId: string | null | undefined) {
  return typeof candidateId === "string" && candidateId.trim().length > 0 && !isLocalDraftCandidateId(candidateId);
}

export function isCandidateReadyForAgent(status: unknown): status is Extract<CandidateStatus, "worth_analyzing" | "analyzed"> {
  return status === "worth_analyzing" || status === "analyzed";
}

export function getCandidateQueuePresentation(
  candidateStatus: CandidateStatus,
  hasLinkedTask = false,
): CandidateQueuePresentation {
  if (hasLinkedTask) {
    return { state: "converted", label: "已转任务", nextAction: "查看关联任务" };
  }
  if (candidateStatus === "rejected") {
    return { state: "rejected", label: "已放弃", nextAction: "恢复为待查看" };
  }
  if (candidateStatus === "analyzed") {
    return { state: "analyzing", label: "分析中", nextAction: "继续分析" };
  }
  if (candidateStatus === "worth_analyzing") {
    return { state: "pending_analysis", label: "待分析", nextAction: "开始分析" };
  }
  return { state: "pending_review", label: "待查看", nextAction: "选择为待分析" };
}

export function canCandidateEnterAgent(
  candidate: Pick<OpportunityCandidatePoolItem, "id" | "identitySource" | "candidateStatus" | "r22MarketDecisionSnapshot">,
  serverAvailable: boolean | null,
  hasLinkedTask = false,
  explicitMarketWatchReview = false,
) {
  const snapshot = candidate.r22MarketDecisionSnapshot
    ? parseR22MarketDecisionSnapshot(candidate.r22MarketDecisionSnapshot)
    : null;
  const r22Allowed = !candidate.r22MarketDecisionSnapshot
    || Boolean(snapshot
      && snapshot.candidateId === candidate.id
      && (snapshot.marketDecision === "market_shortlisted"
        || (snapshot.marketDecision === "market_watch" && explicitMarketWatchReview)));
  return r22Allowed
    && serverAvailable === true
    && candidate.identitySource === "server"
    && isAuthoritativeCandidateId(candidate.id)
    && isCandidateReadyForAgent(candidate.candidateStatus)
    && !hasLinkedTask;
}

export function getCandidateSourceIntegrityPresentation(sourceIntegrity: CandidateSourceIntegrity) {
  return sourceIntegrity === "verified_public"
    ? {
      verified: true as const,
      label: "来源证据链已验证",
      description: "仅证明保存时来源证据链完整，不代表商品真实性、市场需求或页面当前状态。",
    }
    : {
      verified: false as const,
      label: "来源未验证",
      description: "继续前请人工核对商品页、价格和合规风险；确认不会把来源升级为已验证。",
    };
}

export function buildCandidateStatusUpdatePayload(
  candidate: Pick<OpportunityCandidatePoolItem, "candidateStatus" | "sourceIntegrity">,
  status: CandidateStatus,
): { status: CandidateStatus; sourceReviewAcknowledged?: true } {
  return requiresCandidateSourceReview(candidate.sourceIntegrity, candidate.candidateStatus, status)
    ? { status, sourceReviewAcknowledged: true }
    : { status };
}

export function getDefaultCandidateStatus(input: Pick<OpportunityCandidateInput, "score" | "riskLevel">): CandidateStatus {
  const risk = text(input.riskLevel).toLowerCase();
  const score = clampScore(input.score);
  if (risk === "red" || risk.includes("高")) return "paused";
  if (score >= 80 && (risk === "green" || risk.includes("低"))) return "worth_analyzing";
  return "pending";
}

export function normalizeCandidate(input: OpportunityCandidateInput, now = Date.now()): OpportunityCandidatePoolItem | null {
  const name = text(input.name);
  if (!name) return null;

  const rawInput = text(input.rawInput, name);
  const link = text(input.link) || null;
  const riskLevel = text(input.riskLevel);

  return {
    id: makeCandidateId({ name, link, rawInput }),
    identitySource: "local_draft",
    sourceIntegrity: "unverified",
    name,
    rawInput,
    link,
    score: clampScore(input.score),
    scoreAvailable: input.scoreAvailable ?? hasValidScore(input.score),
    source: text(input.source, "机会雷达"),
    keyword: text(input.keyword),
    riskLevel,
    riskLabel: text(input.riskLabel, riskLevel || "—"),
    summaryLabel: text(input.summaryLabel, "暂无摘要"),
    ...(input.evidenceSnapshot ? { evidenceSnapshot: input.evidenceSnapshot } : {}),
    candidateStatus: getDefaultCandidateStatus({ score: input.score, riskLevel }),
    createdAt: now,
    updatedAt: now,
    lastActionAt: null,
  };
}

export function serverCandidateToPoolItem(
  item: Record<string, unknown>,
): OpportunityCandidatePoolItem {
  const now = Date.now();
  const sourceReview = parseCandidateEvidenceReviewV1(item.sourceReview);
  const evidenceSnapshot = parseCandidateEvidenceSnapshot(item.evidenceSnapshot);
  const r22MarketDecisionSnapshot = parseR22MarketDecisionSnapshot(item.r22MarketDecisionSnapshot);
  return {
    id: text(item.id),
    identitySource: "server",
    sourceIntegrity: sourceReview.integrity,
    sourceReview,
    name: text(item.name),
    rawInput: text(item.rawInput, text(item.name)),
    link: text(item.link) || null,
    score: clampScore(item.score),
    scoreAvailable: hasValidScore(item.score),
    source: text(item.source, "机会雷达"),
    keyword: text(item.keyword),
    riskLevel: text(item.riskLevel),
    riskLabel: text(item.riskLabel),
    summaryLabel: text(item.summaryLabel),
    ...(evidenceSnapshot ? { evidenceSnapshot } : {}),
    ...(r22MarketDecisionSnapshot ? { r22MarketDecisionSnapshot } : {}),
    candidateStatus: isCandidateStatus(item.status) ? item.status : "pending",
    convertedTaskId: canonicalTaskId(item.convertedTaskId),
    createdAt: timestamp(item.createdAt, now),
    updatedAt: timestamp(item.updatedAt, now),
    lastActionAt: optionalTimestamp(item.lastActionAt),
  };
}

function isCandidateStatus(value: unknown): value is CandidateStatus {
  return value === "pending"
    || value === "worth_analyzing"
    || value === "analyzed"
    || value === "paused"
    || value === "rejected";
}

function normalizeStoredItem(value: unknown): OpportunityCandidatePoolItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const candidate = normalizeCandidate({
    name: text(source.name),
    rawInput: text(source.rawInput),
    link: text(source.link),
    score: clampScore(source.score),
    scoreAvailable: typeof source.scoreAvailable === "boolean"
      ? source.scoreAvailable
      : hasValidScore(source.score),
    source: text(source.source),
    keyword: text(source.keyword),
    riskLevel: text(source.riskLevel),
    riskLabel: text(source.riskLabel),
    summaryLabel: text(source.summaryLabel),
    evidenceSnapshot: source.evidenceSnapshot as CandidateEvidenceSnapshot | null | undefined,
  }, typeof source.updatedAt === "number" ? source.updatedAt : Date.now());

  if (!candidate) return null;

  const createdAt = typeof source.createdAt === "number" && Number.isFinite(source.createdAt) ? source.createdAt : candidate.createdAt;
  const updatedAt = typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : candidate.updatedAt;
  const lastActionAt = typeof source.lastActionAt === "number" && Number.isFinite(source.lastActionAt) ? source.lastActionAt : null;

  const identitySource: CandidateIdentitySource = source.identitySource === "server" || source.identitySource === "local_draft"
    ? source.identitySource
    : isLocalDraftCandidateId(text(source.id, candidate.id))
      ? "local_draft"
      : "server";

  return {
    ...candidate,
    id: text(source.id, candidate.id),
    identitySource,
    // localStorage is client-modifiable and cannot prove a server-verified Evidence chain.
    sourceIntegrity: "unverified",
    evidenceSnapshot: candidate.evidenceSnapshot,
    candidateStatus: isCandidateStatus(source.candidateStatus) ? source.candidateStatus : candidate.candidateStatus,
    createdAt,
    updatedAt,
    lastActionAt,
  };
}

export function parseCandidatePool(raw: string | null, now = Date.now(), ttlMs = OPPORTUNITY_CANDIDATE_POOL_TTL_MS): ParseCandidatePoolResult {
  if (!raw) return { items: [], shouldClear: false };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { items: [], shouldClear: true };
    const source = parsed as Record<string, unknown>;
    if (source.version !== OPPORTUNITY_CANDIDATE_POOL_VERSION || typeof source.updatedAt !== "number" || !Array.isArray(source.value)) {
      return { items: [], shouldClear: true };
    }
    if (!Number.isFinite(source.updatedAt) || now - source.updatedAt > ttlMs) {
      return { items: [], shouldClear: true };
    }

    const items = source.value
      .map(normalizeStoredItem)
      .filter((item): item is OpportunityCandidatePoolItem => item !== null);

    return { items: dedupeCandidates(items), shouldClear: false };
  } catch {
    return { items: [], shouldClear: true };
  }
}

export function serializeCandidatePool(items: OpportunityCandidatePoolItem[], now = Date.now()) {
  const payload: StoredCandidatePool = {
    version: OPPORTUNITY_CANDIDATE_POOL_VERSION,
    updatedAt: now,
    value: dedupeCandidates(items).map(({
      sourceReview: _sourceReview,
      convertedTaskId: _convertedTaskId,
      r22MarketDecisionSnapshot: _r22MarketDecisionSnapshot,
      ...item
    }) => ({
      ...item,
      sourceIntegrity: "unverified",
    })),
  };
  return JSON.stringify(payload);
}

export function readCandidatePool(storage: StorageLike | null | undefined, now = Date.now()) {
  if (!storage) return [];
  const result = parseCandidatePool(storage.getItem(OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY), now);
  if (result.shouldClear) storage.removeItem(OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY);
  return result.items;
}

export function writeCandidatePool(storage: StorageLike | null | undefined, items: OpportunityCandidatePoolItem[], now = Date.now()) {
  if (!storage) return;
  storage.setItem(OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY, serializeCandidatePool(items, now));
}

export function dedupeCandidates(items: OpportunityCandidatePoolItem[]) {
  const byName = new Map<string, OpportunityCandidatePoolItem>();
  for (const item of items) {
    const key = getCandidateDedupeKey(item);
    const current = byName.get(key);
    const replacesLocalWithServer = current?.identitySource === "local_draft" && item.identitySource === "server";
    const sameIdentityAndNewer = current?.identitySource === item.identitySource && item.updatedAt >= current.updatedAt;
    if (!current || replacesLocalWithServer || sameIdentityAndNewer) {
      byName.set(key, item);
    }
  }
  return Array.from(byName.values());
}

export function mergeServerCandidatesWithLocalDrafts(
  serverItems: OpportunityCandidatePoolItem[],
  cachedItems: OpportunityCandidatePoolItem[],
) {
  return sortCandidatePool(dedupeCandidates([
    ...cachedItems.filter((item) => item.identitySource === "local_draft"),
    ...serverItems.map((item) => ({ ...item, identitySource: "server" as const })),
  ]), "updated");
}

export function mergeCandidatesIntoPool(
  existing: OpportunityCandidatePoolItem[],
  inputs: OpportunityCandidateInput[],
  now = Date.now(),
) {
  const byKey = new Map<string, OpportunityCandidatePoolItem>();
  for (const item of existing) {
    byKey.set(getCandidateDedupeKey(item), item);
  }

  for (const input of inputs) {
    const next = normalizeCandidate(input, now);
    if (!next) continue;
    const key = getCandidateDedupeKey(next);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, next);
      continue;
    }
    byKey.set(key, {
      ...next,
      id: current.id,
      identitySource: current.identitySource,
      candidateStatus: current.candidateStatus,
      convertedTaskId: current.convertedTaskId,
      createdAt: current.createdAt,
      lastActionAt: current.lastActionAt,
      updatedAt: now,
    });
  }

  return sortCandidatePool(Array.from(byKey.values()), "updated");
}

export function updateCandidateStatus(
  items: OpportunityCandidatePoolItem[],
  id: string,
  candidateStatus: CandidateStatus,
  now = Date.now(),
) {
  return items.map((item) => item.id === id
    ? { ...item, candidateStatus, updatedAt: now, lastActionAt: now }
    : item);
}

export function filterCandidatePool(items: OpportunityCandidatePoolItem[], filter: CandidatePoolFilter) {
  if (filter === "all") return items;
  if (filter === "analyzed") {
    return items.filter((item) => item.candidateStatus === "analyzed" && !item.convertedTaskId);
  }
  return items.filter((item) => item.candidateStatus === filter);
}

export function buildCandidatePoolCounts(
  candidates: readonly OpportunityCandidatePoolItem[],
): CandidatePoolCounts {
  const counts = {
    all: candidates.length,
    pending: 0,
    worth_analyzing: 0,
    analyzed: 0,
    paused: 0,
    rejected: 0,
  };

  for (const candidate of candidates) {
    if (candidate.candidateStatus === "analyzed") {
      if (!candidate.convertedTaskId) counts.analyzed += 1;
      continue;
    }
    if (candidate.candidateStatus === "pending") counts.pending += 1;
    if (candidate.candidateStatus === "worth_analyzing") counts.worth_analyzing += 1;
    if (candidate.candidateStatus === "paused") counts.paused += 1;
    if (candidate.candidateStatus === "rejected") counts.rejected += 1;
  }

  return counts;
}

export function sortCandidatePool(items: OpportunityCandidatePoolItem[], sort: CandidatePoolSort) {
  return [...items].sort((a, b) => {
    if (sort === "score") {
      return b.score - a.score || b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, "zh-CN");
    }
    return b.updatedAt - a.updatedAt || b.score - a.score || a.name.localeCompare(b.name, "zh-CN");
  });
}
