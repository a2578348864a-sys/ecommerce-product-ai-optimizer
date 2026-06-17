import { NextRequest, NextResponse } from "next/server";
import { buildKeywordGenerationPrompt } from "@/lib/cross-border/prompts";
import { callAiJson, getSafeAiClientErrorMessage } from "@/lib/server/aiClient";
import type {
  AiAnalysisResult,
  CrossBorderProductInput,
  CurrencyCode,
  KeywordGenerationResult,
  ProfitCalculationResult,
  StructuredListingData,
  TargetPlatform,
} from "@/lib/types";
import { CROSS_BORDER_PLATFORMS } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const REQUEST_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_PLATFORM_NOTES = "关键词结果需人工复核，并确认目标平台规则、侵权风险和禁限售要求。";

type ApiError = {
  code: string;
  message: string;
};

type ApiResponse =
  | { ok: true; data: KeywordGenerationResult }
  | { ok: false; error: ApiError };

type KeywordsRequest = {
  product: CrossBorderProductInput;
  profit?: ProfitCalculationResult;
  listingPreview?: StructuredListingData;
  aiAnalysis?: AiAnalysisResult;
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

function parseKeywordsRequest(raw: unknown): { value?: KeywordsRequest; error?: ApiError } {
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
    },
  };
}

function normalizeKeywordArray(value: unknown) {
  const seen = new Set<string>();

  return asStringArray(value)
    .filter((item) => {
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 10);
}

function normalizeKeywordGenerationResult(raw: unknown, productName: string): KeywordGenerationResult {
  const source = isRecord(raw) ? raw : {};
  const name = productName.trim();

  const result = {
    coreKeywords: normalizeKeywordArray(source.coreKeywords),
    longTailKeywords: normalizeKeywordArray(source.longTailKeywords),
    searchTerms: normalizeKeywordArray(source.searchTerms),
    titleKeywords: normalizeKeywordArray(source.titleKeywords),
    sellingPointKeywords: normalizeKeywordArray(source.sellingPointKeywords),
    riskWords: normalizeKeywordArray(source.riskWords),
    negativeKeywords: normalizeKeywordArray(source.negativeKeywords),
    platformNotes: asString(source.platformNotes) || DEFAULT_PLATFORM_NOTES,
  };

  // Fallback: if AI returned empty for the main keyword groups, generate basic keywords from the product name
  const hasKeywords = result.coreKeywords.length > 0 || result.longTailKeywords.length > 0;
  if (!hasKeywords && name) {
    const nameParts = name.split(/\s+/).filter((p) => p.length >= 2);
    result.coreKeywords = nameParts.slice(0, 5);
    result.searchTerms = [name, ...nameParts].slice(0, 6);
    result.platformNotes = `关键词由商品名称"${name}"自动生成。建议补充商品描述、用途和卖点后重新生成，可获得更精准的关键词。`;
  } else if (!hasKeywords) {
    result.platformNotes = "商品名称未填写，无法生成关键词。请先填写商品名称和描述。";
  }

  return result;
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

  const parsed = parseKeywordsRequest(rawBody);
  if (!parsed.value) {
    return jsonResponse({
      ok: false,
      error: parsed.error || { code: "invalid_body", message: "请求参数不正确。" },
    }, 400);
  }

  const prompt = buildKeywordGenerationPrompt(parsed.value);
  const aiResult = await callAiJson<unknown>({
    messages: [
      {
        role: "system",
        content: "你只返回合法 JSON，不要 Markdown，不要解释文字。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
    maxTokens: 1600,
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
    data: normalizeKeywordGenerationResult(aiResult.data, parsed.value.product.name || ""),
  });
}
