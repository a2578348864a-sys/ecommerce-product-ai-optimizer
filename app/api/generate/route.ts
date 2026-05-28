import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { buildOptimizationPrompt, generatedContentJsonSchema } from "@/lib/prompt";
import {
  categories,
  GeneratedContent,
  GenerateRequest,
  inputLimits,
  languages,
  platforms,
  requiredFields,
  tones,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const MAX_OUTPUT_TOKENS = 6000;
const REQUEST_BODY_LIMIT_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const OPENAI_TIMEOUT_MS = 60 * 1000;
const GENERATION_ERROR = "生成失败，请检查 API Key、模型名称、余额或稍后重试。";
const DEEPSEEK_JSON_FORMAT_INSTRUCTION = `
必须返回且只返回一个 JSON object。顶层字段必须完整包含：
{
  "titles": ["正好 10 条商品标题"],
  "coverCopies": ["正好 5 条商品主图文案"],
  "sellingPoints": ["正好 6 条商品核心卖点"],
  "detailPageCopy": "详情页完整文案，必须是非空字符串，不能省略",
  "xiaohongshuPosts": ["正好 3 条小红书种草文案"],
  "videoScripts": ["正好 3 条抖音/短视频脚本"],
  "customerServiceReplies": ["正好 8 条客服常见问题回复"],
  "negativeReviewReplies": ["正好 5 条差评回复模板"],
  "differentiationAdvice": ["至少 5 条竞品差异化建议"],
  "conversionAdvice": ["至少 5 条提高转化率的优化建议"],
  "audienceTags": ["至少 5 条适合投放的人群标签"],
  "marketingHooks": ["至少 5 条适合测试的营销钩子"]
}
不要添加其他顶层字段。不要省略 detailPageCopy。`;

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

function getTrimmedString(body: Record<string, unknown>, field: keyof GenerateRequest) {
  const value = body[field];
  return typeof value === "string" ? value.trim() : "";
}

function validateInput(body: unknown) {
  const fieldErrors: Partial<Record<keyof GenerateRequest, string>> = {};

  if (!isPlainObject(body)) {
    return {
      value: null,
      fieldErrors: { productName: "请求体格式不正确。" },
    };
  }

  const value: GenerateRequest = {
    accessPassword: getTrimmedString(body, "accessPassword"),
    productName: getTrimmedString(body, "productName"),
    category: getTrimmedString(body, "category"),
    platform: getTrimmedString(body, "platform"),
    sellingPointsInput: getTrimmedString(body, "sellingPointsInput"),
    targetAudience: getTrimmedString(body, "targetAudience"),
    priceRange: getTrimmedString(body, "priceRange"),
    competitorInfo: getTrimmedString(body, "competitorInfo"),
    painPoints: getTrimmedString(body, "painPoints"),
    tone: getTrimmedString(body, "tone"),
    language: getTrimmedString(body, "language"),
  };

  for (const field of requiredFields) {
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

  if (!platforms.includes(value.platform as (typeof platforms)[number])) {
    fieldErrors.platform = "目标平台不在允许范围内。";
  }

  if (!tones.includes(value.tone as (typeof tones)[number])) {
    fieldErrors.tone = "风格选择不在允许范围内。";
  }

  if (!languages.includes(value.language as (typeof languages)[number])) {
    fieldErrors.language = "输出语言不在允许范围内。";
  }

  return { value, fieldErrors };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function validateGeneratedContent(value: unknown): value is GeneratedContent {
  if (!isPlainObject(value)) {
    return false;
  }

  const expectedArrayLengths: Partial<Record<keyof GeneratedContent, number>> = {
    titles: 10,
    coverCopies: 5,
    sellingPoints: 6,
    xiaohongshuPosts: 3,
    videoScripts: 3,
    customerServiceReplies: 8,
    negativeReviewReplies: 5,
  };

  const arrayFields: Array<keyof GeneratedContent> = [
    "titles",
    "coverCopies",
    "sellingPoints",
    "xiaohongshuPosts",
    "videoScripts",
    "customerServiceReplies",
    "negativeReviewReplies",
    "differentiationAdvice",
    "conversionAdvice",
    "audienceTags",
    "marketingHooks",
  ];

  if (typeof value.detailPageCopy !== "string" || !value.detailPageCopy.trim()) {
    return false;
  }

  for (const field of arrayFields) {
    const fieldValue = value[field];
    if (!isStringArray(fieldValue)) {
      return false;
    }

    const expectedLength = expectedArrayLengths[field];
    if (expectedLength && fieldValue.length !== expectedLength) {
      return false;
    }

    if (!expectedLength && fieldValue.length < 1) {
      return false;
    }
  }

  return true;
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

  const configuredPassword = process.env.APP_ACCESS_PASSWORD;
  if (!configuredPassword) {
    return jsonError("服务器未配置 APP_ACCESS_PASSWORD，请在 Vercel 环境变量中添加。", 500);
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
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你只输出严格 JSON。不要输出 Markdown、解释、代码块或额外文本。",
          },
          {
            role: "user",
            content: `${buildOptimizationPrompt(value)}\n\n${DEEPSEEK_JSON_FORMAT_INSTRUCTION}`,
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
            content: buildOptimizationPrompt(value),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            ...generatedContentJsonSchema,
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
    parsed = JSON.parse(outputText);
  } catch {
    return jsonError("AI 返回结构不完整，请重新生成。", 502);
  }

  if (!validateGeneratedContent(parsed)) {
    return jsonError("AI 返回结构不完整，请重新生成。", 502);
  }

  return NextResponse.json(parsed);
}
