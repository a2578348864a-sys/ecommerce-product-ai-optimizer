import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import {
  alibabaJsonSchema,
  buildAlibabaPrompt,
  DEEPSEEK_JSON_FORMAT_INSTRUCTION,
} from "@/lib/prompt";
import {
  basicRequiredFields,
  categories,
  inputLimits,
} from "@/lib/types";
import type {
  AlibabaResult,
  BaseAssessment,
  InquiryTemplates,
  ProductFormInput,
  ScoreBreakdown,
  ScoreDimension,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const MAX_OUTPUT_TOKENS = 8000;
const REQUEST_BODY_LIMIT_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const OPENAI_TIMEOUT_MS = 60 * 1000;
const GENERATION_ERROR = "生成失败，请检查 API Key、模型名称、余额或稍后重试。";

type AiProvider = "openai" | "deepseek";

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitRecord>();

function jsonError(error: string, status = 400, fieldErrors?: Record<string, string>) {
  return NextResponse.json({ error, fieldErrors }, { status });
}

function getAiProvider(): AiProvider {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "deepseek" ? "deepseek" : "openai";
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

function validateInput(body: unknown) {
  const fieldErrors: Partial<Record<string, string>> = {};

  if (!isPlainObject(body)) {
    return {
      value: null,
      fieldErrors: { productName: "请求体格式不正确。" },
    };
  }

  const value: Record<string, string> = {};
  const allFields = Object.keys(inputLimits) as string[];
  for (const field of allFields) {
    value[field] = getTrimmedString(body, field);
  }
  value.accessPassword = getTrimmedString(body, "accessPassword");

  for (const field of basicRequiredFields) {
    if (!value[field]) {
      fieldErrors[field] = "该项不能为空。";
    }
  }

  for (const [field, limit] of Object.entries(inputLimits) as Array<[keyof typeof inputLimits, number]>) {
    if ((value[field] || "").length > limit) {
      fieldErrors[field] = `最多输入 ${limit} 个字符。`;
    }
  }

  if (!categories.includes(value.category as (typeof categories)[number])) {
    fieldErrors.category = "商品类目不在允许范围内。";
  }

  return { value, fieldErrors };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isConfidenceLevel(value: unknown) {
  return value === "low" || value === "medium" || value === "high";
}

function isRecommendation(value: unknown): value is AlibabaResult["recommendation"] {
  return isPlainObject(value)
    && isString(value.suggestion)
    && isString(value.dataWarning);
}

function isScoreDimension(value: unknown): value is ScoreDimension {
  return isPlainObject(value)
    && typeof value.score === "number"
    && Number.isFinite(value.score)
    && isString(value.basis)
    && isString(value.mainRisk)
    && isString(value.missingData);
}

function isScoreBreakdown(value: unknown): value is ScoreBreakdown {
  if (!isPlainObject(value)) {
    return false;
  }

  const fields: Array<keyof ScoreBreakdown> = [
    "marketDemand",
    "competitionRisk",
    "profitMargin",
    "logisticsDifficulty",
    "complianceRisk",
    "b2bFit",
    "differentiation",
    "beginnerDifficulty",
  ];

  return fields.every((field) => isScoreDimension(value[field]));
}

function isBaseAssessment(value: unknown): value is BaseAssessment {
  return isPlainObject(value)
    && isString(value.conclusion)
    && isString(value.basis)
    && isString(value.risk)
    && isConfidenceLevel(value.confidence)
    && isString(value.verificationStep);
}

function isInquiryTemplates(value: unknown): value is InquiryTemplates {
  if (!isPlainObject(value)) {
    return false;
  }

  const fields: Array<keyof InquiryTemplates> = [
    "firstInquiry",
    "moqReply",
    "sampleFeeReply",
    "oemOdmReply",
    "priceTooHighReply",
    "leadTimeReply",
    "shippingReply",
    "followUpReply",
  ];

  return fields.every((field) => isString(value[field]));
}

function validateAlibabaResult(value: unknown): value is AlibabaResult {
  if (!isPlainObject(value)) {
    return false;
  }

  const assessmentFields = [
    "demandAnalysis",
    "competitionRiskAssessment",
    "profitRiskAssessment",
    "logisticsRiskAssessment",
    "complianceRiskAssessment",
    "b2bFitAssessment",
    "differentiationAssessment",
    "beginnerDifficultyAssessment",
  ] as const;
  const arrayFields = [
    "missingData",
    "validationChecklist",
    "targetMarkets",
    "buyerTypes",
    "coreKeywords",
    "longTailKeywords",
    "imageSuggestions",
    "actionPlan",
  ] as const;
  const stringFields = [
    "alibabaTitle",
    "productDescription",
    "amazonListing",
  ] as const;

  return typeof value.productOpportunityScore === "number"
    && Number.isFinite(value.productOpportunityScore)
    && value.productOpportunityScore >= 0
    && value.productOpportunityScore <= 100
    && isConfidenceLevel(value.confidenceLevel)
    && isRecommendation(value.recommendation)
    && isScoreBreakdown(value.scoreBreakdown)
    && assessmentFields.every((field) => isBaseAssessment(value[field]))
    && arrayFields.every((field) => isStringArray(value[field]))
    && stringFields.every((field) => isString(value[field]))
    && isInquiryTemplates(value.inquiryReplyTemplates);
}

function parseAiJson(outputText: string): unknown {
  const trimmed = outputText.trim();
  if (!trimmed) {
    throw new Error("Empty AI response");
  }

  const fencedJson = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = (fencedJson?.[1] ?? trimmed).trim();
  return JSON.parse(jsonText);
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

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonError("请求内容过长，请精简商品信息后再试。", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("请求体不是合法 JSON。", 400);
  }

  const configuredPassword = getAccessPassword();
  if (!configuredPassword) {
    return jsonError("服务器未配置 ACCESS_PASSWORD，请在 Vercel 环境变量中添加。", 500);
  }

  if (!isPlainObject(body) || getTrimmedString(body, "accessPassword") !== configuredPassword) {
    return jsonError("访问密码错误，请重新输入。", 401, { accessPassword: "访问密码错误，请重新输入。" });
  }

  const { value, fieldErrors } = validateInput(body);
  if (!value || Object.keys(fieldErrors).length > 0) {
    return jsonError("输入信息不完整或格式不正确。", 400, fieldErrors as Record<string, string>);
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return jsonError("请求过于频繁，请 10 分钟后再试。", 429);
  }

  const provider = getAiProvider();
  let outputText = "";
  try {
    if (provider === "deepseek") {
      const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
      if (!deepSeekApiKey) {
        return jsonError("服务器未配置 DEEPSEEK_API_KEY，请在 Vercel 环境变量中添加。", 500);
      }

      const client = new OpenAI({
        apiKey: deepSeekApiKey,
        baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
        timeout: OPENAI_TIMEOUT_MS,
      });

      const response = await client.chat.completions.create({
        model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: "system",
            content: "你只输出严格 JSON。不要输出 Markdown、解释、代码块或额外文本。",
          },
          {
            role: "user",
            content: `${buildAlibabaPrompt(value as ProductFormInput)}\n\n${DEEPSEEK_JSON_FORMAT_INSTRUCTION}`,
          },
        ],
      });

      outputText = response.choices[0]?.message?.content || "";
    } else {
      const openAiApiKey = process.env.OPENAI_API_KEY;
      if (!openAiApiKey) {
        return jsonError("服务器未配置 OPENAI_API_KEY，请在 Vercel 环境变量中添加。", 500);
      }

      const client = new OpenAI({
        apiKey: openAiApiKey,
        timeout: OPENAI_TIMEOUT_MS,
      });

      const response = await client.responses.create({
        model: process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [
          {
            role: "system",
            content: "你只输出严格 JSON。不要输出 Markdown、解释、代码块或额外文本。",
          },
          {
            role: "user",
            content: buildAlibabaPrompt(value as ProductFormInput),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            ...alibabaJsonSchema,
          },
        },
      });

      outputText = response.output_text;
    }
  } catch (error) {
    console.error("Generate API failed", getSafeLogPayload(error));
    return jsonError(GENERATION_ERROR, 500);
  }

  let parsed: unknown;
  try {
    parsed = parseAiJson(outputText);
  } catch {
    return jsonError("AI 返回的内容不是合法 JSON，请重新生成。", 502);
  }

  if (!validateAlibabaResult(parsed)) {
    return jsonError("AI 返回结构不完整，请重新生成。", 502);
  }

  return NextResponse.json(parsed);
}
