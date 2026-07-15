import { describe, expect, it } from "vitest";
import { evaluateAmazonEnvironment } from "./environment-gate";

const valid = {
  pageStatus: "ok" as const,
  pageUrl: "https://www.amazon.com/",
  amazonBrandMarkerPresent: true,
  deliveryRegion: "Delivering to New York 10001",
  language: "en-us",
  currencyPreference: "USD",
  pageErrorCode: null,
};

describe("Amazon environment gate", () => {
  it("passes only explicit Amazon US delivery, en-us, and the selected USD preference", () => {
    expect(evaluateAmazonEnvironment(valid)).toEqual({
      status: "passed",
      failedStage: null,
      errorCodes: [],
      canSearch: true,
      observed: {
        marketplace: "amazon.com",
        market: "US",
        deliveryRegion: "Delivering to New York 10001",
        language: "en-us",
        currency: "USD",
      },
      observedEvidence: {
        marketplace: { value: "amazon.com", evidenceSource: "final_url_and_amazon_brand_marker", confidence: "high", satisfiesFieldGate: true },
        market: { value: "US", evidenceSource: "marketplace_and_delivery_region", confidence: "high", satisfiesFieldGate: true },
        deliveryRegion: { value: "Delivering to New York 10001", evidenceSource: "delivery_entry_text", confidence: "high", satisfiesFieldGate: true },
        language: { value: "en-us", evidenceSource: "document_language", confidence: "high", satisfiesFieldGate: true },
        currency: { value: "USD", evidenceSource: "explicit_currency_observation", confidence: "high", satisfiesFieldGate: true },
      },
    });
  });

  it("preserves reliable marketplace and delivery observations when a privacy gate fails", () => {
    const result = evaluateAmazonEnvironment({
      ...valid,
      pageStatus: "unknown_page",
      pageErrorCode: "privacy_prompt_visible",
      language: null,
      currencyPreference: null,
    });

    expect(result.errorCodes).toEqual(["privacy_prompt_visible"]);
    expect(result.observed).toEqual({
      marketplace: "amazon.com",
      market: "US",
      deliveryRegion: "Delivering to New York 10001",
      language: null,
      currency: null,
    });
    expect(result.observedEvidence.marketplace).toMatchObject({ confidence: "high", satisfiesFieldGate: true });
    expect(result.observedEvidence.deliveryRegion).toMatchObject({ confidence: "high", satisfiesFieldGate: true });
    expect(result.canSearch).toBe(false);
  });

  it.each([
    ["Japan delivery", { deliveryRegion: "Deliver to Japan" }, "delivery_verification", "delivery_region_not_us"],
    ["postal code only", { deliveryRegion: "Deliver to 10001" }, "delivery_verification", "delivery_region_not_us"],
    ["currency unknown", { currencyPreference: null }, "currency_verification", "currency_not_usd"],
    ["language drift", { language: "ja-jp" }, "language_verification", "language_not_en_us"],
    ["brand missing", { amazonBrandMarkerPresent: false }, "marketplace_verification", "marketplace_unconfirmed"],
    ["captcha", { pageStatus: "captcha" as const }, "page_status", "captcha"],
  ])("fails closed before search for %s", (_label, mutation, failedStage, errorCode) => {
    const result = evaluateAmazonEnvironment({ ...valid, ...mutation });
    expect(result.status).toBe("failed");
    expect(result.canSearch).toBe(false);
    expect(result.failedStage).toBe(failedStage);
    expect(result.errorCodes).toContain(errorCode);
  });
});
