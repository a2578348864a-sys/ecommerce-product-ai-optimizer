import "server-only";

import type { ProductBatchView } from "@/lib/productBatchStore";
import type { ProductBatchCandidateSourceV1 } from "@/lib/server/productBatchCandidateSource";

export type ProductBatchListingFactsV1 = {
  version: "product-batch-listing-facts.v1";
  marketplace: string;
  asin: string | null;
  parentAsin: string | null;
  category: string | null;
  productTitle?: string;
  brand?: string;
  price?: number;
  rating?: number;
  reviews?: number;
  rootCategory?: string;
  subCategory?: string;
  categoryPath?: string;
  productDimensions?: string;
  productWeight?: string;
  packageDimensions?: string;
  packageWeight?: string;
  productBulletPoints?: string;
  productDetails?: string;
  acKeywords?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength = 1_000): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : null;
}

function exactExtraValue(
  records: ReadonlyArray<Record<string, unknown>>,
  headers: ReadonlyArray<string>,
  maxLength = 1_000,
): string | undefined {
  for (const header of headers) {
    const values = new Set(records
      .map((record) => isRecord(record.extraRaw) ? record.extraRaw[header] : null)
      .map((value) => boundedText(value, maxLength))
      .filter((value): value is string => value !== null));
    if (values.size === 1) return [...values][0];
    if (values.size > 1) return undefined;
  }
  return undefined;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeString(value: unknown): string | undefined {
  return boundedText(value, 500) ?? undefined;
}

export function buildProductBatchListingFacts(input: {
  batch: ProductBatchView;
  source: ProductBatchCandidateSourceV1;
}): ProductBatchListingFactsV1 | null {
  if (input.batch.id !== input.source.productBatchId
    || input.batch.snapshotHash !== input.source.snapshotHash
    || !input.batch.normalizedSnapshotJson) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.batch.normalizedSnapshotJson) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)
    || parsed.schemaVersion !== "sellersprite-market-snapshot.v3"
    || !Array.isArray(parsed.records)) {
    return null;
  }
  const records = parsed.records.filter((value): value is Record<string, unknown> => {
    if (!isRecord(value) || !isRecord(value.asin)) return false;
    return value.asin.normalized === input.source.asin;
  });
  if (input.source.asin && records.length === 0) return null;

  const facts = input.source.productFacts;
  return {
    version: "product-batch-listing-facts.v1",
    marketplace: input.source.marketplace,
    asin: input.source.asin,
    parentAsin: input.source.parentAsin,
    category: input.source.category,
    ...(safeString(facts.productTitle) ? { productTitle: safeString(facts.productTitle) } : {}),
    ...(safeString(facts.brand) ? { brand: safeString(facts.brand) } : {}),
    ...(safeNumber(facts.price) !== undefined ? { price: safeNumber(facts.price) } : {}),
    ...(safeNumber(facts.rating) !== undefined ? { rating: safeNumber(facts.rating) } : {}),
    ...(safeNumber(facts.reviews) !== undefined ? { reviews: safeNumber(facts.reviews) } : {}),
    ...(safeString(facts.rootCategory) ? { rootCategory: safeString(facts.rootCategory) } : {}),
    ...(safeString(facts.subCategory) ? { subCategory: safeString(facts.subCategory) } : {}),
    ...(exactExtraValue(records, ["类目路径", "Category Path"], 1_000)
      ? { categoryPath: exactExtraValue(records, ["类目路径", "Category Path"], 1_000) }
      : {}),
    ...(exactExtraValue(records, ["商品尺寸（单位换算）", "商品尺寸", "Product Dimensions"])
      ? {
        productDimensions: exactExtraValue(
          records,
          ["商品尺寸（单位换算）", "商品尺寸", "Product Dimensions"],
        ),
      }
      : {}),
    ...(exactExtraValue(records, ["商品重量（单位换算）", "商品重量", "Product Weight"])
      ? {
        productWeight: exactExtraValue(
          records,
          ["商品重量（单位换算）", "商品重量", "Product Weight"],
        ),
      }
      : {}),
    ...(exactExtraValue(records, ["包装尺寸（单位换算）", "包装尺寸", "Package Dimensions"])
      ? {
        packageDimensions: exactExtraValue(
          records,
          ["包装尺寸（单位换算）", "包装尺寸", "Package Dimensions"],
        ),
      }
      : {}),
    ...(exactExtraValue(records, ["包装重量（单位换算）", "包装重量", "Package Weight"])
      ? {
        packageWeight: exactExtraValue(
          records,
          ["包装重量（单位换算）", "包装重量", "Package Weight"],
        ),
      }
      : {}),
    ...(exactExtraValue(records, ["产品卖点", "Bullet Points"], 2_000)
      ? { productBulletPoints: exactExtraValue(records, ["产品卖点", "Bullet Points"], 2_000) }
      : {}),
    ...(exactExtraValue(records, ["详细参数", "Product Details"], 2_000)
      ? { productDetails: exactExtraValue(records, ["详细参数", "Product Details"], 2_000) }
      : {}),
    ...(exactExtraValue(records, ["AC关键词", "AC Keywords"], 2_000)
      ? { acKeywords: exactExtraValue(records, ["AC关键词", "AC Keywords"], 2_000) }
      : {}),
  };
}
