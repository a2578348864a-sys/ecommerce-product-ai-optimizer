import { adaptJsonSource } from "../../lib/upstream/sourceAdapters";
import { buildBlindReviewMaterial, rankStage1 } from "../../lib/upstream/ranking";
import { stableHash } from "../../lib/upstream/pipeline";

export type AmazonBestSellerRecord = {
  asin: string;
  rank: number;
  title: string;
  productUrl: string;
  imageUrl: string | null;
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  missingReasons: string[];
};

const BLOCKED_PAGE = /captcha|enter the characters|robot check|sign in to continue|access denied/iu;

export function parseAmazonBestSellersMarkdown(
  markdown: string,
  options: { maxSamples: number },
): AmazonBestSellerRecord[] {
  if (!Number.isInteger(options.maxSamples) || options.maxSamples < 1 || options.maxSamples > 20) {
    throw new Error("PUBLIC_SOURCE_BUDGET_INVALID");
  }
  if (typeof markdown !== "string" || !markdown.trim()) throw new Error("PUBLIC_SOURCE_EMPTY");
  if (BLOCKED_PAGE.test(markdown)) throw new Error("PUBLIC_SOURCE_BLOCKED");
  const pattern = /(?:^|\n)\s*\d+\.\s+#(\d+)\s+\[!\[Image\s+\d+:\s*([^\]]+)\]\((https:[^)]+)\)\]\((https:\/\/www\.amazon\.com\/[^)\s]*\/dp\/([A-Z0-9]{10})[^)]*)\)/gu;
  const matches = [...markdown.matchAll(pattern)];
  const records: AmazonBestSellerRecord[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < matches.length && records.length < options.maxSamples; index += 1) {
    const match = matches[index];
    const asin = match[5].toUpperCase();
    if (seen.has(asin)) continue;
    const segmentEnd = matches[index + 1]?.index ?? markdown.length;
    const segment = markdown.slice(match.index, segmentEnd);
    const ratingMatch = /\[_([0-5](?:\.\d)?) out of 5 stars_\s+([\d,]+)\]/u.exec(segment);
    const priceMatch = /\[\$(\d+(?:\.\d{1,2})?)\]/u.exec(segment);
    const titleLink = new RegExp(`\\[([^\\]]+)\\]\\(https:\\/\\/www\\.amazon\\.com\\/[^)]*\\/dp\\/${asin}[^)]*\\)`, "u").exec(segment);
    const rating = ratingMatch ? Number(ratingMatch[1]) : null;
    const reviewCount = ratingMatch ? Number(ratingMatch[2].replace(/,/g, "")) : null;
    const price = priceMatch ? Number(priceMatch[1]) : null;
    const imageUrl = match[3].startsWith("https://") ? match[3] : null;
    const missingReasons = [
      price === null ? "price_not_visible" : null,
      rating === null ? "rating_not_visible" : null,
      reviewCount === null ? "review_count_not_visible" : null,
      imageUrl === null ? "image_not_visible" : null,
    ].filter((value): value is string => value !== null);
    seen.add(asin);
    records.push({
      asin,
      rank: Number(match[1]),
      title: (titleLink?.[1] ?? match[2]).trim(),
      productUrl: `https://www.amazon.com/dp/${asin}`,
      imageUrl,
      price,
      rating,
      reviewCount,
      missingReasons,
    });
  }
  return records;
}

export function buildStage15ShadowPublicSource(input: {
  role: "calibration" | "validation";
  batchId: string;
  briefId: string;
  collectionRunId: string;
  query: string;
  category: string;
  targetScenario: string;
  targetPriceRange: { min: number; max: number };
  sourceUrl: string;
  sourceMarkdown: string;
  sourceFileSha256: string;
  page: 1 | 2;
  capturedAt: string;
}) {
  if (!/^https:\/\/www\.amazon\.com\//u.test(input.sourceUrl)
    || !/^[a-f0-9]{64}$/u.test(input.sourceFileSha256)
    || Number.isNaN(Date.parse(input.capturedAt))) throw new Error("PUBLIC_SOURCE_INPUT_INVALID");
  const records = parseAmazonBestSellersMarkdown(input.sourceMarkdown, { maxSamples: 20 });
  if (records.length !== 20) throw new Error(`PUBLIC_SOURCE_EXACT_COUNT_REQUIRED:${records.length}`);
  const brief = {
    schemaVersion: "selection-brief.v1" as const,
    briefId: input.briefId,
    marketplace: "amazon.com" as const,
    market: "US" as const,
    query: input.query,
    category: input.category,
    targetScenario: input.targetScenario,
    targetPriceRange: { currency: "USD" as const, ...input.targetPriceRange },
    requiredEvidence: ["identity", "title", "price", "rating", "reviewCount", "imageUrl"],
    hardExclusions: ["identity_conflict", "blocked_page", "non_us_market", "non_usd_currency"],
    sampleBudget: { maxPages: 2, maxAppearances: 20 },
    rankingRuleVersion: "stage1-deterministic-v1.1",
    createdAt: input.capturedAt,
    approvedBy: "project_owner",
  };
  const observationDrafts = records.map((record, index) => {
    const semantic = {
      appearanceKey: `appearance-public-${stableHash({ batchId: input.batchId, asin: record.asin, rank: record.rank }).slice(0, 20)}`,
      page: input.page,
      position: index + 1,
      sponsored: false,
      asin: record.asin,
      parentAsin: null,
      title: record.title,
      price: record.price,
      priceCurrency: "USD" as const,
      rating: record.rating,
      reviewCount: record.reviewCount,
      brand: null,
      productUrl: record.productUrl,
      imageUrl: record.imageUrl,
      identityMissingReason: null,
      fieldMissingReasons: {
        ...(record.price === null ? { price: "price_not_visible" } : {}),
        ...(record.rating === null ? { rating: "rating_not_visible" } : {}),
        ...(record.reviewCount === null ? { reviewCount: "review_count_not_visible" } : {}),
        ...(record.imageUrl === null ? { imageUrl: "image_not_visible" } : {}),
        brand: "brand_not_collected_from_category_page",
      },
      observedRiskFlags: [],
    };
    return semantic;
  });
  const run = {
    schemaVersion: "collection-run.v2" as const,
    collectionRunId: input.collectionRunId,
    briefId: input.briefId,
    requested: { marketplace: "amazon.com" as const, market: "US" as const, currency: "USD" as const },
    observed: { marketplace: "amazon.com", market: "US", currency: "USD", deliveryRegion: "New York 10001", deliveryRegionMarket: "US", language: "en-us" },
    sampledObservationIds: observationDrafts.map((value) => value.appearanceKey),
    diagnosticVisiblePriceNodeCount: records.filter((record) => record.price !== null).length,
    pageStatus: "ok" as const,
    sourceUrl: input.sourceUrl,
    capturedAt: input.capturedAt,
    collectorVersion: "agent-reach-jina-amazon-bestsellers-v1",
    status: "completed" as const,
    errorCode: null,
    contentHash: stableHash({ sourceFileSha256: input.sourceFileSha256, records }),
  };
  const rawObservationBatch = {
    schemaVersion: "raw-observation-batch.v1" as const,
    brief,
    run,
    observations: observationDrafts,
  };
  const sourceAdapterResult = adaptJsonSource(JSON.stringify(rawObservationBatch));
  if (!sourceAdapterResult.pipeline || sourceAdapterResult.qualitySummary.status !== "passed") {
    throw new Error("PUBLIC_SOURCE_PIPELINE_BLOCKED");
  }
  const importPackage = sourceAdapterResult.pipeline.importPackage;
  const rankingRun = rankStage1(importPackage, input.capturedAt);
  const blindReview = buildBlindReviewMaterial(importPackage, `blind-${input.batchId}`);
  return {
    schemaVersion: "stage15-shadow-public-source-run.v1" as const,
    role: input.role,
    batchId: input.batchId,
    sourceFileSha256: input.sourceFileSha256,
    brief,
    collectionRun: sourceAdapterResult.pipeline.run,
    sourceAdapterResult,
    importPackage,
    rankingRun,
    blindReview,
    rawObservationBatch,
    records,
    formalCandidateGenerated: false as const,
    productionDatabaseWritten: false as const,
  };
}
