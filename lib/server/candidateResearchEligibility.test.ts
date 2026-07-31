import { describe, expect, it } from "vitest";
import {
  buildSellerSpriteCandidateSourceMeta,
  computeSellerSpriteRowHash,
} from "@/lib/server/sellerSpriteImportContract";
import {
  evaluateStoredCandidateResearchEligibility,
  parseSellerSpriteMarketResearchSource,
} from "@/lib/server/candidateResearchEligibility";
import { CANDIDATE_ORIGIN_KINDS } from "@/lib/server/productBatchCandidateSource";

const FILE_HASH = "f".repeat(64);
const IMPORTED_AT = "2026-07-31T09:00:00.000Z";

function sellerSpriteRow(overrides: {
  asin?: string;
  title?: string;
  amazonUrl?: string;
  parentAsin?: string | null;
} = {}) {
  const asin = overrides.asin ?? "B0TEST0001";
  const title = overrides.title ?? "Test product";
  const amazonUrl = overrides.amazonUrl ?? `https://www.amazon.com/dp/${asin}`;
  return {
    rowHash: computeSellerSpriteRowHash({ rowNumber: 2, asin, title, amazonUrl }),
    rowNumber: 2,
    asin,
    parentAsin: overrides.parentAsin ?? null,
    title,
    amazonUrl,
    imageUrl: null,
    priceUsd: 19.99,
    rating: 4.5,
    reviewCount: 123,
    brand: "Example",
    category: "Beauty",
    searchRank: null,
    estimatedMonthlySales: 100,
    estimatedMonthlyRevenueUsd: 1999,
  };
}

function sellerSpriteMeta(overrides: {
  asin?: string;
  title?: string;
  amazonUrl?: string;
  provider?: string;
  type?: string;
  marketplace?: string;
} = {}) {
  const row = sellerSpriteRow({
    asin: overrides.asin,
    title: overrides.title,
    amazonUrl: overrides.amazonUrl,
  });
  const meta = JSON.parse(buildSellerSpriteCandidateSourceMeta(row, FILE_HASH, IMPORTED_AT));
  if (overrides.provider !== undefined) meta.source.provider = overrides.provider;
  if (overrides.type !== undefined) meta.source.type = overrides.type;
  if (overrides.marketplace !== undefined) meta.source.marketplace = overrides.marketplace;
  return JSON.stringify(meta);
}

function candidate(overrides: {
  status?: string;
  convertedTaskId?: string | null;
  sourceMetaJson?: string;
} = {}) {
  return {
    id: "candidate-sellersprite-1",
    name: "Test product",
    status: overrides.status ?? "pending",
    convertedTaskId: overrides.convertedTaskId ?? null,
    originProductBatchItemId: null,
    sourceMetaJson: overrides.sourceMetaJson ?? sellerSpriteMeta(),
    analysisJson: "{}",
  };
}

describe("SellerSprite market-research eligibility", () => {
  it("allows an Owner SellerSprite pending candidate into market research", () => {
    const result = evaluateStoredCandidateResearchEligibility(candidate());
    expect(result.allowed).toBe(true);
    expect(result.originKind).toBe(CANDIDATE_ORIGIN_KINDS.sellerSpriteMarketResearch);
    expect(result.researchMode).toBe("market_research_only");
    expect(result.promotionEligible).toBe(false);
    expect(result.sellerSpriteSource?.asin).toBe("B0TEST0001");
  });

  it("allows a Visitor SellerSprite pending candidate with the same contract", () => {
    // Same stored contract; subject isolation is enforced by the read path.
    const result = evaluateStoredCandidateResearchEligibility(candidate());
    expect(result.allowed).toBe(true);
  });

  it("rejects a legacy pending candidate (no widening of all pending)", () => {
    const legacy = {
      id: "legacy-1",
      name: "Legacy product",
      status: "pending",
      convertedTaskId: null,
      originProductBatchItemId: null,
      sourceMetaJson: "{}",
      analysisJson: "{}",
    };
    const result = evaluateStoredCandidateResearchEligibility(legacy);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("candidate_not_ready");
  });

  it("keeps product-batch candidates on their existing path", () => {
    // A product-batch source without the SellerSprite v1 schema stays on the
    // product-batch branch (invalid here → blocked, not misclassified).
    const productBatch = {
      id: "pb-1",
      name: "PB product",
      status: "worth_analyzing",
      convertedTaskId: null,
      originProductBatchItemId: "item-1",
      sourceMetaJson: JSON.stringify({
        originKind: "seller_sprite_product_batch",
        productKey: "amazon:US:B000000001",
        manifestHash: "1".repeat(64),
        snapshotHash: "1".repeat(64),
        itemIdentityHash: "1".repeat(64),
        evidenceHash: "1".repeat(64),
        capturedAt: "2026-07-28T00:00:00.000Z",
        serverIdentityScope: "visitor:sandbox",
        productBatchId: "batch-1",
        productBatchItemId: "item-1",
        marketplace: "US",
        reportType: "search_results",
        researchPriority: "priority_1",
        evidenceStatus: "sufficient_for_comparison",
        promotionEligible: false,
      }),
      analysisJson: "{}",
    };
    const result = evaluateStoredCandidateResearchEligibility(productBatch);
    // The product-batch branch requires more fields; the important part is it
    // is NOT silently reclassified as a SellerSprite market-research source.
    expect(result.originKind).toBe(CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch);
  });

  it("blocks terminal states while keeping pending untouched", () => {
    expect(evaluateStoredCandidateResearchEligibility(candidate({ status: "pending" })).allowed).toBe(true);
    expect(evaluateStoredCandidateResearchEligibility(candidate({ status: "worth_analyzing" })).allowed).toBe(true);
    expect(evaluateStoredCandidateResearchEligibility(candidate({ status: "analyzed" })).allowed).toBe(true);
    expect(evaluateStoredCandidateResearchEligibility(candidate({ status: "rejected" })).allowed).toBe(false);
    expect(evaluateStoredCandidateResearchEligibility(candidate({ status: "paused" })).allowed).toBe(false);
  });

  it("blocks an already-linked candidate", () => {
    const result = evaluateStoredCandidateResearchEligibility(candidate({ convertedTaskId: "task-1" }));
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("candidate_already_linked");
  });

  it("rejects a corrupted sourceMetaJson", () => {
    const result = evaluateStoredCandidateResearchEligibility(candidate({ sourceMetaJson: "{not json" }));
    expect(result.allowed).toBe(false);
  });

  it("rejects a wrong schema", () => {
    const wrong = JSON.parse(sellerSpriteMeta());
    wrong.schema = "other_schema";
    const result = evaluateStoredCandidateResearchEligibility(candidate({ sourceMetaJson: JSON.stringify(wrong) }));
    expect(result.allowed).toBe(false);
  });

  it("rejects a wrong provider", () => {
    const result = evaluateStoredCandidateResearchEligibility(candidate({ sourceMetaJson: sellerSpriteMeta({ provider: "Other" }) }));
    expect(result.allowed).toBe(false);
  });

  it("rejects a wrong source.type", () => {
    const result = evaluateStoredCandidateResearchEligibility(candidate({ sourceMetaJson: sellerSpriteMeta({ type: "sellersprite_csv" }) }));
    expect(result.allowed).toBe(false);
  });

  it("rejects a wrong marketplace", () => {
    const result = evaluateStoredCandidateResearchEligibility(candidate({ sourceMetaJson: sellerSpriteMeta({ marketplace: "Amazon DE" }) }));
    expect(result.allowed).toBe(false);
  });

  it("rejects an invalid ASIN", () => {
    const result = evaluateStoredCandidateResearchEligibility(candidate({ sourceMetaJson: sellerSpriteMeta({ asin: "BAD" }) }));
    expect(result.allowed).toBe(false);
  });

  it("rejects a non-Amazon product URL", () => {
    const result = evaluateStoredCandidateResearchEligibility(candidate({
      sourceMetaJson: sellerSpriteMeta({ amazonUrl: "https://evil.example/dp/B0TEST0001" }),
    }));
    expect(result.allowed).toBe(false);
  });

  it("rejects a product URL whose ASIN does not match the identity", () => {
    const result = evaluateStoredCandidateResearchEligibility(candidate({
      sourceMetaJson: sellerSpriteMeta({ amazonUrl: "https://www.amazon.com/dp/B0OTHER0000" }),
    }));
    expect(result.allowed).toBe(false);
  });

  it("rejects a missing title", () => {
    const result = evaluateStoredCandidateResearchEligibility(candidate({ sourceMetaJson: sellerSpriteMeta({ title: "" }) }));
    expect(result.allowed).toBe(false);
  });

  it("exposes the frozen snapshot and disclaimer through the parsed source", () => {
    const source = parseSellerSpriteMarketResearchSource(sellerSpriteMeta());
    expect(source).not.toBeNull();
    expect(source!.asin).toBe("B0TEST0001");
    expect(source!.productUrl).toBe("https://www.amazon.com/dp/B0TEST0001");
    expect(source!.priceUsd).toBe(19.99);
    expect(source!.estimatedMonthlySales).toBe(100);
    expect(source!.disclaimer).toBe("third_party_estimate_point_in_time");
    expect(source!.importedAt).toBe(IMPORTED_AT);
  });
});
