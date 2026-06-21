import { NextRequest, NextResponse } from "next/server";
import { buildListingCopyPrompt } from "@/lib/cross-border/prompts";
import { callAiJson, getSafeAiClientErrorMessage } from "@/lib/server/aiClient";
import { checkAccessPassword } from "@/lib/server/accessPassword";
import type {
  AiAnalysisResult,
  CrossBorderProductInput,
  CurrencyCode,
  KeywordGenerationResult,
  ListingCopyResult,
  ProfitCalculationResult,
  StructuredListingData,
  TargetPlatform,
} from "@/lib/types";
import { CROSS_BORDER_PLATFORMS } from "@/lib/types";
import { appendUnique, sanitizeStringArray, sanitizeUnsupportedCertificationClaims } from "@/lib/server/alphaSafety";

export const runtime = "nodejs";
export const maxDuration = 60;

const REQUEST_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_AFTER_SALES =
  "Please contact the seller if you have any questions after receiving the product. Final service terms are subject to the store policy and platform rules.";

type ApiError = {
  code: string;
  message: string;
};

type ApiResponse =
  | { ok: true; data: ListingCopyResult }
  | { ok: false; error: ApiError };

type ListingCopyRequest = {
  product: CrossBorderProductInput;
  profit?: ProfitCalculationResult;
  listingPreview?: StructuredListingData;
  aiAnalysis?: AiAnalysisResult;
  keywords?: KeywordGenerationResult;
};

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown) {
  const text = asString(value);
  return text || undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asNumberWithDefault(value: unknown, fallback = 0) {
  return asNumber(value) ?? fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
}

function asTargetPlatform(value: unknown): TargetPlatform | undefined {
  return CROSS_BORDER_PLATFORMS.includes(value as TargetPlatform) ? value as TargetPlatform : undefined;
}

function asCurrencyCode(value: unknown): CurrencyCode | undefined {
  const text = asString(value);
  return text ? text as CurrencyCode : undefined;
}

function parseProduct(value: unknown): CrossBorderProductInput | null {
  if (!isRecord(value)) return null;

  const name = asString(value.name);
  if (!name) return null;

  return {
    id: asOptionalString(value.id),
    sku: asOptionalString(value.sku),
    name,
    description: asOptionalString(value.description),
    purchasePrice: asNumber(value.purchasePrice),
    domesticShippingFee: asNumber(value.domesticShippingFee),
    weight: asNumber(value.weight),
    packageLength: asNumber(value.packageLength),
    packageWidth: asNumber(value.packageWidth),
    packageHeight: asNumber(value.packageHeight),
    targetCountry: asOptionalString(value.targetCountry),
    targetPlatform: asTargetPlatform(value.targetPlatform),
    currency: asCurrencyCode(value.currency),
    internationalShippingFee: asNumber(value.internationalShippingFee),
    commissionRate: asNumber(value.commissionRate),
    expectedProfitRate: asNumber(value.expectedProfitRate),
    otherCost: asNumber(value.otherCost),
    stock: asNumber(value.stock),
    imagePaths: asStringArray(value.imagePaths),
    status: asOptionalString(value.status) as CrossBorderProductInput["status"],
    createdAt: asOptionalString(value.createdAt),
    updatedAt: asOptionalString(value.updatedAt),
  };
}

function parseProfit(value: unknown): ProfitCalculationResult | undefined {
  if (!isRecord(value)) return undefined;

  return {
    baseCost: asNumberWithDefault(value.baseCost),
    totalFixedCost: asNumberWithDefault(value.totalFixedCost),
    commissionRate: asNumberWithDefault(value.commissionRate),
    suggestedPrice: asNumberWithDefault(value.suggestedPrice),
    breakEvenPrice: asNumberWithDefault(value.breakEvenPrice),
    commissionAmount: asNumberWithDefault(value.commissionAmount),
    grossProfit: asNumberWithDefault(value.grossProfit),
    grossMargin: asNumberWithDefault(value.grossMargin),
    roi: asNumberWithDefault(value.roi),
    currency: asCurrencyCode(value.currency) || "USD",
    warnings: asStringArray(value.warnings),
  };
}

function parseListingPreview(value: unknown): StructuredListingData | undefined {
  if (!isRecord(value)) return undefined;

  const dimensions = isRecord(value.dimensions) ? value.dimensions : {};

  return {
    sku: asString(value.sku) || "未提供",
    title: asString(value.title) || "未提供",
    price: asNumberWithDefault(value.price),
    stock: Math.max(0, Math.trunc(asNumberWithDefault(value.stock))),
    targetPlatform: asTargetPlatform(value.targetPlatform) || "other",
    targetCountry: asString(value.targetCountry) || "用户未填写",
    categorySuggestion: asString(value.categorySuggestion) || "待人工复核",
    attributes: isRecord(value.attributes)
      ? Object.fromEntries(Object.entries(value.attributes).map(([key, item]) => [key, String(item)]))
      : {},
    keywords: asStringArray(value.keywords),
    bulletPoints: asStringArray(value.bulletPoints),
    description: asString(value.description) || "未提供",
    weight: asNumber(value.weight),
    dimensions: {
      length: asNumber(dimensions.length),
      width: asNumber(dimensions.width),
      height: asNumber(dimensions.height),
    },
    imagePaths: asStringArray(value.imagePaths),
    riskNotes: asStringArray(value.riskNotes),
    confirmStatus: value.confirmStatus === "confirmed" || value.confirmStatus === "needs_edit"
      ? value.confirmStatus
      : "pending",
  };
}

function normalizeRecommendation(value: unknown): AiAnalysisResult["recommendation"] {
  if (value === "recommend") return "recommend";
  if (value === "reject" || value === "not_recommend") return "reject";
  return "caution";
}

function clampScore(value: unknown) {
  const score = asNumber(value);
  if (score === undefined) return 50;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "适合", "是"].includes(normalized)) return true;
    if (["false", "no", "不适合", "否"].includes(normalized)) return false;
  }
  return false;
}

function parseAiAnalysis(value: unknown): AiAnalysisResult | undefined {
  if (!isRecord(value)) return undefined;

  return {
    recommendation: normalizeRecommendation(value.recommendation),
    score: clampScore(value.score),
    reasons: asStringArray(value.reasons),
    risks: asStringArray(value.risks),
    targetAudience: asStringArray(value.targetAudience),
    scenarios: asStringArray(value.scenarios),
    platformFit: asString(value.platformFit) || "待人工复核",
    logisticsRisk: asString(value.logisticsRisk) || "待人工复核",
    afterSalesRisk: asString(value.afterSalesRisk) || "待人工复核",
    infringementRisk: asString(value.infringementRisk) || "待人工复核",
    sensitiveCategoryRisk: asString(value.sensitiveCategoryRisk) || "待人工复核",
    newbieFriendly: asBoolean(value.newbieFriendly),
  };
}

function parseKeywords(value: unknown): KeywordGenerationResult | undefined {
  if (!isRecord(value)) return undefined;

  return {
    coreKeywords: normalizeStringArray(value.coreKeywords, 10),
    longTailKeywords: normalizeStringArray(value.longTailKeywords, 10),
    searchTerms: normalizeStringArray(value.searchTerms, 10),
    titleKeywords: normalizeStringArray(value.titleKeywords, 10),
    sellingPointKeywords: normalizeStringArray(value.sellingPointKeywords, 10),
    riskWords: normalizeStringArray(value.riskWords, 10),
    negativeKeywords: normalizeStringArray(value.negativeKeywords, 10),
    platformNotes: asString(value.platformNotes) || "关键词结果需人工复核。",
  };
}

function parseListingCopyRequest(raw: unknown): { value?: ListingCopyRequest; error?: ApiError } {
  if (!isRecord(raw)) {
    return { error: { code: "invalid_body", message: "请求体必须是 JSON object。" } };
  }

  const product = parseProduct(raw.product);
  if (!product) {
    return { error: { code: "invalid_product", message: "请至少提供商品名称。" } };
  }

  return {
    value: {
      product,
      profit: parseProfit(raw.profit),
      listingPreview: parseListingPreview(raw.listingPreview),
      aiAnalysis: parseAiAnalysis(raw.aiAnalysis),
      keywords: parseKeywords(raw.keywords),
    },
  };
}

function normalizeStringArray(value: unknown, maxItems: number) {
  const seen = new Set<string>();

  return asStringArray(value)
    .filter((item) => {
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, maxItems);
}

function truncateTitle(value: string) {
  if (value.length <= 180) return value;
  return value.slice(0, 177).trimEnd();
}

function normalizeFaq(value: unknown): ListingCopyResult["faq"] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const question = sanitizeUnsupportedCertificationClaims(asString(item.question));
      const answer = sanitizeUnsupportedCertificationClaims(asString(item.answer));
      return question && answer ? { question, answer } : null;
    })
    .filter((item): item is { question: string; answer: string } => item !== null)
    .slice(0, 8);
}

function normalizeListingCopyResult(raw: unknown): ListingCopyResult {
  const source = isRecord(raw) ? raw : {};
  const notes = sanitizeStringArray(normalizeStringArray(source.notes, 10));

  return {
    title: truncateTitle(sanitizeUnsupportedCertificationClaims(asString(source.title))),
    bulletPoints: sanitizeStringArray(normalizeStringArray(source.bulletPoints, 5)),
    description: sanitizeUnsupportedCertificationClaims(asString(source.description)),
    shortDescription: sanitizeUnsupportedCertificationClaims(asString(source.shortDescription)),
    keywords: sanitizeStringArray(normalizeStringArray(source.keywords, 10)),
    longTailKeywords: sanitizeStringArray(normalizeStringArray(source.longTailKeywords, 10)),
    faq: normalizeFaq(source.faq),
    packingList: sanitizeStringArray(normalizeStringArray(source.packingList, 20)),
    afterSales: sanitizeUnsupportedCertificationClaims(asString(source.afterSales)) || DEFAULT_AFTER_SALES,
    notes: appendUnique(notes, [
      "Certification details should be confirmed with the supplier before sale.",
      "Manual review is required before using any safety, material, or compliance claim.",
    ], 10),
  };
}

function toSafeError(error: ApiError): ApiError {
  return {
    code: error.code,
    message: error.message,
  };
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonResponse({
      ok: false,
      error: { code: "body_too_large", message: "请求体过大，请减少商品描述、图片路径或分析内容。" },
    }, 400);
  }

  let rawText = "";
  try {
    rawText = await request.text();
  } catch {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_body", message: "无法读取请求体。" },
    }, 400);
  }

  if (new TextEncoder().encode(rawText).length > REQUEST_BODY_LIMIT_BYTES) {
    return jsonResponse({
      ok: false,
      error: { code: "body_too_large", message: "请求体过大，请减少商品描述、图片路径或分析内容。" },
    }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = rawText ? JSON.parse(rawText) : {};
  } catch {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_json", message: "请求体不是合法 JSON。" },
    }, 400);
  }

  const authError = checkAccessPassword(request, isRecord(rawBody) ? rawBody : undefined);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  const parsed = parseListingCopyRequest(rawBody);
  if (!parsed.value) {
    return jsonResponse({
      ok: false,
      error: parsed.error || { code: "invalid_body", message: "请求参数不正确。" },
    }, 400);
  }

  const prompt = buildListingCopyPrompt(parsed.value);
  const aiResult = await callAiJson<unknown>({
    messages: [
      {
        role: "system",
        content: "You only return valid JSON. Do not use Markdown. Do not add explanations.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.25,
    maxTokens: 2200,
  });

  if (!aiResult.ok) {
    return jsonResponse({
      ok: false,
      error: toSafeError({
        code: aiResult.error.code,
        message: getSafeAiClientErrorMessage(aiResult.error.code),
      }),
    }, 500);
  }

  return jsonResponse({
    ok: true,
    data: normalizeListingCopyResult(aiResult.data),
  });
}
