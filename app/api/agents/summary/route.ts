import { NextRequest, NextResponse } from "next/server";
import { callAiJson } from "@/lib/server/aiClient";
import { buildSummaryPrompt, type SummaryPromptInput } from "@/lib/cross-border/prompts";
import { applyHardGuard, type RiskGuardInput } from "@/lib/server/summaryRiskGuard";
import { sanitizeStringArray, sanitizeUnsupportedCertificationClaims } from "@/lib/server/alphaSafety";

export const runtime = "nodejs";
export const maxDuration = 45;

const OPENAI_TIMEOUT_MS = 45 * 1000;
const MAX_OUTPUT_TOKENS = 1200;
const REQUEST_BODY_LIMIT_BYTES = 32 * 1024;

type SummaryData = {
  verdict: string;
  confidence: string;
  summary: string;
  reasons: string[];
  risks: string[];
  nextSteps: string[];
  beginnerTip: string;
  /** AI JSON 解析失败时是否启用了保守兜底 */
  parseFailed?: boolean;
  /** 兜底原因，避免前端误以为是确定性 AI 结论 */
  reason?: string;
  /** 硬规则是否触发了降级 */
  downgraded?: boolean;
  /** 降级原因（前端展示用） */
  downgradeReasons?: string[];
};

type ApiResponse =
  | { ok: true; data: SummaryData }
  | { ok: false; error: { code: string; message: string } };

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function getAccessPassword() {
  return process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

/** 安全解析 JSON 字符串，失败返回 null */
function tryParseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** 从 API body 中提取 RiskGuardInput 所需的结构化字段 */
function buildRiskGuardInput(
  productName: string,
  source: Record<string, unknown>,
): RiskGuardInput {
  const riskData = tryParseJson(source.riskFindings);
  const sourcingData = tryParseJson(source.sourcingFindings);

  return {
    aiVerdict: "", // 将在 normalizeSummaryData 之后填入
    productName,
    category: asString(source.category) || asString(sourcingData?.category) || "",
    description: asString(source.extraNotes) || asString(source.description) || "",
    riskOverallLevel: asString(riskData?.overallLevel) || undefined,
    riskBlacklistMatches: Array.isArray(riskData?.blacklistMatches)
      ? (riskData?.blacklistMatches as string[]).filter((m) => typeof m === "string")
      : undefined,
    sourcingComplianceBarrier: asString(sourcingData?.complianceBarrier) || undefined,
    sourcingBeginnerFit: asString(sourcingData?.beginnerFit) || undefined,
    sourcingSuggestedEntryLevel: asString(sourcingData?.suggestedEntryLevel) || undefined,
    sourcingLogisticsDifficulty: asString(sourcingData?.logisticsDifficulty) || undefined,
    sourcingAfterSalesRisk: asString(sourcingData?.afterSalesRisk) || undefined,
  };
}

function normalizeSummaryData(raw: unknown, productName: string): Omit<SummaryData, "downgraded" | "downgradeReasons"> {
  const source = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};

  const verdictRaw = asString(source.verdict);
  const validVerdicts = ["新手可小单测试", "可做但需控制成本", "有经验再做", "新手不建议做", "暂不建议做"];
  const verdict = validVerdicts.includes(verdictRaw) ? verdictRaw : "可做但需控制成本";

  const confidenceRaw = asString(source.confidence);
  const validConfidences = ["高", "中", "低"];
  const confidence = validConfidences.includes(confidenceRaw) ? confidenceRaw : "中";

  const summary = asString(source.summary) || `关于「${productName}」的分析已汇总，建议人工复核后决策。`;
  const reasons = asStringArray(source.reasons);
  const risks = asStringArray(source.risks);
  const nextSteps = asStringArray(source.nextSteps);
  const beginnerTip = asString(source.beginnerTip) || "AI 结果仅供运营参考，上架前必须人工复核平台规则和当地法规。";

  return {
    verdict,
    confidence,
    summary: sanitizeUnsupportedCertificationClaims(summary),
    reasons: sanitizeStringArray(reasons.length ? reasons : ["信息不足，建议完成更多分析步骤后再看结论。"]),
    risks: sanitizeStringArray(risks.length ? risks : ["信息不完整，需人工补充分析。"]),
    nextSteps: sanitizeStringArray(nextSteps.length ? nextSteps : ["先完成货源判断和风险排查", "再做选品体检获取利润分析", "最后做爆款拆解了解内容方向"]),
    beginnerTip: sanitizeUnsupportedCertificationClaims(beginnerTip),
  };
}

function buildParseFallbackSummary(productName: string): Omit<SummaryData, "downgraded" | "downgradeReasons"> {
  return {
    verdict: "暂不建议做",
    confidence: "低",
    summary: `「${productName}」的小白结论暂时无法稳定生成，先按保守方案处理。`,
    reasons: ["AI 输出格式异常，本次没有把模型原文当成确定结论。"],
    risks: ["AI 输出格式异常，已使用保守兜底；认证、材质、物流和平台规则仍需人工复核。"],
    nextSteps: ["先查看货源判断和风险排查结果", "补充关键信息后再重新生成小白结论", "上架前人工复核认证、材质和平台规则"],
    beginnerTip: "本次结论置信度低，先不要按乐观结果启动。",
    parseFailed: true,
    reason: "AI 输出格式异常，已使用保守兜底",
  };
}

function applyGuardToSummary(
  normalized: Omit<SummaryData, "downgraded" | "downgradeReasons">,
  guardInputBase: RiskGuardInput,
): SummaryData {
  const guardInput: RiskGuardInput = {
    ...guardInputBase,
    aiVerdict: normalized.verdict,
  };
  const guardResult = applyHardGuard(guardInput);

  return {
    ...normalized,
    verdict: guardResult.safeVerdict,
    downgraded: guardResult.downgraded,
    downgradeReasons: sanitizeStringArray(guardResult.downgradeReasons),
  };
}

async function runSummaryAgent(
  promptInput: SummaryPromptInput,
  guardInputBase: RiskGuardInput,
): Promise<SummaryData> {
  const aiResult = await callAiJson<unknown>({
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: OPENAI_TIMEOUT_MS,
    responseFormat: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "你只输出严格 JSON。不要 Markdown，不要代码块，不要额外文本。",
      },
      {
        role: "user",
        content: buildSummaryPrompt(promptInput),
      },
    ],
  });

  if (!aiResult.ok) {
    if (aiResult.error.code === "json_parse_error") {
      return applyGuardToSummary(buildParseFallbackSummary(promptInput.productName), guardInputBase);
    }
    throw new Error(aiResult.error.code);
  }

  const normalized = normalizeSummaryData(aiResult.data, promptInput.productName);
  return applyGuardToSummary(normalized, guardInputBase);
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonResponse({ ok: false, error: { code: "body_too_large", message: "输入内容过多，请精简后重试。" } }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求格式不正确。" } }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonResponse({ ok: false, error: { code: "invalid_body", message: "请先填写商品信息。" } }, 400);
  }

  const source = body as Record<string, unknown>;

  const productName = asString(source.productName);
  if (!productName) {
    return jsonResponse({ ok: false, error: { code: "missing_product_name", message: "请先填写商品名称。" } }, 400);
  }

  const configuredPassword = getAccessPassword();
  if (!configuredPassword) {
    return jsonResponse({ ok: false, error: { code: "no_password", message: "服务端未配置访问密码。" } }, 500);
  }

  if (asString(source.accessPassword) !== configuredPassword) {
    return jsonResponse({ ok: false, error: { code: "wrong_password", message: "访问密码不正确。" } }, 401);
  }

  const promptInput: SummaryPromptInput = {
    productName,
    sourcingFindings: asString(source.sourcingFindings),
    riskFindings: asString(source.riskFindings),
    productFindings: asString(source.productFindings),
    viralFindings: asString(source.viralFindings),
    extraNotes: asString(source.extraNotes),
  };

  const hasAnyFindings =
    promptInput.sourcingFindings ||
    promptInput.riskFindings ||
    promptInput.productFindings ||
    promptInput.viralFindings;

  if (!hasAnyFindings) {
    return jsonResponse({
      ok: false,
      error: { code: "no_findings", message: "请至少填写一项分析结果。" },
    }, 400);
  }

  // 构建硬规则输入（在调用 AI 前提取结构化字段，供 guard 使用）
  const guardInputBase = buildRiskGuardInput(productName, source);

  try {
    const data = await runSummaryAgent(promptInput, guardInputBase);
    return jsonResponse({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("Summary Agent failed", message.slice(0, 240));
    return jsonResponse({
      ok: false,
      error: { code: "ai_error", message: "小白结论生成失败，请稍后重试。" },
    }, 500);
  }
}
