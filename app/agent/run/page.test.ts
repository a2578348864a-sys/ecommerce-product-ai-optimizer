import { describe, expect, it } from "vitest";

import AgentRunPage from "./page";

function handoff() {
  return {
    version: "product-batch-agent-run-source.v1",
    originKind: "seller_sprite_product_batch",
    productBatchId: "batch-a",
    productBatchItemId: "item-a",
    productName: "Closet organizer",
    marketplace: "US",
    asin: "B000000001",
    reportType: "search_results",
    query: "organizer",
    category: "Home",
    researchPriority: "priority_1",
    evidenceStatus: "sufficient_for_comparison",
    evidenceHash: "a".repeat(64),
    sellerSpriteDisclaimerVersion: "v1",
    capturedAt: "2026-07-28T00:00:00.000Z",
    researchMode: "market_research_only",
    promotionEligible: false,
  };
}

describe("/agent/run ProductBatch handoff", () => {
  it("accepts candidateId plus versioned sourceMeta and derives the product name", async () => {
    const element = await AgentRunPage({
      searchParams: Promise.resolve({
        source: "opportunity",
        candidateId: "candidate-product-batch-a",
        sourceMeta: JSON.stringify(handoff()),
      }),
    });

    expect(element.props.initialProductName).toBe("Closet organizer");
    expect(element.props.initialSourceMeta).toMatchObject({
      source: "opportunity",
      candidateId: "candidate-product-batch-a",
      originKind: "seller_sprite_product_batch",
      productBatchId: "batch-a",
      productBatchItemId: "item-a",
      opportunityTitle: "Closet organizer",
      promotionEligible: false,
    });
  });

  it("does not trust a ProductBatch handoff without candidateId", async () => {
    const element = await AgentRunPage({
      searchParams: Promise.resolve({
        source: "opportunity",
        sourceMeta: JSON.stringify(handoff()),
      }),
    });

    expect(element.props.initialProductName).toBe("Closet organizer");
    expect(element.props.initialSourceMeta).toMatchObject({
      source: "opportunity",
      opportunityTitle: "Closet organizer",
    });
    expect(element.props.initialSourceMeta.candidateId).toBeUndefined();
  });
});
