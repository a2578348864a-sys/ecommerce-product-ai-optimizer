import { NextRequest, NextResponse } from "next/server";
import { callAiJson, getSafeAiClientErrorMessage } from "@/lib/server/aiClient";
import { buildSourcingPrompt, type SourcingPromptInput } from "@/lib/cross-border/prompts";

export const runtime = "nodejs";
export const maxDuration = 45;

const OPENAI_TIMEOUT_MS = 45 * 1000;
const MAX_OUTPUT_TOKENS = 2000;
const REQUEST_BODY_LIMIT_BYTES = 32 * 1024;

type SourcingPriceBand = {
  min: string;
  max: string;
  unit: string;
  note: string;
};

type SourcingRisk = {
  title: string;
  description: string;
  suggestion: string;
};

type SourcingData = {
  feasibility: "high" | "medium" | "low";
  summary: string;
  searchKeywords: string[];
  alternativeDirections: string[];
  priceBand: SourcingPriceBand;
  moqEstimate: string;
  beginnerFriendly: boolean;
  risks: SourcingRisk[];
  nextSteps: string[];
};

type ApiError = { code: string; message: string };
type ApiResponse = { ok: true; data: SourcingData } | { ok: false; error: ApiError };

const defaultData: SourcingData = {
  feasibility: "medium",
  summary: "当前信息不足以完整判断货源，建议补充品类和价格后重新检查。",
  searchKeywords: [],
  alternativeDirections: [],
  priceBand: { min: "待确认", max: "待确认", unit: "CNY", note: "未提供目标售价，无法估算价格带。" },
  moqEstimate: "未提供足够信息，建议确认品类后咨询供应商。",
  beginnerFriendly: true,
  risks: [],
  nextSteps: ["补充商品品类和目标售价", "在 1688 搜索同类商品了解价格区间", "联系 2-3 家供应商拿样品对比"],
};

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function getAccessPassword() {
  return process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function normalizeSourcingData(value: unknown): SourcingData {
  const source = isPlainObject(value) ? value : {};
  const fallback = defaultData;
  const feasibility = (source.feasibility === "high" || source.feasibility === "medium" || source.feasibility === "low")
    ? source.feasibility : "medium";

  const priceBand: SourcingPriceBand = isPlainObject(source.priceBand)
    ? {
        min: asString(source.priceBand.min, fallback.priceBand.min),
        max: asString(source.priceBand.max, fallback.priceBand.max),
        unit: "CNY",
        note: asString(source.priceBand.note, fallback.priceBand.note),
      }
    : fallback.priceBand;

  const risks: SourcingRisk[] = Array.isArray(source.risks)
    ? source.risks.filter(isPlainObject).slice(0, 5).map((r) => ({
        title: asString(r.title, "待确认").slice(0, 40),
        description: asString(r.description, "未提供详细说明"),
        suggestion: asString(r.suggestion, "请人工核实"),
      }))
    : fallback.risks;

  return {
    feasibility,
    summary: asString(source.summary, fallback.summary) || fallback.summary,
    searchKeywords: asStringArray(source.searchKeywords).slice(0, 8),
    alternativeDirections: asStringArray(source.alternativeDirections).slice(0, 5),
    priceBand,
    moqEstimate: asString(source.moqEstimate, fallback.moqEstimate) || fallback.moqEstimate,
    beginnerFriendly: typeof source.beginnerFriendly === "boolean" ? source.beginnerFriendly : true,
    risks,
    nextSteps: asStringArray(source.nextSteps).slice(0, 6),
  };
}

async function runSourcingAgent(input: SourcingPromptInput): Promise<SourcingData> {
  const aiResult = await callAiJson<unknown>({
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: OPENAI_TIMEOUT_MS,
    messages: [
      { role: "system", content: "你只输出严格 JSON object。不要输出 Markdown、解释、代码块或额外文本。" },
      { role: "user", content: buildSourcingPrompt(input) },
    ],
  });

  if (!aiResult.ok) throw new Error(aiResult.error.message);
  return normalizeSourcingData(aiResult.data);
}

function getErrorMessage(code: string) {
  if (code === "missing_api_key" || code === "missing_model" || code === "missing_base_url") {
    return "AI 服务未配置，请先检查服务端环境变量。";
  }
  if (code === "timeout") return "AI 请求超时，请稍后重试。";
  if (code === "json_parse_error") return "AI 返回格式异常，请稍后重试。";
  return getSafeAiClientErrorMessage(code as Parameters<typeof getSafeAiClientErrorMessage>[0]);
}

function toStructuredError(code: string, status = 500) {
  return jsonResponse({ ok: false, error: { code, message: getErrorMessage(code) } }, status);
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonResponse({ ok: false, error: { code: "body_too_large", message: "请求体过大。" } }, 413);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求格式不正确。" } }, 400);
  }

  if (!isPlainObject(body)) {
    return jsonResponse({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, 400);
  }

  const configuredPassword = getAccessPassword();
  if (!configuredPassword) {
    return jsonResponse({ ok: false, error: { code: "missing_access_password", message: "服务端访问密码未配置。" } }, 500);
  }

  if (asString(body.accessPassword) !== configuredPassword) {
    return jsonResponse({ ok: false, error: { code: "unauthorized", message: "访问密码错误或缺失。" } }, 401);
  }

  const productName = asString(body.productName).slice(0, 200);
  if (!productName) {
    return jsonResponse({ ok: false, error: { code: "missing_product_name", message: "请先填写商品名称。" } }, 400);
  }

  const input: SourcingPromptInput = {
    productName,
    category: asString(body.category).slice(0, 100),
    targetPrice: asString(body.targetPrice).slice(0, 50),
    targetPlatform: asString(body.targetPlatform).slice(0, 50),
    description: asString(body.description).slice(0, 1000),
  };

  try {
    const data = await runSourcingAgent(input);
    return jsonResponse({ ok: true, data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    return toStructuredError(code);
  }
}
