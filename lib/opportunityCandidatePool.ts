import type { CandidateEvidenceSnapshot } from "@/lib/candidateEvidence";

export const OPPORTUNITY_CANDIDATE_POOL_STORAGE_KEY = "qx:opportunity-candidate-pool:v1";
export const OPPORTUNITY_CANDIDATE_POOL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OPPORTUNITY_CANDIDATE_POOL_VERSION = 1;

export type CandidateStatus = "pending" | "worth_analyzing" | "analyzed" | "paused" | "rejected";
export type CandidatePoolFilter = "all" | CandidateStatus;
export type CandidatePoolSort = "score" | "updated";

export type OpportunityCandidateInput = {
  name: string;
  rawInput?: string;
  link?: string | null;
  score?: number;
  source?: string;
  keyword?: string;
  riskLevel?: string;
  riskLabel?: string;
  summaryLabel?: string;
  evidenceSnapshot?: CandidateEvidenceSnapshot | null;
};

export type OpportunityCandidatePoolItem = {
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
  evidenceSnapshot?: CandidateEvidenceSnapshot | null;
  candidateStatus: CandidateStatus;
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
    name,
    rawInput,
    link,
    score: clampScore(input.score),
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

  return {
    ...candidate,
    id: text(source.id, candidate.id),
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
    value: dedupeCandidates(items),
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
    if (!current || item.updatedAt >= current.updatedAt) {
      byName.set(key, item);
    }
  }
  return Array.from(byName.values());
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
      candidateStatus: current.candidateStatus,
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
  return items.filter((item) => item.candidateStatus === filter);
}

export function sortCandidatePool(items: OpportunityCandidatePoolItem[], sort: CandidatePoolSort) {
  return [...items].sort((a, b) => {
    if (sort === "score") {
      return b.score - a.score || b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, "zh-CN");
    }
    return b.updatedAt - a.updatedAt || b.score - a.score || a.name.localeCompare(b.name, "zh-CN");
  });
}
