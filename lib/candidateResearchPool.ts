import { buildCandidateResearchHref } from "@/lib/client/sellerSpriteImportWorkflow";

export type CandidateResearchStatus =
  | "pending"
  | "worth_analyzing"
  | "analyzed"
  | "paused"
  | "rejected";

export type CandidateResearchSourceKind =
  | "sellersprite_direct"
  | "product_batch"
  | "manual"
  | "other";

export type CandidateResearchPoolItem = {
  id: string;
  name: string;
  status: CandidateResearchStatus;
  sourceKind: CandidateResearchSourceKind;
  marketplace: string | null;
  convertedTaskId: string | null;
  updatedAt: string;
};

export type CandidateResearchPoolPage = {
  items: CandidateResearchPoolItem[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
};

const STATUS = new Set<CandidateResearchStatus>([
  "pending",
  "worth_analyzing",
  "analyzed",
  "paused",
  "rejected",
]);
const SOURCE_KIND = new Set<CandidateResearchSourceKind>([
  "sellersprite_direct",
  "product_batch",
  "manual",
  "other",
]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function parseItem(value: unknown): CandidateResearchPoolItem | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 120);
  const name = text(value.name, 500);
  const updatedAt = text(value.updatedAt, 40);
  if (!id || !SAFE_ID.test(id) || !name || !updatedAt || Number.isNaN(Date.parse(updatedAt))) return null;
  if (!STATUS.has(value.status as CandidateResearchStatus)) return null;
  if (!SOURCE_KIND.has(value.sourceKind as CandidateResearchSourceKind)) return null;
  const marketplace = value.marketplace === null ? null : text(value.marketplace, 32);
  if (marketplace === null && value.marketplace !== null) return null;
  const convertedTaskId = value.convertedTaskId === null || value.convertedTaskId === undefined
    ? null
    : text(value.convertedTaskId, 120);
  if (convertedTaskId !== null && !SAFE_ID.test(convertedTaskId)) return null;
  return {
    id,
    name,
    status: value.status as CandidateResearchStatus,
    sourceKind: value.sourceKind as CandidateResearchSourceKind,
    marketplace,
    convertedTaskId,
    updatedAt,
  };
}

export function parseCandidateListResponse(value: unknown): CandidateResearchPoolPage | null {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.items)) return null;
  if (!Number.isInteger(value.total) || (value.total as number) < 0 || typeof value.hasMore !== "boolean") return null;
  const nextOffset = value.nextOffset === null ? null : value.nextOffset;
  if (nextOffset !== null && (!Number.isInteger(nextOffset) || (nextOffset as number) < 0)) return null;
  const items = value.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  return {
    items: items as CandidateResearchPoolItem[],
    total: value.total as number,
    hasMore: value.hasMore,
    nextOffset: nextOffset as number | null,
  };
}

export function mergeCandidatePages(
  current: readonly CandidateResearchPoolItem[],
  incoming: readonly CandidateResearchPoolItem[],
): CandidateResearchPoolItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values());
}

export function candidatePrimaryHref(item: Pick<CandidateResearchPoolItem, "id" | "convertedTaskId">): string | null {
  if (item.convertedTaskId && SAFE_ID.test(item.convertedTaskId)) {
    return `/tasks/${encodeURIComponent(item.convertedTaskId)}`;
  }
  return buildCandidateResearchHref(item.id);
}
