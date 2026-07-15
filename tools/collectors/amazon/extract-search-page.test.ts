import { describe, expect, it } from "vitest";
import placementFixture from "./fixtures/search-page-placements.v1.json";
import {
  buildAmazonPageContextExpression,
  buildCanonicalAmazonProductUrl,
  buildAmazonSearchPageExtractionExpression,
  deriveObservedAmazonMarketContext,
  extractAmazonSearchPage,
  sanitizeCollectorText,
} from "./extract-search-page";

type NodeFixture = {
  asin: string;
  text: string;
  nodes: Record<string, string | undefined>;
};

function fixtureNode(value: string, selector: string) {
  return {
    textContent: value,
    getAttribute(name: string) {
      if (name === "src" && selector === "img.s-image") return value;
      return null;
    },
  };
}

function lookupNode(card: NodeFixture, selector: string) {
  if (selector.includes("customerReviews")) {
    const value = card.nodes["a[href*=customerReviews] span"];
    return value ? fixtureNode(value, selector) : null;
  }
  if (selector.includes("aria-label") && selector.includes("Sponsored")) {
    const value = card.nodes["[aria-label=Sponsored]"];
    return value ? fixtureNode(value, selector) : null;
  }
  const value = card.nodes[selector];
  return value ? fixtureNode(value, selector) : null;
}

function createFixtureDocument(input: {
  bodyText: string;
  allVisiblePriceNodeCount?: number;
  cards: NodeFixture[];
}) {
  const cards = input.cards.map((card) => ({
    textContent: card.text,
    getAttribute(name: string) {
      return name === "data-asin" ? card.asin : null;
    },
    querySelector(selector: string) {
      return lookupNode(card, selector);
    },
  }));
  return {
    body: { innerText: input.bodyText },
    querySelectorAll(selector: string) {
      if (selector === '[data-component-type="s-search-result"]') return cards;
      if (selector === ".a-price .a-offscreen") {
        return Array.from({ length: input.allVisiblePriceNodeCount ?? 0 }, () => fixtureNode("$1.00", selector));
      }
      return [];
    },
  } as unknown as Document;
}

const requested = { marketplace: "amazon.com" as const, market: "US" as const, currency: "USD" as const };
const observed = {
  marketplace: "amazon.com",
  market: "US",
  currency: "USD",
  deliveryRegion: "New York 10001",
  deliveryRegionMarket: "US",
  language: "en-us",
};

describe("amazon public-page collector policy", () => {
  it("builds only canonical public Amazon product URLs", () => {
    expect(buildCanonicalAmazonProductUrl("b0fix00001")).toBe("https://www.amazon.com/dp/B0FIX00001");
    expect(() => buildCanonicalAmazonProductUrl("../admin")).toThrow("AMAZON_ASIN_INVALID");
  });

  it("strips control characters and bounds untrusted page text", () => {
    expect(sanitizeCollectorText("  hello\u0000   world  ", 8)).toBe("hello wo");
    expect(sanitizeCollectorText("", 10)).toBeNull();
  });

  it("extracts sponsored, organic, and unknown placements from structured DOM and preserves duplicate appearances", () => {
    expect(placementFixture.schemaVersion).toBe("amazon-search-page-placements-fixture.v1");
    const result = extractAmazonSearchPage(createFixtureDocument(placementFixture), {
      query: "closet organizer",
      page: 1,
      maxAppearances: 20,
      capturedAt: "2026-07-14T00:00:00.000Z",
      requested,
      observed,
    });

    expect(result.observations.map((item) => item.sponsored)).toEqual([true, false, null]);
    expect(result.observations.map((item) => item.sponsoredDiagnostic))
      .toEqual(placementFixture.expectedSponsoredDiagnostics);
    expect(result.observations.slice(0, 2).map((item) => item.asin)).toEqual(["B0DOM00001", "B0DOM00001"]);
    expect(result.observations.map((item) => item.priceCurrency)).toEqual(["USD", "USD", "USD"]);
    expect(result.sampledObservationIds).toEqual(result.observations.map((item) => item.appearanceKey));
    expect(result.diagnosticVisiblePriceNodeCount).toBe(7);
    expect(result.observed).toEqual(observed);
  });

  it("does not hard-code the observed market", () => {
    const result = extractAmazonSearchPage(createFixtureDocument(placementFixture), {
      query: "closet organizer",
      page: 1,
      maxAppearances: 1,
      capturedAt: "2026-07-14T00:00:00.000Z",
      requested,
      observed: { ...observed, market: "JP", currency: "JPY", deliveryRegion: "Japan", deliveryRegionMarket: "JP" },
    });
    expect(result.observed.market).toBe("JP");
    expect(result.observed.currency).toBe("JPY");
  });

  it("derives observed context only from explicit page and sampled-price evidence", () => {
    expect(deriveObservedAmazonMarketContext({
      pageUrl: "https://www.amazon.com/s?k=closet+organizer",
      amazonBrandMarkerPresent: true,
      deliveryRegion: "Delivering to New York 10001",
      language: "en-us",
    }, ["USD", "USD"], "10001")).toEqual({
      ...observed,
      deliveryRegion: "Delivering to New York 10001",
    });

    expect(deriveObservedAmazonMarketContext({
      pageUrl: "https://www.amazon.com/s?k=closet+organizer",
      amazonBrandMarkerPresent: true,
      deliveryRegion: "Delivering to New York 10001",
      language: "en-us",
    }, ["USD", "JPY"], "10001")).toEqual({
      marketplace: "amazon.com",
      market: "US",
      currency: null,
      deliveryRegion: "Delivering to New York 10001",
      deliveryRegionMarket: "US",
      language: "en-us",
    });

    expect(deriveObservedAmazonMarketContext({
      pageUrl: "https://www.amazon.com/s?k=closet+organizer",
      amazonBrandMarkerPresent: false,
      deliveryRegion: null,
      language: null,
    }, [], "10001")).toEqual({
      marketplace: null,
      market: null,
      currency: null,
      deliveryRegion: null,
      deliveryRegionMarket: null,
      language: null,
    });
  });

  it("builds browser expressions that execute the production page-context and extraction functions", () => {
    const root = createFixtureDocument(placementFixture);
    const contextExpression = buildAmazonPageContextExpression();
    const extractionExpression = buildAmazonSearchPageExtractionExpression({
      query: "closet organizer",
      page: 1,
      maxAppearances: 20,
      capturedAt: "2026-07-14T00:00:00.000Z",
      requested,
      observed,
    });
    const context = Function("document", "location", `return ${contextExpression}`)(root, {
      href: "https://www.amazon.com/s?k=closet+organizer",
    });
    const extracted = Function("document", `return ${extractionExpression}`)(root);

    expect(context.pageUrl).toBe("https://www.amazon.com/s?k=closet+organizer");
    expect(extracted.observations.map((item: { sponsored: boolean | null }) => item.sponsored)).toEqual([true, false, null]);
    expect(extracted.observations.map((item: { sponsoredDiagnostic: { reasonCode: string } }) => (
      item.sponsoredDiagnostic.reasonCode
    ))).toEqual([
      "sponsored_marker_present",
      "known_organic_structure",
      "ambiguous_ad_text_without_known_marker",
    ]);
  });

  it("keeps sponsored diagnostics bounded and excludes full card text", () => {
    const result = extractAmazonSearchPage(createFixtureDocument({
      bodyText: "Amazon search results for closet organizer",
      cards: [{
        asin: "B0DOM00003",
        text: `Promoted ${"private-form-like-text ".repeat(80)}`,
        nodes: {
          "h2 a span": "Unknown placement",
          ".a-price .a-offscreen": "$20.00",
          "img.s-image": "https://m.media-amazon.com/images/I/fixture-unknown-2.jpg",
        },
      }],
    }), {
      query: "closet organizer",
      page: 1,
      maxAppearances: 1,
      capturedAt: "2026-07-14T00:00:00.000Z",
      requested,
      observed,
    });

    expect(result.observations[0].sponsoredDiagnostic).toMatchObject({
      state: null,
      reasonCode: "ambiguous_ad_text_without_known_marker",
      matchedText: "Promoted",
    });
    expect(JSON.stringify(result.observations[0].sponsoredDiagnostic)).not.toContain("private-form-like-text");
  });

  it("distinguishes unknown ad text from insufficient card structure", () => {
    const result = extractAmazonSearchPage(createFixtureDocument({
      bodyText: "Amazon search results for closet organizer",
      cards: [{
        asin: "",
        text: "Unrecognized result card",
        nodes: {},
      }],
    }), {
      query: "closet organizer",
      page: 1,
      maxAppearances: 1,
      capturedAt: "2026-07-14T00:00:00.000Z",
      requested,
      observed,
    });

    expect(result.observations[0].sponsored).toBeNull();
    expect(result.observations[0].sponsoredDiagnostic).toEqual({
      schemaVersion: "amazon-sponsored-placement-diagnostic.v1",
      state: null,
      markerSource: "none",
      selectorCategory: "unrecognized_card_structure",
      reasonCode: "insufficient_sponsored_evidence",
      matchedText: null,
    });
  });

  it("uses the same h2 span fallback for a standard organic card that title extraction already accepts", () => {
    const result = extractAmazonSearchPage(createFixtureDocument({
      bodyText: "Amazon search results for closet organizer",
      cards: [{
        asin: "B0DOM00004",
        text: "Current-layout closet organizer $24.99",
        nodes: {
          "h2 span": "Current-layout closet organizer",
          ".a-price .a-offscreen": "$24.99",
          "img.s-image": "https://m.media-amazon.com/images/I/fixture-current-layout.jpg",
        },
      }],
    }), {
      query: "closet organizer",
      page: 1,
      maxAppearances: 1,
      capturedAt: "2026-07-14T00:00:00.000Z",
      requested,
      observed,
    });

    expect(result.observations[0]).toMatchObject({
      title: "Current-layout closet organizer",
      sponsored: false,
      sponsoredDiagnostic: {
        markerSource: "known_card_structure",
        selectorCategory: "standard_search_result_card",
        reasonCode: "known_organic_structure",
      },
    });
  });

  it.each([
    ["captcha", "Robot Check Enter the characters you see", "captcha"],
    ["login wall", "Sign in to continue", "login_wall"],
    ["error page", "Sorry something went wrong on our end", "error_page"],
    ["unknown page", "Welcome to an unexpected page", "unknown_page"],
  ])("fails closed for %s content", (_label, bodyText, expectedStatus) => {
    const result = extractAmazonSearchPage(createFixtureDocument({ bodyText, cards: [] }), {
      query: "closet organizer",
      page: 1,
      maxAppearances: 20,
      capturedAt: "2026-07-14T00:00:00.000Z",
      requested,
      observed,
    });
    expect(result.pageStatus).toBe(expectedStatus);
    expect(result.blocked).toBe(true);
  });
});
