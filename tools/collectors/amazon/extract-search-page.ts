import type {
  CollectionPageStatus,
  ObservedMarketContext,
  RequestedMarketContext,
} from "../../../lib/upstream/contracts";

export type AmazonCollectorOptions = {
  query: string;
  page: number;
  maxAppearances: number;
  capturedAt: string;
  requested: RequestedMarketContext;
  observed: ObservedMarketContext;
};

export type AmazonPageContextSignals = {
  pageUrl: string;
  amazonBrandMarkerPresent: boolean;
  deliveryRegion: string | null;
  language: string | null;
};

export type AmazonSponsoredPlacementDiagnostic = {
  schemaVersion: "amazon-sponsored-placement-diagnostic.v1";
  state: boolean | null;
  markerSource: "known_dom_selector" | "visible_text" | "known_card_structure" | "none";
  selectorCategory:
    | "aria_label_sponsored"
    | "sponsored_label_class"
    | "sponsored_component_marker"
    | "ambiguous_ad_text"
    | "standard_search_result_card"
    | "unrecognized_card_structure";
  reasonCode:
    | "sponsored_marker_present"
    | "known_organic_structure"
    | "ambiguous_ad_text_without_known_marker"
    | "insufficient_sponsored_evidence";
  matchedText: string | null;
};

export function sanitizeCollectorText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function buildCanonicalAmazonProductUrl(asin: string): string {
  const normalized = asin.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) throw new Error("AMAZON_ASIN_INVALID");
  return `https://www.amazon.com/dp/${normalized}`;
}

export function detectPriceCurrency(priceText: string | null): "USD" | "JPY" | null {
  if (!priceText) return null;
  const normalized = priceText.trim().toUpperCase();
  if (/\bJPY\b|[\u00A5\uFFE5]/.test(normalized)) return "JPY";
  if (/\bUSD\b|US\$|^\$/.test(normalized)) return "USD";
  return null;
}

export function inspectAmazonPageContext(root: Document, pageUrl: string): AmazonPageContextSignals {
  const deliveryNode = root.querySelector?.("#glow-ingress-line2, #glow-ingress-block");
  const brandMarker = root.querySelector?.("#nav-logo, [aria-label='Amazon'], [aria-label^='Amazon']");
  return {
    pageUrl,
    amazonBrandMarkerPresent: brandMarker !== null && brandMarker !== undefined,
    deliveryRegion: sanitizeCollectorText(deliveryNode?.textContent, 160),
    language: sanitizeCollectorText(root.documentElement?.getAttribute?.("lang"), 40)?.toLowerCase() ?? null,
  };
}

export function deriveObservedAmazonMarketContext(
  signals: AmazonPageContextSignals,
  sampledPriceCurrencies: Array<"USD" | "JPY" | null>,
  expectedPostalCode: string,
): ObservedMarketContext {
  let hostname: string | null = null;
  try {
    const url = new URL(signals.pageUrl);
    hostname = url.protocol === "https:" ? url.hostname.toLowerCase() : null;
  } catch {
    hostname = null;
  }
  const marketplace = signals.amazonBrandMarkerPresent && (hostname === "amazon.com" || hostname === "www.amazon.com")
    ? "amazon.com"
    : null;
  const normalizedPostalCode = expectedPostalCode.trim();
  const deliveryRegionMarket = normalizedPostalCode
    && signals.deliveryRegion?.includes(normalizedPostalCode)
    ? "US"
    : null;
  const pricedCurrencies = sampledPriceCurrencies.filter((value): value is "USD" | "JPY" => value !== null);
  const everySampleCurrencyKnown = sampledPriceCurrencies.length > 0
    && pricedCurrencies.length === sampledPriceCurrencies.length;
  const uniqueCurrencies = new Set(pricedCurrencies);
  const currency = everySampleCurrencyKnown && uniqueCurrencies.size === 1 ? pricedCurrencies[0] : null;
  const market = marketplace === "amazon.com" && deliveryRegionMarket === "US" ? "US" : null;
  return {
    marketplace,
    market,
    currency,
    deliveryRegion: signals.deliveryRegion,
    deliveryRegionMarket,
    language: signals.language,
  };
}

function detectPageStatus(bodySample: string, cardCount: number): CollectionPageStatus {
  if (/captcha|robot check|enter the characters you see|type the characters you see|验证码|机器人/i.test(bodySample)) {
    return "captcha";
  }
  if (/sign in to continue|login to continue|please sign in|登录后继续/i.test(bodySample)) return "login_wall";
  if (/sorry[, ]+something went wrong|service unavailable|internal server error|页面出错/i.test(bodySample)) {
    return "error_page";
  }
  return cardCount > 0 ? "ok" : "unknown_page";
}

export function extractSponsoredPlacementDiagnostic(
  card: HTMLElement,
  asin: string | null,
): AmazonSponsoredPlacementDiagnostic {
  const knownMarkers = [
    {
      selector: '[aria-label="Sponsored"], [aria-label^="Sponsored"]',
      selectorCategory: "aria_label_sponsored" as const,
    },
    {
      selector: ".puis-sponsored-label-text",
      selectorCategory: "sponsored_label_class" as const,
    },
    {
      selector: '[data-component-type="s-sponsored-label-marker"]',
      selectorCategory: "sponsored_component_marker" as const,
    },
  ];
  for (const knownMarker of knownMarkers) {
    const marker = card.querySelector(knownMarker.selector);
    if (!marker) continue;
    return {
      schemaVersion: "amazon-sponsored-placement-diagnostic.v1",
      state: true,
      markerSource: "known_dom_selector",
      selectorCategory: knownMarker.selectorCategory,
      reasonCode: "sponsored_marker_present",
      matchedText: sanitizeCollectorText(marker.getAttribute?.("aria-label") ?? marker.textContent, 80),
    };
  }

  const visibleText = sanitizeCollectorText(card.innerText || card.textContent, 500) ?? "";
  const ambiguousAdText = visibleText.match(/\b(?:sponsored|promoted|advertisement|ad)\b|广告|推广/i)?.[0] ?? null;
  if (ambiguousAdText) {
    return {
      schemaVersion: "amazon-sponsored-placement-diagnostic.v1",
      state: null,
      markerSource: "visible_text",
      selectorCategory: "ambiguous_ad_text",
      reasonCode: "ambiguous_ad_text_without_known_marker",
      matchedText: sanitizeCollectorText(ambiguousAdText, 40),
    };
  }

  const knownOrganicStructure = asin !== null
    && (card.querySelector("h2 a span") !== null || card.querySelector("h2 span") !== null)
    && (card.querySelector(".a-price .a-offscreen") !== null || card.querySelector("img.s-image") !== null);
  if (knownOrganicStructure) {
    return {
      schemaVersion: "amazon-sponsored-placement-diagnostic.v1",
      state: false,
      markerSource: "known_card_structure",
      selectorCategory: "standard_search_result_card",
      reasonCode: "known_organic_structure",
      matchedText: null,
    };
  }
  return {
    schemaVersion: "amazon-sponsored-placement-diagnostic.v1",
    state: null,
    markerSource: "none",
    selectorCategory: "unrecognized_card_structure",
    reasonCode: "insufficient_sponsored_evidence",
    matchedText: null,
  };
}

export function extractAmazonSearchPage(root: Document, options: AmazonCollectorOptions) {
  if (!options.query.trim()) throw new Error("COLLECTOR_QUERY_REQUIRED");
  if (!Number.isInteger(options.page) || options.page < 1 || options.page > 2) throw new Error("COLLECTOR_PAGE_OUT_OF_RANGE");
  if (!Number.isInteger(options.maxAppearances) || options.maxAppearances < 1 || options.maxAppearances > 60) {
    throw new Error("COLLECTOR_SAMPLE_BUDGET_INVALID");
  }

  const bodySample = sanitizeCollectorText(root.body?.innerText, 4000) ?? "";
  const allCards = Array.from(root.querySelectorAll<HTMLElement>('[data-component-type="s-search-result"]'));
  const pageStatus = detectPageStatus(bodySample, allCards.length);
  const observations = allCards.slice(0, options.maxAppearances).map((card, index) => {
    const rawAsin = sanitizeCollectorText(card.getAttribute("data-asin"), 20);
    const asin = rawAsin && /^[A-Z0-9]{10}$/i.test(rawAsin) ? rawAsin.toUpperCase() : null;
    const priceText = sanitizeCollectorText(card.querySelector(".a-price .a-offscreen")?.textContent, 60);
    const ratingText = sanitizeCollectorText(card.querySelector(".a-icon-alt")?.textContent, 80);
    const reviewNode = card.querySelector('a[href*="customerReviews"] span, a[href*="#customerReviews"] span');
    const imageNode = card.querySelector("img.s-image");
    const sponsoredDiagnostic = extractSponsoredPlacementDiagnostic(card, asin);
    const sponsored = sponsoredDiagnostic.state;
    const titleNode = card.querySelector("h2 a span") ?? card.querySelector("h2 span");
    return {
      appearanceKey: `canary-p${options.page}-${String(index + 1).padStart(2, "0")}`,
      page: options.page,
      position: index + 1,
      sponsored,
      sponsoredDiagnostic,
      asin,
      identityMissingReason: asin ? null : "asin_not_found",
      title: sanitizeCollectorText(titleNode?.textContent, 300),
      priceText,
      priceCurrency: detectPriceCurrency(priceText),
      ratingText,
      reviewCountText: sanitizeCollectorText(reviewNode?.textContent, 60),
      brand: null,
      productUrl: asin ? buildCanonicalAmazonProductUrl(asin) : null,
      imageUrl: sanitizeCollectorText(imageNode?.getAttribute("src"), 2048),
      capturedAt: options.capturedAt,
      fieldMissingReasons: {
        brand: "not_exposed_on_search_card",
        ...(sponsored === null ? { sponsored: "not_determined" } : {}),
        ...(priceText ? {} : { price: "not_visible" }),
        ...(ratingText ? {} : { rating: "not_visible" }),
        ...(reviewNode ? {} : { reviewCount: "not_visible" }),
        ...(imageNode ? {} : { imageUrl: "not_visible" }),
      },
    };
  });

  return {
    schemaVersion: "amazon-search-page-extraction.v2" as const,
    requested: { ...options.requested },
    observed: { ...options.observed },
    query: options.query.trim(),
    page: options.page,
    capturedAt: options.capturedAt,
    pageStatus,
    blocked: pageStatus !== "ok",
    keyContainerFound: allCards.length > 0,
    rawCardCount: allCards.length,
    sampledObservationIds: observations.map((item) => item.appearanceKey),
    diagnosticVisiblePriceNodeCount: root.querySelectorAll(".a-price .a-offscreen").length,
    observations,
  };
}

function functionSource(fn: (...args: never[]) => unknown): string {
  return fn.toString();
}

export function buildAmazonPageContextExpression(): string {
  return `(() => {
    const sanitizeCollectorText = ${functionSource(sanitizeCollectorText)};
    const inspectAmazonPageContext = ${functionSource(inspectAmazonPageContext)};
    return inspectAmazonPageContext(document, location.href);
  })()`;
}

export function buildAmazonSearchPageExtractionExpression(options: AmazonCollectorOptions): string {
  return `(() => {
    const sanitizeCollectorText = ${functionSource(sanitizeCollectorText)};
    const buildCanonicalAmazonProductUrl = ${functionSource(buildCanonicalAmazonProductUrl)};
    const detectPriceCurrency = ${functionSource(detectPriceCurrency)};
    const detectPageStatus = ${functionSource(detectPageStatus)};
    const extractSponsoredPlacementDiagnostic = ${functionSource(extractSponsoredPlacementDiagnostic)};
    const extractAmazonSearchPage = ${functionSource(extractAmazonSearchPage)};
    return extractAmazonSearchPage(document, ${JSON.stringify(options)});
  })()`;
}
