import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type {
  HumanAssistedBrowserCleanup,
  IsolatedPublicBrowserSession,
  PublicPageNavigationResult,
} from "../collectors/amazon/browser-control";
import {
  STAGE15_EFFECTIVENESS_REVALIDATION_AUTHORIZATION_PHRASE,
  executeAuthorizedStage15EffectivenessRevalidation,
  inspectStage15AmazonProductDetailDom,
  type Stage15EffectivenessRevalidationBrief,
} from "./run-stage15-effectiveness-revalidation";

const privacyAbsent = {
  state: "absent",
  markerSource: "none",
  selectorCategory: null,
  tagName: null,
  role: null,
  visible: null,
  hasInteractiveControls: null,
  insideFooter: null,
  blocksMainContent: null,
  matchedText: null,
  reasonCodes: ["privacy_prompt_absent"],
};

const loginAbsent = {
  state: "absent",
  markerSource: "none",
  selectorCategory: null,
  tagName: null,
  role: null,
  visible: null,
  hasInteractiveControls: null,
  insideNavigation: null,
  blocksMainContent: null,
  matchedText: null,
  reasonCodes: ["login_wall_absent"],
};

function diagnosticSignals(captcha = false) {
  return {
    readyState: "complete",
    title: captcha ? "Robot Check" : "Bound Amazon product",
    visibleText: captcha ? "Robot Check" : "Amazon product page",
    visibleTextLength: captcha ? 11 : 1_000,
    markerSources: {
      amazonBrand: "primary",
      searchBox: "primary",
      deliveryEntry: "primary",
    },
    markers: {
      amazonBrand: true,
      searchBox: true,
      deliveryEntry: true,
      regionSelection: false,
      privacyPrompt: privacyAbsent,
      captcha,
      loginWall: loginAbsent,
      errorPage: false,
      browserInternalError: false,
    },
  };
}

function productSignals(asin: string) {
  return {
    expectedAsin: asin,
    observedAsin: asin,
    identityConfirmed: true,
    title: "Six shelf hanging closet organizer",
    variantText: "Color: Grey",
    dimensionsAndWeight: [{ label: "Product Dimensions", value: "12 x 12 x 47 inches" }],
    materialAndConstruction: [{ label: "Material", value: "Nonwoven fabric" }],
    featureBullets: ["Six shelves", "Hangs from closet rod"],
    reviewSnippets: ["The shelves sagged after long use."],
    markerCounts: { title: 1, detailRows: 2, featureBullets: 2, reviewSnippets: 1 },
  };
}

function makeBrief(): Stage15EffectivenessRevalidationBrief {
  const body = {
    schemaVersion: "stage15-effectiveness-revalidation-brief.v1" as const,
    briefId: "stage15-revalidation-test",
    status: "pending_user_authorization" as const,
    sourceProtocolHash: "protocol-hash",
    sourceBlindPacketHash: "packet-hash",
    createdAt: "2026-07-15T00:00:00.000Z",
    browserIsolation: {
      browser: "system_chrome" as const,
      profile: "new_temporary_anonymous_profile" as const,
      control: "loopback_dynamic_cdp" as const,
      initialPage: "about:blank" as const,
      dailyProfileForbidden: true,
      loginForbidden: true,
    },
    accessBudget: {
      runs: 1 as const,
      initialPages: 1 as const,
      productDetailNavigations: 10 as const,
      searchNavigations: 0 as const,
      retries: 0 as const,
    },
    allowedScope: {
      origin: "https://www.amazon.com" as const,
      pathPattern: "/dp/{boundASIN}" as const,
      targetCount: 10 as const,
      redirectsOutsideOriginAllowed: false,
      productVariantsOrAdditionalLinksAllowed: false,
    },
    targets: Array.from({ length: 10 }, (_, index) => {
      const asin = `B00000000${index}`;
      return {
        pilotItemId: `pilot-${index}`,
        origin: "https://www.amazon.com" as const,
        safePath: `/dp/${asin}`,
        sourceUrlHash: stableHash({ origin: "https://www.amazon.com", safePath: `/dp/${asin}` }),
      };
    }),
    evidenceWhitelist: [
      "identity_reconfirmed_by_new_traceable_evidence",
      "product_function_and_variant_clarified",
      "dimensions_weight_or_missing_reason_recorded",
      "material_construction_or_missing_reason_recorded",
      "assembly_usage_and_execution_risks_checked",
      "independent_counter_evidence_checked",
    ],
    prohibitedInputs: ["full_html_or_full_page_text"],
    stopConditions: ["captcha_or_robot_check", "unknown_page_or_layout"],
    outputBoundary: {
      evidenceOnly: true,
      outcomeAutoDecisionAllowed: false,
      stage1OrStage15MutationAllowed: false,
      stage2OrCandidateCreationAllowed: false,
      databaseWriteAllowed: false,
    },
    cleanupRequired: [
      "close_pages_and_browser",
      "release_dynamic_port",
      "delete_temporary_profile",
      "restore_chrome_process_baseline",
    ],
    userAuthorization: null,
    externalWebsiteAccessed: false as const,
    stage2FieldsConsumed: false as const,
    productionDatabaseWritten: false as const,
    externalAiApiCalled: false as const,
  };
  return { ...body, briefHash: stableHash(body) };
}

const cleanup: HumanAssistedBrowserCleanup = {
  pageClosed: true,
  browserClosed: true,
  forcedTerminationUsed: false,
  debugPortReleased: true,
  profileRemoved: true,
  browserProcessBaselineRestored: true,
};

function navigation(url: string): PublicPageNavigationResult {
  return {
    requestedUrl: url,
    finalUrl: url,
    redirectOrigins: [],
    redirectCount: 0,
    mainDocumentHttpStatus: 200,
    mainDocumentContentType: "text/html; charset=UTF-8",
    navigationElapsedMs: 100,
    domWaitElapsedMs: 50,
    readyState: "complete",
    allowedFinalOrigin: true,
  };
}

function sessionWith(options: { captchaAt?: number } = {}): IsolatedPublicBrowserSession {
  let count = 0;
  let currentAsin = "";
  let evaluateCount = 0;
  return {
    browser: "chrome",
    browserLocationType: "system",
    browserVersion: "Chrome/test",
    profileId: "isolated-test-profile",
    profileLocationType: "system_temp",
    debugPort: 45_555,
    get navigationCount() { return count; },
    navigate: async (url) => {
      count += 1;
      currentAsin = new URL(url).pathname.split("/").at(-1) ?? "";
      evaluateCount = 0;
      return navigation(url);
    },
    evaluateDomByValue: async <T>() => {
      evaluateCount += 1;
      if (evaluateCount === 1) return diagnosticSignals(count === options.captchaAt) as T;
      return productSignals(currentAsin) as T;
    },
    close: async () => cleanup,
  };
}

function textNode(text: string) {
  return {
    textContent: text,
    getAttribute: () => null,
    querySelector: () => null,
  };
}

function fixtureProductDocument() {
  const detailRows = [
    {
      querySelector(selector: string) {
        if (selector === "th") return textNode("Product Dimensions");
        if (selector === "td") return textNode("12 x 12 x 47 inches");
        return null;
      },
    },
    {
      querySelector(selector: string) {
        if (selector === "th") return textNode("Material");
        if (selector === "td") return textNode("Nonwoven fabric");
        return null;
      },
    },
  ];
  return {
    querySelector(selector: string) {
      if (selector === "#ASIN") {
        return { ...textNode(""), getAttribute: (name: string) => name === "value" ? "B000000000" : null };
      }
      if (selector === "#productTitle") return textNode(" Six shelf organizer ");
      if (selector.includes("#variation_color_name")) return textNode("Grey");
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector.includes("productDetails") && selector.includes("tr")) return detailRows;
      if (selector.includes("#feature-bullets")) {
        return [textNode("Six shelves"), textNode("Hangs from closet rod")];
      }
      if (selector.includes("review-collapsed")) {
        return [textNode("The shelves sagged after long use.")];
      }
      return [];
    },
  } as unknown as Document;
}

describe("Stage 1.5 effectiveness A revalidation", () => {
  it("freezes the exact user authorization phrase", () => {
    expect(STAGE15_EFFECTIVENESS_REVALIDATION_AUTHORIZATION_PHRASE).toBe(
      "\u6211\u786e\u8ba4\u6309 stage15-effectiveness-revalidation-brief.v1 \u56fa\u5b9a\u8303\u56f4\u6267\u884c\u4e00\u6b21 A \u72ec\u7acb\u8bc1\u636e\u590d\u9a8c\u3002",
    );
  });

  it("extracts only bounded main-product evidence from a product detail fixture", () => {
    const evidence = inspectStage15AmazonProductDetailDom(fixtureProductDocument(), "B000000000");
    expect(evidence).toMatchObject({
      observedAsin: "B000000000",
      identityConfirmed: true,
      title: "Six shelf organizer",
      variantText: "Grey",
    });
    expect(evidence.dimensionsAndWeight).toEqual([
      { label: "Product Dimensions", value: "12 x 12 x 47 inches" },
    ]);
    expect(evidence.materialAndConstruction).toEqual([
      { label: "Material", value: "Nonwoven fabric" },
    ]);
  });

  it("stops without retry after a captcha and still proves owned-browser cleanup", async () => {
    const result = await executeAuthorizedStage15EffectivenessRevalidation({
      brief: makeBrief(),
      authorizationPhrase: STAGE15_EFFECTIVENESS_REVALIDATION_AUTHORIZATION_PHRASE,
      capturedAt: "2026-07-16T12:00:00.000Z",
      openSession: async () => sessionWith({ captchaAt: 2 }),
    });
    expect(result.run).toMatchObject({
      status: "failed_closed",
      errorCode: "captcha",
      navigationBudget: { maximum: 10, used: 2, retries: 0, searchNavigations: 0 },
      evidenceCount: 1,
      cleanup,
    });
    expect(result.run.pages).toHaveLength(2);
  });

  it("collects ten evidence-only records without creating outcomes or downstream state", async () => {
    const result = await executeAuthorizedStage15EffectivenessRevalidation({
      brief: makeBrief(),
      authorizationPhrase: STAGE15_EFFECTIVENESS_REVALIDATION_AUTHORIZATION_PHRASE,
      capturedAt: "2026-07-16T12:00:00.000Z",
      openSession: async () => sessionWith(),
    });
    expect(result.run).toMatchObject({
      status: "evidence_collected_pending_human_evaluation",
      errorCode: null,
      navigationBudget: { maximum: 10, used: 10, retries: 0, searchNavigations: 0 },
      evidenceCount: 10,
      stage1OrStage15Mutated: false,
      stage2FieldsConsumed: false as const,
      candidateGenerated: false,
      databaseWritten: false,
      externalAiOrPaidApiCalled: false,
      cleanup,
    });
    expect(result.run.pages).toHaveLength(10);
    expect(result.run.pages.every((page) => page.sourceType === "direct_observation")).toBe(true);
    expect(result.run).not.toHaveProperty("outcomeDecision");
  });
});
