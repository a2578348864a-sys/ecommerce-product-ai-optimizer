import { describe, expect, it } from "vitest";
import {
  assessStage2VariantIdentity,
  buildStage2PublicRunEvidence,
  classifyAlibabaPage,
  hasUnexpectedAlibabaRedirectOrigin,
  parseAlibabaObjectiveFields,
} from "./stage2-public-evidence-collector";

describe("Stage 2 public supplier evidence collector", () => {
  it("classifies explicit block pages before ordinary product markers", () => {
    expect(classifyAlibabaPage({
      pageUrl: "https://www.alibaba.com/product-detail/example.html",
      title: "Security verification",
      visibleTextLength: 200,
      diagnosticText: "Please complete the security verification captcha",
      productLinks: [],
      productTitle: "6 Shelf Hanging Organizer",
      moqText: null,
      priceText: null,
      packageText: null,
    })).toEqual({ status: "captcha_or_robot_check", reasonCodes: ["captcha_marker_present"] });
  });

  it("classifies a Chrome internal error page and rejects an intermediate HTTP redirect", () => {
    expect(classifyAlibabaPage({
      pageUrl: "chrome-error://chromewebdata/",
      title: "",
      visibleTextLength: 0,
      diagnosticText: "",
      productLinks: [],
      productTitle: null,
      moqText: null,
      priceText: null,
      packageText: null,
    })).toEqual({ status: "browser_internal_error", reasonCodes: ["chrome_internal_error_page"] });
    expect(hasUnexpectedAlibabaRedirectOrigin(["http://www.alibaba.com", "https://www.alibaba.com"]))
      .toBe(true);
    expect(hasUnexpectedAlibabaRedirectOrigin(["https://www.alibaba.com"])).toBe(false);
  });

  it("recognizes search and product pages only from allowed structured signals", () => {
    expect(classifyAlibabaPage({
      pageUrl: "https://www.alibaba.com/trade/search?SearchText=organizer",
      title: "Search results",
      visibleTextLength: 1200,
      diagnosticText: "supplier products",
      productLinks: ["https://www.alibaba.com/product-detail/a.html"],
      productTitle: null,
      moqText: null,
      priceText: null,
      packageText: null,
    }).status).toBe("search_results");
    expect(classifyAlibabaPage({
      pageUrl: "https://www.alibaba.com/product-detail/a.html",
      title: "6 Shelf Hanging Closet Organizer",
      visibleTextLength: 1200,
      diagnosticText: "product details",
      productLinks: [],
      productTitle: "6 Shelf Hanging Closet Organizer",
      moqText: "Minimum order quantity: 10 pieces",
      priceText: "US$3.20-4.10",
      packageText: "Single package size: 30 x 25 x 5 cm; gross weight 0.8 kg",
    }).status).toBe("supplier_product");
  });

  it("keeps price ranges out of BOM and parses only explicitly labelled MOQ and packaging", () => {
    expect(parseAlibabaObjectiveFields({
      moqText: "Minimum order quantity: 10 pieces",
      priceText: "US$3.20-4.10",
      packageText: "Single package size: 30 x 25 x 5 cm; Single gross weight: 0.8 kg",
    })).toEqual({
      moq: 10,
      bom: null,
      packageLengthCm: 30,
      packageWidthCm: 25,
      packageHeightCm: 5,
      packageWeightKg: 0.8,
      missingReasons: { bom: "price_range_is_not_confirmed_same_variant_bom" },
    });
  });

  it("does not claim same-variant identity from a similar public title alone", () => {
    expect(assessStage2VariantIdentity(
      "YOUDENOVA Hanging Closet Organizer and Storage, 6-Shelf, Grey",
      "6 Shelf Grey Hanging Closet Organizer Storage",
    )).toEqual({
      status: "unknown",
      reasonCodes: ["title_similarity_insufficient_for_same_variant_confirmation"],
    });
  });

  it("hashes the diagnostic and cleanup evidence", () => {
    const base = buildStage2PublicRunEvidence({
      runId: "run-1",
      briefId: "brief-1",
      briefHash: "a".repeat(64),
      capturedAt: "2026-07-14T16:00:00.000Z",
      status: "failed",
      errorCode: "variant_identity_cannot_be_confirmed",
      reasonCodes: ["title_similarity_insufficient_for_same_variant_confirmation"],
      pages: [],
      navigationBudget: { maximum: 4, used: 1 },
      cleanup: {
        pageClosed: true,
        browserClosed: true,
        forcedTerminationUsed: false,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineRestored: true,
      },
    });
    const changed = buildStage2PublicRunEvidence({
      ...base,
      navigationBudget: { maximum: 4, used: 2 },
    });
    expect(base.evidenceHash).not.toBe(changed.evidenceHash);
  });
});
