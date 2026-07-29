import { buildAccessHeaders } from "@/lib/client/accessToken";
import type { StudioTargetMarket } from "@/lib/studioListingInput";

export type StudioTaskPrefill = {
  taskId: string;
  productName: string;
  description: string;
  category: string;
  targetMarket: StudioTargetMarket | "";
  sellingPoints: string;
  confirmedFacts: string;
  unverifiedFacts: string;
  primaryKeyword: string;
  secondaryKeywords: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanTextList(value: unknown, maxItems = 8) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, maxItems)
    : [];
}

function uniqueTextList(values: unknown[], maxItems = 12) {
  const seen = new Set<string>();
  return values.flatMap((value) => cleanTextList(value, maxItems))
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems);
}

function splitKeywordText(value: unknown, maxItems = 12) {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n|[,;，；|]/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

const LEGACY_PRODUCT_FACT_LABELS = {
  productTitle: "商品标题",
  brand: "品牌",
  price: "价格",
  rating: "评分",
  reviews: "评论数",
  rootCategory: "大类目",
  subCategory: "小类目",
  variationCount: "变体数",
  sellerCount: "卖家数",
} as const;

const AUTHORITATIVE_LISTING_FACT_LABELS = {
  brand: "品牌",
  asin: "ASIN",
  parentAsin: "父 ASIN",
  price: "商品价格",
  rating: "商品评分",
  reviews: "评论数",
  rootCategory: "大类目",
  subCategory: "小类目",
  categoryPath: "类目路径",
  productDimensions: "商品尺寸",
  productWeight: "商品重量",
  packageDimensions: "包装尺寸",
  packageWeight: "包装重量",
} as const;

function factLines(
  value: unknown,
  labels: Readonly<Record<string, string>>,
): string[] {
  if (!isRecord(value)) return [];
  return Object.entries(labels).flatMap(([key, label]) => {
    const fact = value[key];
    if (typeof fact !== "string" && typeof fact !== "number" && typeof fact !== "boolean") {
      return [];
    }
    const text = String(fact).trim();
    if (!text) return [];
    const suffix = key === "price" ? " USD" : "";
    return [`${label}：${text}${suffix}`];
  });
}

function readTargetMarket(value: unknown): StudioTargetMarket | "" {
  if (value === "US" || value === "UK" || value === "DE" || value === "CA") return value;
  if (value === "GB") return "UK";
  return "";
}

export function extractStudioTaskPrefill(value: unknown): StudioTaskPrefill | null {
  if (!isRecord(value)) return null;
  const taskId = cleanText(value.id, 200);
  if (!taskId) return null;

  const result = isRecord(value.result) ? value.result : {};
  const listing = isRecord(result.listing) ? result.listing : {};
  const sourceMeta = isRecord(result.sourceMeta) ? result.sourceMeta : {};
  const productBatchSnapshot = isRecord(sourceMeta.productBatchSnapshot)
    ? sourceMeta.productBatchSnapshot
    : {};
  const productFacts = isRecord(productBatchSnapshot.productFacts)
    ? productBatchSnapshot.productFacts
    : {};
  const productBatchListingFacts = isRecord(sourceMeta.productBatchListingFacts)
    && sourceMeta.productBatchListingFacts.version === "product-batch-listing-facts.v1"
    ? sourceMeta.productBatchListingFacts
    : {};
  const listingPrep = isRecord(result.listingPrepSnapshot) ? result.listingPrepSnapshot : {};
  const keywordPool = isRecord(listingPrep.keywordPool) ? listingPrep.keywordPool : {};
  const agentOutput = isRecord(result.agentOutputSnapshot) ? result.agentOutputSnapshot : {};
  const listingSnapshot = isRecord(agentOutput.listingSnapshot) ? agentOutput.listingSnapshot : {};
  const productName = cleanText(value.title, 200)
    || cleanText(result.productName, 200)
    || cleanText(productFacts.productTitle, 200)
    || cleanText(value.materialText, 200);
  const confirmedFacts = factLines(
    productBatchListingFacts,
    AUTHORITATIVE_LISTING_FACT_LABELS,
  );
  const legacyUnverifiedFacts = Object.keys(productBatchListingFacts).length === 0
    ? factLines(productFacts, LEGACY_PRODUCT_FACT_LABELS)
    : [];
  const materialText = cleanText(value.materialText, 1_000);
  const exactProductDetails = [
    cleanText(productBatchListingFacts.productBulletPoints, 1_000),
    cleanText(productBatchListingFacts.productDetails, 1_000),
  ].filter(Boolean).join("\n");
  const description = cleanText(result.description, 1_000)
    || cleanText(listing.description, 1_000)
    || cleanText(listingSnapshot.descriptionDraft, 1_000)
    || exactProductDetails
    || (materialText && materialText !== productName ? materialText : "")
    || cleanText(value.oneLineSummary, 1_000);
  const category = cleanText(result.category, 200)
    || cleanText(listing.category, 200)
    || cleanText(productBatchListingFacts.category, 200)
    || cleanText(productBatchSnapshot.category, 200)
    || cleanText(productFacts.rootCategory, 200)
    || cleanText(productFacts.subCategory, 200);
  const exactBulletPoints = splitKeywordText(productBatchListingFacts.productBulletPoints, 8);
  const sellingPoints = cleanTextList(result.sellingPoints).join(", ")
    || cleanTextList(listing.sellingPoints).join(", ")
    || exactBulletPoints.join(", ");
  const coreKeywords = uniqueTextList([
    keywordPool.coreWords,
    listing.keywords,
  ]);
  const longTailKeywords = uniqueTextList([
    keywordPool.longTailWords,
    splitKeywordText(productBatchListingFacts.acKeywords),
  ]);
  const fallbackQuery = cleanText(productBatchSnapshot.query, 200);
  const titleFallback = cleanText(productBatchListingFacts.productTitle, 200)
    || cleanText(productFacts.productTitle, 200)
    || productName;
  const primaryKeyword = (coreKeywords[0]
    || longTailKeywords[0]
    || fallbackQuery
    || titleFallback).slice(0, 200);
  const secondaryKeywords = [
    ...coreKeywords.slice(primaryKeyword ? 1 : 0),
    ...longTailKeywords.slice(
      longTailKeywords[0]?.toLocaleLowerCase() === primaryKeyword.toLocaleLowerCase() ? 1 : 0,
    ),
  ].filter((item, index, all) => (
    item.toLocaleLowerCase() !== primaryKeyword.toLocaleLowerCase()
    && all.findIndex((candidate) => candidate.toLocaleLowerCase() === item.toLocaleLowerCase())
      === index
  )).join(", ").slice(0, 1_000);

  return {
    taskId,
    productName,
    description,
    category,
    targetMarket: readTargetMarket(
      productBatchListingFacts.marketplace || productBatchSnapshot.marketplace,
    ),
    sellingPoints: sellingPoints.slice(0, 1_000),
    confirmedFacts: confirmedFacts.join("\n").slice(0, 3_600),
    unverifiedFacts: legacyUnverifiedFacts.join("\n").slice(0, 3_600),
    primaryKeyword,
    secondaryKeywords,
  };
}

export async function loadStudioTaskPrefill(taskId: string, signal: AbortSignal) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: buildAccessHeaders(),
    cache: "no-store",
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || payload.ok !== true) {
    throw new Error("TASK_PREFILL_UNAVAILABLE");
  }

  const prefill = extractStudioTaskPrefill(payload.data);
  if (!prefill) throw new Error("TASK_PREFILL_INVALID");
  return prefill;
}
