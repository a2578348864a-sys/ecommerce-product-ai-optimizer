import type { CollectionPageStatus } from "../../../lib/upstream/contracts";

export type AmazonEnvironmentSignals = {
  pageStatus: CollectionPageStatus;
  pageErrorCode?: string | null;
  pageUrl: string;
  amazonBrandMarkerPresent: boolean;
  deliveryRegion: string | null;
  language: string | null;
  currencyPreference: string | null;
};

export type AmazonEnvironmentGateResult = {
  status: "passed" | "failed";
  failedStage:
    | "page_status"
    | "marketplace_verification"
    | "delivery_verification"
    | "language_verification"
    | "currency_verification"
    | null;
  errorCodes: string[];
  canSearch: boolean;
  observed: {
    marketplace: "amazon.com" | null;
    market: "US" | null;
    deliveryRegion: string | null;
    language: string | null;
    currency: string | null;
  };
  observedEvidence: {
    marketplace: AmazonObservedFieldEvidence<"amazon.com">;
    market: AmazonObservedFieldEvidence<"US">;
    deliveryRegion: AmazonObservedFieldEvidence<string>;
    language: AmazonObservedFieldEvidence<string>;
    currency: AmazonObservedFieldEvidence<string>;
  };
};

type AmazonObservedFieldEvidence<T> = {
  value: T | null;
  evidenceSource: string;
  confidence: "high" | "unknown";
  satisfiesFieldGate: boolean;
};

function hasAmazonMarketplaceEvidence(signals: AmazonEnvironmentSignals): boolean {
  try {
    const url = new URL(signals.pageUrl);
    return url.protocol === "https:"
      && (url.hostname === "amazon.com" || url.hostname === "www.amazon.com")
      && signals.amazonBrandMarkerPresent;
  } catch {
    return false;
  }
}

function hasExplicitUsDelivery(deliveryRegion: string | null): boolean {
  if (!deliveryRegion) return false;
  // V3R（Research→Creative Consistency）：与 applyDeliveryPostalCode 的放宽口径保持一致——
  // ZIP（10001）或英文 US 区域标记任一即视为美国配送环境；本地化/简版页面常只显示其一，
  // 旧逻辑双标记必选导致真实 US 环境误判非 US。
  // 注意：不把 "deliver to" 当作独立标记（"Deliver to Japan" 会误判）；区域词本身已覆盖
  // "Deliver to New York / United States" 等常见页面文案。
  return /\b10001\b/.test(deliveryRegion)
    || /\b(?:new york|ny|united states|usa)\b/i.test(deliveryRegion);
}

export function evaluateAmazonEnvironment(signals: AmazonEnvironmentSignals): AmazonEnvironmentGateResult {
  const marketplace = hasAmazonMarketplaceEvidence(signals) ? "amazon.com" as const : null;
  const usDelivery = hasExplicitUsDelivery(signals.deliveryRegion);
  const language = signals.language?.trim().toLowerCase() ?? null;
  const currencyPreference = signals.currencyPreference?.trim().toUpperCase() ?? null;
  const observed = {
    marketplace,
    market: marketplace && usDelivery ? "US" as const : null,
    deliveryRegion: signals.deliveryRegion,
    language,
    currency: currencyPreference,
  };
  const observedEvidence: AmazonEnvironmentGateResult["observedEvidence"] = {
    marketplace: {
      value: marketplace,
      evidenceSource: "final_url_and_amazon_brand_marker",
      confidence: marketplace ? "high" : "unknown",
      satisfiesFieldGate: marketplace !== null,
    },
    market: {
      value: observed.market,
      evidenceSource: "marketplace_and_delivery_region",
      confidence: observed.market ? "high" : "unknown",
      satisfiesFieldGate: observed.market !== null,
    },
    deliveryRegion: {
      value: signals.deliveryRegion,
      evidenceSource: "delivery_entry_text",
      confidence: signals.deliveryRegion ? "high" : "unknown",
      satisfiesFieldGate: usDelivery,
    },
    language: {
      value: language,
      evidenceSource: "document_language",
      confidence: language ? "high" : "unknown",
      satisfiesFieldGate: language === "en-us",
    },
    currency: {
      value: observed.currency,
      evidenceSource: "explicit_currency_observation",
      confidence: currencyPreference ? "high" : "unknown",
      satisfiesFieldGate: currencyPreference === "USD",
    },
  };

  if (signals.pageStatus !== "ok") {
    return {
      status: "failed",
      failedStage: "page_status",
      errorCodes: [signals.pageErrorCode ?? signals.pageStatus],
      canSearch: false,
      observed,
      observedEvidence,
    };
  }
  if (!marketplace) {
    return {
      status: "failed", failedStage: "marketplace_verification", errorCodes: ["marketplace_unconfirmed"],
      canSearch: false, observed, observedEvidence,
    };
  }
  if (!usDelivery) {
    return {
      status: "failed", failedStage: "delivery_verification", errorCodes: ["delivery_region_not_us"],
      canSearch: false, observed, observedEvidence,
    };
  }
  if (language !== "en-us") {
    return {
      status: "failed", failedStage: "language_verification", errorCodes: ["language_not_en_us"],
      canSearch: false, observed, observedEvidence,
    };
  }
  if (currencyPreference !== "USD") {
    return {
      status: "failed", failedStage: "currency_verification", errorCodes: ["currency_not_usd"],
      canSearch: false, observed, observedEvidence,
    };
  }
  return { status: "passed", failedStage: null, errorCodes: [], canSearch: true, observed, observedEvidence };
}
