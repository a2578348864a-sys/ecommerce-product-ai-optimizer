import { describe, expect, it } from "vitest";
import type { SelectionBrief } from "../../../lib/upstream/contracts";
import { buildLiveAmazonCanaryEvidence } from "./live-canary";

const brief: SelectionBrief = {
  schemaVersion: "selection-brief.v1",
  briefId: "brief-amazon-us-closet-organizer-canary-v2",
  marketplace: "amazon.com",
  market: "US",
  query: "closet organizer",
  category: null,
  targetScenario: "small-space closet organization",
  targetPriceRange: { currency: "USD", min: 15, max: 45 },
  requiredEvidence: ["identity", "title", "price", "rating", "review_count"],
  hardExclusions: [],
  sampleBudget: { maxPages: 1, maxAppearances: 20 },
  rankingRuleVersion: "stage1-deterministic-v1.1",
  createdAt: "2026-07-14T04:00:00.000Z",
  approvedBy: "user_authorized_live_canary_2026-07-14",
};

function extraction(currency: "USD" | "JPY" | null = "USD") {
  return {
    schemaVersion: "amazon-search-page-extraction.v2" as const,
    requested: { marketplace: "amazon.com" as const, market: "US" as const, currency: "USD" as const },
    observed: {
      marketplace: "amazon.com",
      market: "US",
      currency,
      deliveryRegion: "Delivering to New York 10001",
      deliveryRegionMarket: "US",
      language: "en-us",
    },
    query: "closet organizer",
    page: 1,
    capturedAt: "2026-07-14T04:00:00.000Z",
    pageStatus: "ok" as const,
    blocked: false,
    keyContainerFound: true,
    rawCardCount: 1,
    sampledObservationIds: ["canary-p1-01"],
    diagnosticVisiblePriceNodeCount: 60,
    observations: [{
      appearanceKey: "canary-p1-01",
      page: 1,
      position: 1,
      sponsored: null,
      sponsoredDiagnostic: {
        schemaVersion: "amazon-sponsored-placement-diagnostic.v1" as const,
        state: null,
        markerSource: "none" as const,
        selectorCategory: "unrecognized_card_structure" as const,
        reasonCode: "insufficient_sponsored_evidence" as const,
        matchedText: null,
      },
      asin: "B0CANARY01",
      identityMissingReason: null,
      title: "Closet organizer",
      priceText: currency === "JPY" ? "JPY 2999" : "$29.99",
      priceCurrency: currency,
      ratingText: "4.5 out of 5 stars",
      reviewCountText: "1.2K",
      brand: null,
      productUrl: "https://www.amazon.com/dp/B0CANARY01",
      imageUrl: "https://images-na.ssl-images-amazon.com/example.jpg",
      capturedAt: "2026-07-14T04:00:00.000Z",
      fieldMissingReasons: { brand: "not_exposed_on_search_card", sponsored: "not_determined" },
    }],
  };
}

describe("live Amazon V2 canary evidence", () => {
  it("binds the sampled observations to a V2 CollectionRun hash and passes only sampled USD evidence", () => {
    const evidence = buildLiveAmazonCanaryEvidence({
      brief,
      extraction: extraction(),
      collectorVersion: "amazon-public-search-cdp.v2",
    });

    expect(evidence.evidenceAuthority).toBe("live_public_page");
    expect(evidence.collectionRun.schemaVersion).toBe("collection-run.v2");
    expect(evidence.collectionRun.sampledObservationIds).toEqual(["canary-p1-01"]);
    expect(evidence.collectionRun.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.inputHash).toBe(evidence.collectionRun.contentHash);
    expect(evidence.qualityGate.status).toBe("passed");
    expect(evidence.observations[0].priceCurrency).toBe("USD");
    expect(evidence.observations[0].reviewCount).toBe(1200);
    expect(evidence.observations[0].sponsored).toBeNull();
    expect(evidence.formalCandidateGenerated).toBe(false);
    expect(evidence.productionDatabaseWritten).toBe(false);
  });

  it("fails closed when sampled price evidence conflicts even if arbitrary page price nodes are numerous", () => {
    const evidence = buildLiveAmazonCanaryEvidence({
      brief,
      extraction: extraction("JPY"),
      collectorVersion: "amazon-public-search-cdp.v2",
    });

    expect(evidence.diagnosticVisiblePriceNodeCount).toBe(60);
    expect(evidence.qualityGate.status).toBe("failed");
    expect(evidence.qualityGate.errorCodes).toContain("conflicting_values");
  });
});
