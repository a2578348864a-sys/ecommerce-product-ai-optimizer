import "server-only";

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
  DEFAULT_MARKETPLACE,
  MAX_CATEGORY_LENGTH,
  MAX_CONSTRAINTS_LENGTH,
  MIN_CANDIDATES,
  SUPPORTED_MARKETPLACES,
  normalizeOpportunityAnalysisResult,
  sanitizeOpportunityText,
  type OpportunityCandidate,
  type SupportedMarketplace,
} from "@/lib/opportunityAnalysisContract";
import { callAiJson, getSafeAiClientErrorMessage, type AiClientErrorCode } from "@/lib/server/aiClient";

export type OpportunityAnalysisErrorCode =
  | "invalid_category"
  | "invalid_marketplace"
  | "invalid_constraints"
  | "insufficient_candidates"
  | "ai_unavailable";

export type OpportunityAnalysisInput = {
  category: string;
  marketplace: SupportedMarketplace;
  constraints: string;
};

export type OpportunityAnalysisOutcome =
  | {
      ok: true;
      input: OpportunityAnalysisInput;
      candidates: OpportunityCandidate[];
      providerCallStarted: boolean;
    }
  | { ok: false; code: OpportunityAnalysisErrorCode; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 校验并归一化输入；marketplace 缺省为 Amazon US。 */
export function normalizeOpportunityAnalysisInput(
  raw: unknown,
): { ok: true; input: OpportunityAnalysisInput } | { ok: false; code: OpportunityAnalysisErrorCode; message: string } {
  if (!isRecord(raw)) {
    return { ok: false, code: "invalid_category", message: "请求体必须是 JSON object。" };
  }

  const category = sanitizeOpportunityText(asText(raw.category)).slice(0, MAX_CATEGORY_LENGTH);
  if (!category) {
    return { ok: false, code: "invalid_category", message: "请填写商品方向或类目后再分析。" };
  }

  const rawMarketplace = asText(raw.marketplace).trim() || DEFAULT_MARKETPLACE;
  const marketplace = SUPPORTED_MARKETPLACES.find((item) => item === rawMarketplace);
  if (!marketplace) {
    return {
      ok: false,
      code: "invalid_marketplace",
      message: `目标市场暂不支持：${rawMarketplace}。可选：${SUPPORTED_MARKETPLACES.join(" / ")}。`,
    };
  }

  const constraints = sanitizeOpportunityText(asText(raw.constraints)).slice(0, MAX_CONSTRAINTS_LENGTH);

  return { ok: true, input: { category, marketplace, constraints } };
}

const SYSTEM_PROMPT = [
  "你是跨境电商选品研究助手。你没有联网能力，也没有任何后台数据，",
  "不能引用任何销量、排名、价格、评分、评论数、榜单或第三方工具数据。",
  "你的任务只是基于用户的商品方向，提出若干「值得进一步研究的候选方向」假设。",
  "只返回合法 JSON，不要 Markdown，不要解释文字。",
].join("");

export function buildOpportunityAnalysisPrompt(input: OpportunityAnalysisInput): string {
  return [
    "## 硬性约束（违反即视为失败）",
    "1. 禁止出现任何确定性结论或商业承诺。以下词禁止出现：爆款、一定赚钱、高销量、市场巨大。",
    "2. 只允许使用这类表述：值得研究、可能存在机会、需要验证。",
    "3. 禁止编造具体数字（销量、排名、价格、评分、评论数、增长率、市场规模），也无法提供数据来源。",
    "4. 每条候选必须写出「需要进一步验证的问题」，用于后续人工或工具验证。",
    "5. 候选必须是可研究的具体商品方向，不要泛泛而谈整个大类。",
    "",
    "## 用户输入",
    `- 商品方向 / 类目：${input.category}`,
    `- 目标市场：${input.marketplace}`,
    `- 限制条件：${input.constraints || "（未提供）"}`,
    "",
    "## 输出格式（严格 JSON，不要多余字段）",
    "{",
    '  "candidates": [',
    "    {",
    '      "title": "候选方向名称，中文，8-24 字，具体到可研究粒度",',
    '      "reason": "为什么值得研究，1-2 句，只表达值得研究/可能存在机会，不得承诺结果",',
    '      "painPoints": ["可能的用户痛点，2-4 条，每条一句话，写成待验证的假设"],',
    '      "validationNeeded": ["需要进一步验证的问题，2-4 条，每条一句话"]',
    "    }",
    "  ]",
    "}",
    "",
    `必须输出 4 到 6 个候选方向；少于 ${MIN_CANDIDATES} 个视为失败。`,
  ].join("\n");
}

/**
 * Opportunity Analysis Spike — V0 最小服务。
 * 只做：输入归一化 → 调用现有 AI Provider → 归一化候选并做数量/禁用词门禁。
 * 不接任何外部数据源，不写任何数据库。
 */
export async function analyzeOpportunities(rawInput: unknown): Promise<OpportunityAnalysisOutcome> {
  const normalized = normalizeOpportunityAnalysisInput(rawInput);
  if (!normalized.ok) return normalized;
  const input = normalized.input;

  const aiResult = await callAiJson<unknown>({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildOpportunityAnalysisPrompt(input) },
    ] satisfies ChatCompletionMessageParam[],
    temperature: 0.4,
    maxTokens: 2000,
  });

  if (!aiResult.ok) {
    return {
      ok: false,
      code: "ai_unavailable",
      message: getSafeAiClientErrorMessage(aiResult.error.code as AiClientErrorCode),
    };
  }

  const candidates = normalizeOpportunityAnalysisResult(aiResult.data);
  if (candidates.length < MIN_CANDIDATES) {
    return {
      ok: false,
      code: "insufficient_candidates",
      message: `AI 只给出了 ${candidates.length} 个候选方向（至少需要 ${MIN_CANDIDATES} 个）。请重试，或把商品方向描述得更具体。`,
    };
  }

  return {
    ok: true,
    input,
    candidates,
    providerCallStarted: aiResult.providerCallStarted === true,
  };
}
