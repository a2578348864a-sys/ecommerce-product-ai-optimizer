import type { ListingCopyResult } from "@/lib/types";

export type ListingCopyHistorySource = "database" | "local";

export type ListingCopyHistoryItem = {
  id: string;
  source: ListingCopyHistorySource;
  savedAt: string;
  productName: string;
  title: string;
  data: ListingCopyResult;
};

type ListingCopyCachePayload = {
  version: 1;
  savedAt: string;
  productKey?: string;
  productName?: string;
  data: ListingCopyResult;
};

type ListingCopyHistoryPayload = {
  version: 1;
  items: ListingCopyHistoryItem[];
};

type LocalStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const listingCopyCacheKey = "cross-border:last-listing-copy";
export const listingCopyHistoryKey = "cross-border:listing-copy-history";
export const listingCopyHistoryMaxItems = 10;

const listingCopyCacheVersion = 1;
const listingCopyHistoryVersion = 1;

export function getListingCopyProductKey(productName: string) {
  return productName.trim().toLowerCase().replace(/\s+/g, " ");
}

function getScopedListingCopyCacheKey(productName: string) {
  const productKey = getListingCopyProductKey(productName);
  return productKey ? `${listingCopyCacheKey}:${encodeURIComponent(productKey)}` : listingCopyCacheKey;
}

function getBrowserLocalStorage(): LocalStorageLike | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
}

function normalizeCachedFaq(value: unknown): ListingCopyResult["faq"] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const question = asString(item.question);
      const answer = asString(item.answer);
      return question || answer ? { question, answer } : null;
    })
    .filter((item): item is { question: string; answer: string } => item !== null);
}

function hasListingCopyContent(value: ListingCopyResult) {
  return Boolean(
    value.title
    || value.bulletPoints.length
    || value.description
    || value.shortDescription
    || value.keywords.length
    || value.longTailKeywords.length
    || value.faq.length
    || value.packingList.length
    || value.afterSales
    || value.notes.length,
  );
}

export function normalizeCachedListingCopy(value: unknown): ListingCopyResult | null {
  if (!isRecord(value)) return null;

  const normalized: ListingCopyResult = {
    title: asString(value.title),
    bulletPoints: asStringArray(value.bulletPoints),
    description: asString(value.description),
    shortDescription: asString(value.shortDescription),
    keywords: asStringArray(value.keywords),
    longTailKeywords: asStringArray(value.longTailKeywords),
    faq: normalizeCachedFaq(value.faq),
    packingList: asStringArray(value.packingList),
    afterSales: asString(value.afterSales),
    notes: asStringArray(value.notes),
  };

  return hasListingCopyContent(normalized) ? normalized : null;
}

function makeListingCopyHistoryId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeHistorySavedAt(value: unknown) {
  const text = asString(value);
  return text || new Date().toISOString();
}

function normalizeHistoryItem(value: unknown): ListingCopyHistoryItem | null {
  if (!isRecord(value)) return null;

  const data = normalizeCachedListingCopy(value.data);
  if (!data) return null;

  return {
    id: asString(value.id) || makeListingCopyHistoryId(),
    source: "local",
    savedAt: normalizeHistorySavedAt(value.savedAt),
    productName: asString(value.productName) || "未命名商品",
    title: asString(value.title) || data.title || "无标题",
    data,
  };
}

export function createListingCopyHistoryItem(
  productName: string,
  data: ListingCopyResult,
): ListingCopyHistoryItem {
  return {
    id: makeListingCopyHistoryId(),
    source: "local",
    savedAt: new Date().toISOString(),
    productName: productName.trim() || "未命名商品",
    title: data.title.trim() || "无标题",
    data,
  };
}

export function readCachedListingCopy(
  productName = "",
  storage = getBrowserLocalStorage(),
) {
  if (!storage) return null;

  try {
    const expectedProductKey = getListingCopyProductKey(productName);
    if (!expectedProductKey) return null;

    const raw = storage.getItem(getScopedListingCopyCacheKey(productName));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== listingCopyCacheVersion) return null;
    if (asString(parsed.productKey) !== expectedProductKey) return null;

    return normalizeCachedListingCopy(parsed.data);
  } catch {
    return null;
  }
}

export function writeCachedListingCopy(
  data: ListingCopyResult,
  productName: string,
  storage = getBrowserLocalStorage(),
) {
  if (!storage) return false;

  try {
    const productKey = getListingCopyProductKey(productName);
    if (!productKey) return false;

    const payload: ListingCopyCachePayload = {
      version: listingCopyCacheVersion,
      savedAt: new Date().toISOString(),
      productKey,
      productName: productName.trim(),
      data,
    };
    storage.setItem(getScopedListingCopyCacheKey(productName), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function removeCachedListingCopy(
  productName = "",
  storage = getBrowserLocalStorage(),
) {
  if (!storage) return false;

  try {
    storage.removeItem(getScopedListingCopyCacheKey(productName));
    return true;
  } catch {
    return false;
  }
}

export function readCachedListingCopyHistory(storage = getBrowserLocalStorage()) {
  if (!storage) return [];

  try {
    const raw = storage.getItem(listingCopyHistoryKey);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return [];
    if (parsed.version !== listingCopyHistoryVersion) return [];

    return Array.isArray(parsed.items)
      ? parsed.items
        .map(normalizeHistoryItem)
        .filter((item): item is ListingCopyHistoryItem => item !== null)
        .slice(0, listingCopyHistoryMaxItems)
      : [];
  } catch {
    return [];
  }
}

export function writeCachedListingCopyHistory(
  items: ListingCopyHistoryItem[],
  storage = getBrowserLocalStorage(),
) {
  if (!storage) return false;

  try {
    const payload: ListingCopyHistoryPayload = {
      version: listingCopyHistoryVersion,
      items: items.slice(0, listingCopyHistoryMaxItems),
    };
    storage.setItem(listingCopyHistoryKey, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function prependListingCopyHistoryItem(
  currentItems: ListingCopyHistoryItem[],
  item: ListingCopyHistoryItem,
) {
  return [item, ...currentItems].slice(0, listingCopyHistoryMaxItems);
}

export function deleteListingCopyHistoryItem(
  currentItems: ListingCopyHistoryItem[],
  id: string,
) {
  return currentItems.filter((item) => item.id !== id);
}
