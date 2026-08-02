import { describe, expect, it } from "vitest";
import { toPublicOpportunityCandidate } from "@/lib/server/candidateEvidenceReview";
import {
  buildSellerSpriteCandidateSourceMeta,
  computeSellerSpriteRowHash,
} from "@/lib/server/sellerSpriteImportContract";

function candidate(sourceMetaJson: string, source: string) {
  return {
    id: "candidate-001",
    name: "Face sunscreen powder",
    rawInput: "",
    link: "https://www.amazon.com/dp/B000000001",
    score: 0,
    source,
    keyword: "",
    riskLevel: "",
    riskLabel: "",
    summaryLabel: "",
    status: "pending",
    sourceMetaJson,
    analysisJson: "{}",
    convertedTaskId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastActionAt: null,
  };
}

describe("public Candidate list provenance", () => {
  it("projects SellerSprite pending, legacy pending and converted actions on the server", () => {
    const asin = "B000000001";
    const title = "Face sunscreen powder";
    const amazonUrl = `https://www.amazon.com/dp/${asin}`;
    const sellerSprite = candidate(buildSellerSpriteCandidateSourceMeta({
      rowHash: computeSellerSpriteRowHash({ rowNumber: 2, asin, title, amazonUrl }),
      rowNumber: 2,
      asin,
      parentAsin: null,
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
    }, "f".repeat(64), "2026-07-31T09:00:00.000Z"), "SellerSprite");

    expect(toPublicOpportunityCandidate(sellerSprite)).toMatchObject({
      researchAction: "research_available",
      researchBlockReasonCode: null,
    });
    expect(toPublicOpportunityCandidate(candidate("{}", "人工录入"))).toMatchObject({
      researchAction: "research_blocked",
      researchBlockReasonCode: "candidate_not_ready",
    });
    expect(toPublicOpportunityCandidate({ ...sellerSprite, convertedTaskId: "task-1" })).toMatchObject({
      researchAction: "converted",
      researchBlockReasonCode: null,
    });
  });

  it("exposes only the safe SellerSprite source classification", () => {
    const result = toPublicOpportunityCandidate(candidate(JSON.stringify({
      schema: "sellersprite_candidate_source_v1",
      source: {
        provider: "SellerSprite",
        type: "sellersprite_xlsx",
        marketplace: "Amazon US",
        sourceFileSha256: "a".repeat(64),
        rowHash: "b".repeat(64),
      },
      identity: { asin: "B000000001" },
    }), "SellerSprite"));

    expect(result).toMatchObject({
      sourceKind: "sellersprite_direct",
      marketplace: "Amazon US",
    });
    expect(result).not.toHaveProperty("sourceMetaJson");
    expect(JSON.stringify(result)).not.toContain("sourceFileSha256");
    expect(JSON.stringify(result)).not.toContain("rowHash");
  });

  it("classifies ProductBatch and manual sources without exposing internal ids", () => {
    const productBatch = toPublicOpportunityCandidate(candidate(JSON.stringify({
      version: "product-batch-candidate-source.v1",
      originKind: "seller_sprite_product_batch",
      productBatchId: "private-batch-id",
      marketplace: "US",
    }), "SellerSprite ProductBatch"));
    const manual = toPublicOpportunityCandidate(candidate("{}", "人工录入"));

    expect(productBatch).toMatchObject({ sourceKind: "product_batch", marketplace: "Amazon US" });
    expect(JSON.stringify(productBatch)).not.toContain("private-batch-id");
    expect(manual).toMatchObject({ sourceKind: "manual", marketplace: null });
  });

  it("does not trust client-shaped action fields or expose corrupted source metadata", () => {
    const result = toPublicOpportunityCandidate({
      ...candidate("{not json", "SellerSprite"),
      status: "analyzed",
      researchAction: "research_available",
      sourceKind: "sellersprite_direct",
    });

    expect(result).toMatchObject({
      researchAction: "research_blocked",
      researchBlockReasonCode: "source_contract_invalid",
    });
    expect(result).not.toHaveProperty("sourceMetaJson");
    expect(JSON.stringify(result)).not.toContain("{not json");
  });
});
