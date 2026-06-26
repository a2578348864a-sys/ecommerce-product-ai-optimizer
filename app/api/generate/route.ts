import { NextRequest, NextResponse } from "next/server";
import {
  buildRadarPrompt,
  DEEPSEEK_JSON_FORMAT_INSTRUCTION,
  radarJsonSchema,
} from "@/lib/prompt";
import { callAiText, getAiConfig, getSafeAiClientErrorMessage } from "@/lib/server/aiClient";
import { requireAuthenticated, ensureDemoAiQuota, consumeDemoAiCalls, type DemoAccessSnapshot } from "@/lib/server/demoGuard";
import {
  defaultPlatformStatus,
  inputLimits,
  platformOptions,
  reportDisclaimer,
} from "@/lib/types";
import type {
  CandidateProduct,
  ConfidenceField,
  ConfidenceLevel,
  EvidenceCard,
  FinalDecision,
  GenerateErrorResponse,
  HotProductRadarResult,
  MaterialInput,
  MaterialType,
  Platform,
  PlatformSearchStatus,
  RadarFormInput,
  RiskWarning,
  TrafficLightRisk,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_OUTPUT_TOKENS = 10000;
const REQUEST_BODY_LIMIT_BYTES = 128 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const OPENAI_TIMEOUT_MS = 60 * 1000;
const GENERATION_ERROR = "生成失败，请检查 API Key、模型名称、余额或稍后重试。";

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitRecord>();

function jsonError(error: string, status = 400, fieldErrors?: GenerateErrorResponse["fieldErrors"]) {
  return NextResponse.json({ error, fieldErrors }, { status });
}

function getAccessPassword() {
  return process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD;
}

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") || "unknown";
}

function checkRateLimit(ip: string) {
  const now = Date.now();
  const existing = rateLimitStore.get(ip);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  existing.count += 1;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getTrimmedString(body: Record<string, unknown>, field: string) {
  const value = body[field];
  return typeof value === "string" ? value.trim() : "";
}

function getBoolean(body: Record<string, unknown>, field: string, fallback = false) {
  return typeof body[field] === "boolean" ? Boolean(body[field]) : fallback;
}

function getStringArray(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function getSelectedPlatforms(body: Record<string, unknown>): Platform[] {
  const selected = getStringArray(body, "selectedPlatforms").filter((item): item is Platform =>
    platformOptions.includes(item as Platform),
  );
  return selected.length ? selected : ["manual"];
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asPlatform(value: unknown): Platform | "unknown" {
  return platformOptions.includes(value as Platform) ? value as Platform : "unknown";
}

function asConfidenceLevel(value: unknown): ConfidenceLevel {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function asFinalDecision(value: unknown): FinalDecision {
  return value === "recommend" || value === "caution" || value === "reject" ? value : "caution";
}

function asTrafficLight(value: unknown): "green" | "yellow" | "red" {
  return value === "green" || value === "yellow" || value === "red" ? value : "yellow";
}

function normalizeConfidenceField(value: unknown): ConfidenceField {
  const source = isPlainObject(value) ? value : {};
  return {
    fieldName: asString(source.fieldName),
    value: asString(source.value),
    confidence: asConfidenceLevel(source.confidence),
    reason: asString(source.reason),
  };
}

function normalizeMaterial(value: unknown): MaterialInput {
  const source = isPlainObject(value) ? value : {};
  const type = source.type === "url" || source.type === "image" || source.type === "text" ? source.type : "text";
  return {
    id: asString(source.id, crypto.randomUUID()),
    type,
    sourceName: asString(source.sourceName),
    originalUrl: asString(source.originalUrl),
    cleanedUrl: asString(source.cleanedUrl),
    fileName: asString(source.fileName),
    mimeType: asString(source.mimeType),
    size: asNumber(source.size),
    rawText: asString(source.rawText),
    previewUrl: "",
    createdAt: asString(source.createdAt, new Date().toISOString()),
  };
}

function normalizeEvidenceCard(value: unknown): EvidenceCard {
  const source = isPlainObject(value) ? value : {};
  const materialType: MaterialType =
    source.materialType === "url" || source.materialType === "image" || source.materialType === "text"
      ? source.materialType
      : "text";
  const confidenceFields = Array.isArray(source.confidenceFields)
    ? source.confidenceFields.map(normalizeConfidenceField)
    : [];

  return {
    id: asString(source.id, crypto.randomUUID()),
    materialId: asString(source.materialId),
    materialType,
    detectedMaterialType: asString(source.detectedMaterialType, materialType === "image" ? "product_image" : "manual_text") as EvidenceCard["detectedMaterialType"],
    status: asString(source.status, "partial") as EvidenceCard["status"],
    missingFields: asStringArray(source.missingFields),
    message: asString(source.message),
    riskNotes: asString(source.riskNotes),
    userNotes: asString(source.userNotes),
    productName: asString(source.productName),
    normalizedProductName: asString(source.normalizedProductName || source.productName),
    priceText: asString(source.priceText),
    salesText: asString(source.salesText),
    ratingText: asString(source.ratingText),
    rankText: asString(source.rankText),
    shopName: asString(source.shopName),
    brandName: asString(source.brandName),
    pageTitle: asString(source.pageTitle),
    visibleDescription: asString(source.visibleDescription),
    sourceUrl: asString(source.sourceUrl),
    platform: asPlatform(source.platform),
    rawEvidenceText: asString(source.rawEvidenceText),
    capturedAt: asString(source.capturedAt, new Date().toISOString()),
    confidenceFields,
  };
}

function getMaterials(body: Record<string, unknown>) {
  const value = body.materials;
  return Array.isArray(value) ? value.map(normalizeMaterial) : [];
}

function getEvidenceCards(body: Record<string, unknown>) {
  const value = body.evidenceCards;
  return Array.isArray(value) ? value.map(normalizeEvidenceCard) : [];
}

function validateInput(body: unknown) {
  const fieldErrors: GenerateErrorResponse["fieldErrors"] = {};

  if (!isPlainObject(body)) {
    return {
      value: null,
      fieldErrors: { keyword: "请求体格式不正确。" },
    };
  }

  const value: RadarFormInput = {
    keyword: getTrimmedString(body, "keyword"),
    analysisGoal: getTrimmedString(body, "analysisGoal") || "全部分析",
    targetPriceRange: getTrimmedString(body, "targetPriceRange"),
    targetAudience: getTrimmedString(body, "targetAudience"),
    excludedCategories: getTrimmedString(body, "excludedCategories"),
    selectedPlatforms: getSelectedPlatforms(body),
    personalLimits: getStringArray(body, "personalLimits"),
    notes: getTrimmedString(body, "notes"),
    linksText: getTrimmedString(body, "linksText"),
    manualText: getTrimmedString(body, "manualText"),
    lowTokenMode: getBoolean(body, "lowTokenMode", true),
    materials: getMaterials(body),
    evidenceCards: getEvidenceCards(body),
  };

  if (!value.keyword) {
    fieldErrors.keyword = "请输入关键词或品类。";
  }

  if (!value.evidenceCards.length && !value.manualText && !value.linksText && !value.materials.length) {
    fieldErrors.manualText = "请先上传图片、粘贴链接或粘贴商品信息，再识别证据。";
  }

  for (const [field, limit] of Object.entries(inputLimits) as Array<[keyof RadarFormInput, number]>) {
    const currentValue = value[field];
    if (typeof currentValue === "string" && currentValue.length > limit) {
      fieldErrors[field] = `最多输入 ${limit} 个字符。`;
    }
  }

  return { value, fieldErrors };
}

function normalizeSourcingKeywords(value: unknown): CandidateProduct["sourcingKeywords"] {
  const source = isPlainObject(value) ? value : {};
  return {
    source1688: asStringArray(source.source1688),
    pdd: asStringArray(source.pdd),
    taobao: asStringArray(source.taobao),
    specsAndMaterials: asStringArray(source.specsAndMaterials),
    differentiation: asStringArray(source.differentiation),
  };
}

function normalizeCandidate(value: unknown): CandidateProduct {
  const source = isPlainObject(value) ? value : {};
  return {
    productName: asString(source.productName),
    normalizedProductName: asString(source.normalizedProductName || source.productName),
    platform: asString(source.platform),
    priceText: asString(source.priceText),
    salesText: asString(source.salesText),
    ratingText: asString(source.ratingText),
    rankText: asString(source.rankText),
    shopName: asString(source.shopName),
    brandName: asString(source.brandName),
    productUrl: asString(source.productUrl),
    sourceUrl: asString(source.sourceUrl),
    capturedAt: asString(source.capturedAt, new Date().toISOString()),
    sourcePlatform: asString(source.sourcePlatform || source.platform || "manual"),
    rawEvidenceText: asString(source.rawEvidenceText),
    evidenceText: asString(source.evidenceText || source.rawEvidenceText),
    riskTags: asStringArray(source.riskTags),
    hotScore: asNumber(source.hotScore),
    beginnerFitScore: asNumber(source.beginnerFitScore),
    competitionScore: asNumber(source.competitionScore),
    afterSalesRiskScore: asNumber(source.afterSalesRiskScore),
    ipRiskScore: asNumber(source.ipRiskScore),
    logisticsRiskScore: asNumber(source.logisticsRiskScore),
    grossMarginPotentialScore: asNumber(source.grossMarginPotentialScore),
    finalScore: asNumber(source.finalScore),
    hotReason: asString(source.hotReason),
    beginnerFitReason: asString(source.beginnerFitReason),
    competitionRisk: asString(source.competitionRisk),
    afterSalesRisk: asString(source.afterSalesRisk),
    ipRisk: asString(source.ipRisk),
    logisticsRisk: asString(source.logisticsRisk),
    estimatedCostRange: asString(source.estimatedCostRange),
    suggestedSellingPrice: asString(source.suggestedSellingPrice),
    grossMarginHint: asString(source.grossMarginHint),
    shippingDifficulty: asString(source.shippingDifficulty),
    afterSalesDifficulty: asString(source.afterSalesDifficulty),
    ipRiskLevel: asString(source.ipRiskLevel),
    sourcingKeywords: normalizeSourcingKeywords(source.sourcingKeywords),
    differentiationAngle: asString(source.differentiationAngle),
    similarDirections: asStringArray(source.similarDirections),
    finalDecision: asFinalDecision(source.finalDecision),
    reason: asString(source.reason),
  };
}

function normalizePlatformStatus(value: unknown): PlatformSearchStatus[] {
  const source = Array.isArray(value) ? value : [];
  const normalized = source
    .filter(isPlainObject)
    .map((item) => ({
      platform: (platformOptions as readonly string[]).includes(String(item.platform ?? "")) ? String(item.platform ?? "") : "manual",
      status: asString(item.status, "manual_required") as PlatformSearchStatus["status"],
      message: asString(item.message, "请手动粘贴该平台可见商品信息。"),
      itemCount: asNumber(item.itemCount),
    }));

  const seen = new Set<string>(normalized.map((item) => item.platform));
  for (const item of defaultPlatformStatus) {
    if (!seen.has(item.platform)) {
      normalized.push(item);
    }
  }
  return normalized;
}

function normalizeRiskWarning(value: unknown): RiskWarning {
  const source = isPlainObject(value) ? value : {};
  return {
    riskType: asString(source.riskType),
    level: asTrafficLight(source.level),
    relatedProducts: asStringArray(source.relatedProducts),
    reason: asString(source.reason),
    suggestion: asString(source.suggestion),
  };
}

function normalizeTrafficLight(value: unknown): TrafficLightRisk {
  const source = isPlainObject(value) ? value : {};
  return {
    name: asString(source.name),
    level: asTrafficLight(source.level),
    explanation: asString(source.explanation),
  };
}

function normalizeResult(value: unknown, input: RadarFormInput): HotProductRadarResult {
  const source = isPlainObject(value) ? value : {};
  const candidateProducts = Array.isArray(source.candidateProducts)
    ? source.candidateProducts.map(normalizeCandidate)
    : [];
  const recommendedProducts = Array.isArray(source.recommendedProducts)
    ? source.recommendedProducts.map(normalizeCandidate)
    : candidateProducts.filter((item) => item.finalDecision === "recommend");
  const cautiousProducts = Array.isArray(source.cautiousProducts)
    ? source.cautiousProducts.map(normalizeCandidate)
    : candidateProducts.filter((item) => item.finalDecision === "caution");
  const rejectedProducts = Array.isArray(source.rejectedProducts)
    ? source.rejectedProducts.map(normalizeCandidate)
    : candidateProducts.filter((item) => item.finalDecision === "reject");
  const finalDecision = asFinalDecision(source.finalDecision || (
    recommendedProducts.length ? "recommend" : rejectedProducts.length ? "reject" : "caution"
  ));

  return {
    summary: asString(source.summary, "样本不足，仅供参考。请补充更多商品、榜单或截图信息后再判断。"),
    finalDecision,
    confidenceLevel: asConfidenceLevel(source.confidenceLevel),
    sampleQuality: asString(source.sampleQuality, "样本不足，仅供参考。"),
    agentConclusion: asString(source.agentConclusion, "建议先补充证据，再做最终选品判断。"),
    platformSearchStatus: normalizePlatformStatus(source.platformSearchStatus),
    evidenceCards: Array.isArray(source.evidenceCards)
      ? source.evidenceCards.map(normalizeEvidenceCard)
      : input.evidenceCards,
    candidateProducts,
    recommendedProducts,
    cautiousProducts,
    rejectedProducts,
    platformEvidence: Array.isArray(source.platformEvidence)
      ? source.platformEvidence.filter(isPlainObject).map((item) => ({
          platform: asString(item.platform),
          evidenceSummary: asString(item.evidenceSummary),
          credibility: asString(item.credibility),
          gaps: asString(item.gaps),
        }))
      : [],
    riskWarnings: Array.isArray(source.riskWarnings) ? source.riskWarnings.map(normalizeRiskWarning) : [],
    sourcingKeywords: asStringArray(source.sourcingKeywords),
    differentiationIdeas: Array.isArray(source.differentiationIdeas)
      ? source.differentiationIdeas.filter(isPlainObject).map((item) => ({
          productDirection: asString(item.productDirection),
          angle: asString(item.angle),
          whyItMayWork: asString(item.whyItMayWork),
          contentSuggestion: asString(item.contentSuggestion),
        }))
      : [],
    similarProductDirections: asStringArray(source.similarProductDirections),
    nextActions: Array.isArray(source.nextActions)
      ? source.nextActions.filter(isPlainObject).map((item) => ({
          productDirection: asString(item.productDirection),
          action: asString(item.action),
          checklist: asStringArray(item.checklist),
          testSuggestion: item.testSuggestion === "小批量测试" || item.testSuggestion === "暂不做" || item.testSuggestion === "直接排除"
            ? item.testSuggestion
            : "先观察",
        }))
      : [],
    trafficLightRisks: Array.isArray(source.trafficLightRisks)
      ? source.trafficLightRisks.map(normalizeTrafficLight)
      : [],
    disclaimer: reportDisclaimer,
  };
}

function validateRadarResult(value: unknown) {
  if (!isPlainObject(value)) {
    return false;
  }
  return true;
}

function stripCodeFence(outputText: string) {
  const trimmed = outputText.trim();
  const fencedJson = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fencedJson?.[1] ?? trimmed).trim();
}

function repairJsonText(outputText: string) {
  const withoutFence = stripCodeFence(outputText);
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  const sliced = start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;
  return sliced
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\u0000/g, "")
    .trim();
}

function parseAiJson(outputText: string): unknown {
  const first = stripCodeFence(outputText);
  if (!first) {
    throw new Error("Empty AI response");
  }

  try {
    return JSON.parse(first);
  } catch {
    const repaired = repairJsonText(first);
    if (repaired === first) {
      throw new Error("JSON parse failed");
    }
    return JSON.parse(repaired);
  }
}

function getSafeLogPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message.slice(0, 240),
    };
  }

  return { message: "Unknown error" };
}

function getRadarResponseFormat() {
  const config = getAiConfig();
  if (config.ok && config.data.provider !== "deepseek") {
    return { type: "json_schema" as const, json_schema: radarJsonSchema };
  }

  return { type: "json_object" as const };
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonError("请求内容过长，请减少图片数量、链接数量或文字内容后再试。", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("请求体不是合法 JSON，请刷新页面后重试。", 400);
  }

  const authResult = requireAuthenticated(request, body as Record<string, unknown>);
  if (!authResult.ok) {
    return NextResponse.json({ ok: false, error: { code: authResult.code, message: authResult.message } }, { status: authResult.status });
  }
  const accessCtx = authResult.context;
  let demoScreen: DemoAccessSnapshot | null = null;

  const { value, fieldErrors } = validateInput(body);
  if (!value || Object.keys(fieldErrors || {}).length > 0) {
    return jsonError("输入信息不完整或格式不正确。", 400, fieldErrors);
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return jsonError("请求过于频繁，请 10 分钟后再试。", 429);
  }

  if (accessCtx.mode === "demo") {
    const quota = ensureDemoAiQuota(accessCtx, 1);
    if (!quota.ok) {
      return NextResponse.json({ ok: false, error: { code: quota.code, message: quota.message } }, { status: quota.status });
    }
  }

  const aiResult = await callAiText({
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: OPENAI_TIMEOUT_MS,
    responseFormat: getRadarResponseFormat(),
    messages: [
      {
        role: "system",
        content: "你只输出严格 JSON。不要输出 Markdown、解释、代码块或额外文本。",
      },
      {
        role: "user",
        content: `${buildRadarPrompt(value)}\n\n${DEEPSEEK_JSON_FORMAT_INSTRUCTION}`,
      },
    ],
  });

  if (!aiResult.ok) {
    console.error("Generate API failed", {
      code: aiResult.error.code,
      status: aiResult.error.status,
      provider: aiResult.error.provider,
      model: aiResult.error.model,
    });
    return jsonError(getSafeAiClientErrorMessage(aiResult.error.code) || GENERATION_ERROR, 500);
  }

  let parsed: unknown;
  try {
    parsed = parseAiJson(aiResult.data);
  } catch {
    return jsonError("AI 返回格式异常，已尝试修复；如果仍失败，请减少输入内容后重试。", 502);
  }

  if (!validateRadarResult(parsed)) {
    return jsonError("AI 返回结构不完整，请减少输入内容后重新生成。", 502);
  }

  if (accessCtx.mode === "demo") {
    demoScreen = consumeDemoAiCalls(accessCtx, 1);
  }

  return NextResponse.json({
    ...normalizeResult(parsed, value),
    ...(demoScreen ? { demoAccess: demoScreen } : {}),
  });
}
