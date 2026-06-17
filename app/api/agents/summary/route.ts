import { NextRequest, NextResponse } from "next/server";
import { callAiJson, getSafeAiClientErrorMessage } from "@/lib/server/aiClient";
import { buildSummaryPrompt, type SummaryPromptInput } from "@/lib/cross-border/prompts";

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

function normalizeSummaryData(raw: unknown, productName: string): SummaryData {
  const source = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};

  const verdictRaw = asString(source.verdict);
  const validVerdicts = ["可以做", "谨慎做", "不建议做"];
  const verdict = validVerdicts.includes(verdictRaw) ? verdictRaw : "谨慎做";

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
    summary,
    reasons: reasons.length ? reasons : ["信息不足，建议完成更多分析步骤后再看结论。"],
    risks: risks.length ? risks : ["信息不完整，需人工补充分析。"],
    nextSteps: nextSteps.length ? nextSteps : ["先完成货源判断和风险排查", "再做选品体检获取利润分析", "最后做爆款拆解了解内容方向"],
    beginnerTip,
  };
}

async function runSummaryAgent(input: SummaryPromptInput): Promise<SummaryData> {
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
        content: buildSummaryPrompt(input),
      },
    ],
  });

  if (!aiResult.ok) {
    throw new Error(aiResult.error.message);
  }

  return normalizeSummaryData(aiResult.data, input.productName);
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

  try {
    const data = await runSummaryAgent(promptInput);
    return jsonResponse({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("Summary Agent failed", message.slice(0, 240));
    return jsonResponse({
      ok: false,
      error: { code: "ai_error", message: `小白结论生成失败：${message.slice(0, 100)}` },
    }, 500);
  }
}
