import { NextRequest, NextResponse } from "next/server";
import { callAiJson, getSafeAiClientErrorMessage } from "@/lib/server/aiClient";
import { buildRiskCheckPrompt, type RiskCheckPromptInput } from "@/lib/cross-border/prompts";
import { classifyKeywordFallbackRisk, isPetFoodContactProduct, sanitizeStringArray, sanitizeUnsupportedCertificationClaims } from "@/lib/server/alphaSafety";

export const runtime = "nodejs";
export const maxDuration = 45;

const OPENAI_TIMEOUT_MS = 45 * 1000;
const MAX_OUTPUT_TOKENS = 2000;
const REQUEST_BODY_LIMIT_BYTES = 32 * 1024;

type RiskLevel = "green" | "yellow" | "red";

type RiskCheckItem = {
  category: string;
  level: RiskLevel;
  title: string;
  description: string;
  suggestion: string;
};

type RiskCheckData = {
  overallLevel: RiskLevel;
  summary: string;
  risks: RiskCheckItem[];
  blacklistMatches: string[];
  beginnerFriendly: boolean;
  errorFallback?: boolean;
  message?: string;
};

type ApiError = {
  code: string;
  message: string;
};

type ApiResponse =
  | { ok: true; data: RiskCheckData }
  | { ok: false; error: ApiError };

const defaultData: RiskCheckData = {
  overallLevel: "yellow",
  summary: "当前信息不足以完整判断风险，建议补充品类和卖点声明后重新检查。",
  risks: [
    { category: "侵权风险", level: "yellow", title: "待人工确认", description: "未提供足够信息判断是否涉及品牌、IP 或专利侵权。", suggestion: "搜索目标平台同品类商品，确认外观、商标和功能是否有明显相似竞品。" },
    { category: "功效宣称风险", level: "yellow", title: "待人工确认", description: "未提供具体的功效声明文案。", suggestion: "如果商品涉及美白、减肥、疗效等声明，必须提前检查平台禁限词和当地广告法规。" },
    { category: "品类风险", level: "yellow", title: "待人工确认", description: "未提供明确的商品品类。", suggestion: "确认品类后，对照平台禁售/限售类目逐一排除。" },
    { category: "平台规则风险", level: "yellow", title: "待人工确认", description: "未确认目标平台对该品类的资质要求。", suggestion: "去目标平台卖家后台查询该品类的上架要求和认证资质。" },
    { category: "物流风险", level: "yellow", title: "待人工确认", description: "未确认是否带电、带磁、液体、大件或易碎。", suggestion: "确认产品物理属性后，咨询物流商头程和尾程的可运性和附加费。" },
    { category: "售后风险", level: "yellow", title: "待人工确认", description: "未提供商品的使用复杂度、退货率预期和客单价。", suggestion: "评估商品是否需要安装、是否有尺码/适配问题、客单价是否容易引发退换纠纷。" },
  ],
  blacklistMatches: [],
  beginnerFriendly: true,
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

function clampRiskLevel(value: unknown): RiskLevel {
  if (value === "green" || value === "yellow" || value === "red") return value;
  return "yellow";
}

function clampOverallLevel(risks: RiskCheckItem[]): RiskLevel {
  const hasRed = risks.some((r) => r.level === "red");
  if (hasRed) return "red";
  const hasYellow = risks.some((r) => r.level === "yellow");
  if (hasYellow) return "yellow";
  return "green";
}

function moreSevereRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  if (a === "red" || b === "red") return "red";
  if (a === "yellow" || b === "yellow") return "yellow";
  return "green";
}

function normalizeRiskCheckData(value: unknown): RiskCheckData {
  const source = isPlainObject(value) ? value : {};
  const fallback = defaultData;

  const risks: RiskCheckItem[] = Array.isArray(source.risks)
      ? source.risks.filter(isPlainObject).slice(0, 10).map((r) => ({
        category: sanitizeUnsupportedCertificationClaims(asString(r.category, "未分类")),
        level: clampRiskLevel(r.level),
        title: sanitizeUnsupportedCertificationClaims(asString(r.title, "待确认")).slice(0, 80),
        description: sanitizeUnsupportedCertificationClaims(asString(r.description, "未提供详细说明")),
        suggestion: sanitizeUnsupportedCertificationClaims(asString(r.suggestion, "请人工复核")),
      }))
    : fallback.risks;

  return {
    overallLevel: clampRiskLevel(source.overallLevel) === "yellow" && risks.length
      ? clampOverallLevel(risks)
      : clampRiskLevel(source.overallLevel),
    summary: sanitizeUnsupportedCertificationClaims(asString(source.summary, fallback.summary) || fallback.summary),
    risks: risks.length >= 3 ? risks : fallback.risks,
    blacklistMatches: sanitizeStringArray(asStringArray(source.blacklistMatches)).slice(0, 15),
    beginnerFriendly: typeof source.beginnerFriendly === "boolean" ? source.beginnerFriendly : true,
  };
}

function buildPetFoodContactRisk(): RiskCheckItem {
  return {
    category: "材质与入口接触风险",
    level: "yellow",
    title: "材质需复核",
    description: "该商品涉及宠物进食或长期舔咬接触，不能按普通非入口宠物配件处理。材质安全、气味、清洁死角和霉菌问题都可能引发退货或差评。",
    suggestion: "向供应商索取材质和食品接触相关检测文件，拿样测试气味、清洁难度和耐咬性；未验证前不要写认证承诺。",
  };
}

function applyDeterministicRiskGuards(data: RiskCheckData, input: RiskCheckPromptInput): RiskCheckData {
  if (!isPetFoodContactProduct(input)) return data;

  const petRisk = buildPetFoodContactRisk();
  const risks = [
    ...data.risks.filter((item) => item.category !== petRisk.category),
    petRisk,
  ];

  return {
    ...data,
    overallLevel: moreSevereRiskLevel(data.overallLevel, "yellow"),
    summary: data.summary.includes("食品接触") || data.summary.includes("材质")
      ? data.summary
      : `${data.summary} 该商品涉及宠物进食接触，需重点复核材质、清洁、售后和合规文件。`,
    risks,
    beginnerFriendly: false,
  };
}

function buildRiskFallbackData(input: RiskCheckPromptInput, code: string): RiskCheckData {
  const fallbackLevel = classifyKeywordFallbackRisk(input);
  const riskItems: RiskCheckItem[] = [
    {
      category: "AI 风险分析状态",
      level: "yellow",
      title: "AI 分析失败",
      description: "AI 风险分析本次未稳定返回结果，不能按低风险处理。",
      suggestion: "先按保守风险处理，补充商品信息后再重新分析；不要因为本次失败就直接上架。",
    },
  ];

  if (fallbackLevel === "red") {
    riskItems.push({
      category: "高风险关键词",
      level: "red",
      title: "保守拦截",
      description: "商品信息命中儿童、电池、磁铁、医疗美妆等明显高风险关键词，AI 失败时必须按高风险处理。",
      suggestion: "先确认平台规则、物流限制、认证文件和售后责任，再决定是否继续。",
    });
  }

  if (isPetFoodContactProduct(input)) {
    riskItems.push(buildPetFoodContactRisk());
  }

  return {
    overallLevel: riskItems.some((item) => item.level === "red") ? "red" : "yellow",
    summary: "AI 风险分析失败，已按高风险关键词和品类规则保守处理。",
    risks: riskItems,
    blacklistMatches: fallbackLevel === "red" ? ["高风险关键词"] : [],
    beginnerFriendly: false,
    errorFallback: true,
    message: `AI 风险分析失败，已按保守规则处理（${code}）。`,
  };
}

function buildPrompt(input: RiskCheckPromptInput) {
  return buildRiskCheckPrompt(input);
}

async function runRiskAgent(input: RiskCheckPromptInput): Promise<RiskCheckData> {
  const aiResult = await callAiJson<unknown>({
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: OPENAI_TIMEOUT_MS,
    messages: [
      {
        role: "system",
        content: "你只输出严格 JSON object。不要输出 Markdown、解释、代码块或额外文本。",
      },
      {
        role: "user",
        content: buildPrompt(input),
      },
    ],
  });

  if (!aiResult.ok) {
    console.error("Risk Agent failed", aiResult.error.code);
    return buildRiskFallbackData(input, aiResult.error.code);
  }

  return applyDeterministicRiskGuards(normalizeRiskCheckData(aiResult.data), input);
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
  return jsonResponse({
    ok: false,
    error: { code, message: getErrorMessage(code) },
  }, status);
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonResponse({
      ok: false,
      error: { code: "body_too_large", message: "请求体过大，请减少素材后重试。" },
    }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_json", message: "请求格式不正确，请刷新页面后重试。" },
    }, 400);
  }

  if (!isPlainObject(body)) {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_body", message: "请求体必须是 JSON object。" },
    }, 400);
  }

  const configuredPassword = getAccessPassword();
  if (!configuredPassword) {
    return jsonResponse({
      ok: false,
      error: { code: "missing_access_password", message: "服务端访问密码未配置。" },
    }, 500);
  }

  if (asString(body.accessPassword) !== configuredPassword) {
    return jsonResponse({
      ok: false,
      error: { code: "unauthorized", message: "访问密码错误或缺失。" },
    }, 401);
  }

  const productName = asString(body.productName).slice(0, 200);
  if (!productName) {
    return jsonResponse({
      ok: false,
      error: { code: "missing_product_name", message: "请先填写商品名称。" },
    }, 400);
  }

  const input: RiskCheckPromptInput = {
    productName,
    category: asString(body.category).slice(0, 100),
    claims: asString(body.claims).slice(0, 500),
    targetPlatform: asString(body.targetPlatform).slice(0, 50),
    description: asString(body.description).slice(0, 1000),
  };

  try {
    const data = await runRiskAgent(input);
    return jsonResponse({ ok: true, data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    return toStructuredError(code);
  }
}
