import { describe, expect, it } from "vitest";
import { toPublicOpportunityCandidate } from "@/lib/server/candidateEvidenceReview";

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
});
