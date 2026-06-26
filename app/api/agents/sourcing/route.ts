import { NextRequest, NextResponse } from "next/server";
import { callAiJson, getSafeAiClientErrorMessage } from "@/lib/server/aiClient";
import { buildSourcingPrompt, type SourcingPromptInput } from "@/lib/cross-border/prompts";
import { requireAuthenticated, ensureDemoAiQuota, consumeDemoAiCalls, type DemoAccessSnapshot } from "@/lib/server/demoGuard";

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

type BeginnerFit = "high" | "medium" | "low";
type BarrierLevel = "low" | "medium" | "high";
type EntryLevel = "beginner" | "intermediate" | "experienced";

type SourcingData = {
  feasibility: "high" | "medium" | "low";
  summary: string;
  searchKeywords: string[];
  alternativeDirections: string[];
  priceBand: SourcingPriceBand;
  moqEstimate: string;
  beginnerFriendly: boolean;
  beginnerFit: BeginnerFit;
  complianceBarrier: BarrierLevel;
  logisticsDifficulty: BarrierLevel;
  afterSalesRisk: BarrierLevel;
  suggestedEntryLevel: EntryLevel;
  risks: SourcingRisk[];
  nextSteps: string[];
};

type ApiError = { code: string; message: string };
type ApiResponse = { ok: true; data: SourcingData } | { ok: false; error: ApiError };

function clampBeginnerFit(value: unknown): BeginnerFit {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function clampBarrierLevel(value: unknown): BarrierLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "low";
}

function clampEntryLevel(value: unknown): EntryLevel {
  if (value === "beginner" || value === "intermediate" || value === "experienced") return value;
  return "beginner";
}

const defaultData: SourcingData = {
  feasibility: "medium",
  summary: "当前信息不足以完整判断货源，建议补充品类和价格后重新检查。",
  searchKeywords: [],
  alternativeDirections: [],
  priceBand: { min: "待确认", max: "待确认", unit: "CNY", note: "未提供目标售价，无法估算价格带。" },
  moqEstimate: "未提供足够信息，建议确认品类后咨询供应商。",
  beginnerFriendly: true,
  beginnerFit: "medium",
  complianceBarrier: "low",
  logisticsDifficulty: "low",
  afterSalesRisk: "low",
  suggestedEntryLevel: "beginner",
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
    beginnerFit: clampBeginnerFit(source.beginnerFit),
    complianceBarrier: clampBarrierLevel(source.complianceBarrier),
    logisticsDifficulty: clampBarrierLevel(source.logisticsDifficulty),
    afterSalesRisk: clampBarrierLevel(source.afterSalesRisk),
    suggestedEntryLevel: clampEntryLevel(source.suggestedEntryLevel),
    risks,
    nextSteps: asStringArray(source.nextSteps).slice(0, 6),
  };
}

function buildSourcingFallbackData(input: SourcingPromptInput): SourcingData {
  const text = [input.productName, input.category, input.description].filter(Boolean).join(" ").toLowerCase();

  // 根据输入关键词做轻量增强判断
  const hasElectrical = /usb|供电|水泵|电池|充电|带电|电动|电子|battery|lithium|rechargeable|electric|pump|电机|filter|滤芯/.test(text);
  const fallbackFeasibility = hasElectrical ? "low" : "medium";
  const fallbackCompliance = hasElectrical ? "high" : "medium";
  const fallbackLogistics = hasElectrical ? "medium" : "low";
  const fallbackAftersales = hasElectrical ? "high" : "medium";

  return {
    feasibility: fallbackFeasibility as "medium" | "low",
    summary: "AI 输出格式异常，系统已生成保守兜底结果。该商品需要人工复核供应稳定性、售后风险、合规要求和平台限制，不建议仅凭本结果直接采购。" + (hasElectrical ? " 检测到带电/水泵/滤芯等关键词，建议进一步确认电气安全、配件耗材和认证要求。" : ""),
    searchKeywords: [],
    alternativeDirections: [],
    priceBand: { min: "待确认", max: "待确认", unit: "CNY", note: "AI 未返回价格估算，建议人工询价。" },
    moqEstimate: "未获取到 MOQ 信息，建议手动联系供应商确认。",
    beginnerFriendly: false,
    beginnerFit: hasElectrical ? "low" : "medium",
    complianceBarrier: fallbackCompliance as "medium" | "high",
    logisticsDifficulty: fallbackLogistics as "low" | "medium",
    afterSalesRisk: fallbackAftersales as "medium" | "high",
    suggestedEntryLevel: hasElectrical ? "experienced" : "intermediate",
    risks: hasElectrical
      ? [{ title: "保守兜底", description: "AI 分析失败，且检测到带电/水泵等关键词，已按保守规则处理。", suggestion: "手动确认电气安全、认证、配件耗材和售后风险后再推进。" }]
      : [{ title: "保守兜底", description: "AI 分析失败，已使用保守默认值。", suggestion: "补充商品信息后重新分析，或手动询价和联系供应商。" }],
    nextSteps: [
      "手动在 1688 搜索同类商品了解价格和 MOQ",
      "联系 2-3 家供应商索取报价和样品",
      "确认平台规则和认证要求（特别是带电/食品接触类）",
      "人工复核供应链稳定性和售后方案",
    ],
  };
}

async function runSourcingAgent(input: SourcingPromptInput): Promise<{ data: SourcingData; aiOk: boolean }> {
  const aiResult = await callAiJson<unknown>({
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: OPENAI_TIMEOUT_MS,
    messages: [
      { role: "system", content: "你只输出严格 JSON object。不要输出 Markdown、解释、代码块或额外文本。" },
      { role: "user", content: buildSourcingPrompt(input) },
    ],
  });

  if (!aiResult.ok) {
    console.error("Sourcing Agent failed", aiResult.error.code);
    return { data: buildSourcingFallbackData(input), aiOk: false };
  }
  return { data: normalizeSourcingData(aiResult.data), aiOk: true };
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

  const authResult = requireAuthenticated(request, body as Record<string, unknown>);
  if (!authResult.ok) {
    return NextResponse.json({ ok: false, error: { code: authResult.code, message: authResult.message } }, { status: authResult.status });
  }
  const accessCtx = authResult.context;
  let demoScreen: DemoAccessSnapshot | null = null;

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

  if (accessCtx.mode === "demo") {
    const quota = ensureDemoAiQuota(accessCtx, 1);
    if (!quota.ok) {
      return jsonResponse({ ok: false, error: { code: quota.code, message: quota.message } }, quota.status);
    }
  }

  try {
    const { data, aiOk } = await runSourcingAgent(input);
    if (aiOk && accessCtx.mode === "demo") {
      demoScreen = consumeDemoAiCalls(accessCtx, 1);
    }
    return jsonResponse({ ok: true, data, ...(demoScreen ? { demoAccess: demoScreen } : {}) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    return toStructuredError(code);
  }
}
