import "server-only";

import { callAiJson } from "@/lib/server/aiClient";
import {
  buildSourcingPrompt,
  buildRiskCheckPrompt,
  buildSummaryPrompt,
  type SourcingPromptInput,
  type RiskCheckPromptInput,
  type SummaryPromptInput,
} from "@/lib/cross-border/prompts";
import { applyHardGuard, type RiskGuardInput } from "@/lib/server/summaryRiskGuard";
import {
  sanitizeStringArray,
  sanitizeUnsupportedCertificationClaims,
  classifyKeywordFallbackRisk,
  isPetFoodContactProduct,
} from "@/lib/server/alphaSafety";

// ── Types ──

export type OpportunityInput = {
  /** Raw lines from the batch textarea */
  rawLines: string[];
};

export type ProductCandidate = {
  index: number;
  rawInput: string;
  name: string;
  link: string | null;
  status: "pending" | "running" | "completed" | "failed";
  errorMessage?: string;
  /** Product understanding */
  category?: string;
  description?: string;
  /** Sourcing result */
  sourcing?: SourcingSummary;
  /** Risk result */
  risk?: RiskSummary;
  /** Summary result */
  summary?: SummaryVerdict;
  /** Computed score */
  score: number;
  level: RecommendationLevel;
  levelLabel: string;
  reasons: string[];
  risks: string[];
  nextAction: string;
};

export type SourcingSummary = {
  feasibility: string;
  summary: string;
  searchKeywords: string[];
  moqEstimate: string;
  beginnerFriendly: boolean;
  beginnerFit: string;
  complianceBarrier: string;
  logisticsDifficulty: string;
  afterSalesRisk: string;
  suggestedEntryLevel: string;
};

export type RiskSummary = {
  overallLevel: string;
  summary: string;
  blacklistMatches: string[];
  beginnerFriendly: boolean;
};

export type SummaryVerdict = {
  verdict: string;
  confidence: string;
  summary: string;
  reasons: string[];
  risks: string[];
  nextSteps: string[];
  beginnerTip: string;
  downgraded?: boolean;
  downgradeReasons?: string[];
  parseFailed?: boolean;
};

export type RecommendationLevel = "A" | "B" | "C" | "D" | "E";

const LEVEL_LABELS: Record<RecommendationLevel, string> = {
  A: "优先小单测试",
  B: "可以观察",
  C: "有经验再做",
  D: "新手不建议",
  E: "暂不建议",
};

export type OpportunitiesResult = {
  candidates: ProductCandidate[];
  totalCount: number;
  completedCount: number;
  failedCount: number;
};

// ── Constants ──

const MAX_CANDIDATES = 30;
const AI_TIMEOUT_MS = 45 * 1000;
const MAX_OUTPUT_TOKENS = 2000;

// ── Helpers ──

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function parseCandidateLines(rawText: string): string[] {
  return rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_CANDIDATES);
}

function detectLink(line: string): string | null {
  const trimmed = line.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function extractName(line: string): string {
  const link = detectLink(line);
  if (link) {
    // Try to extract a product name from URL path
    try {
      const url = new URL(link);
      const pathParts = url.pathname.split("/").filter(Boolean);
      const last = pathParts[pathParts.length - 1] || "";
      return last.replace(/[-_]/g, " ").slice(0, 100) || "未命名商品";
    } catch {
      return "未命名商品";
    }
  }
  return line.slice(0, 200);
}

// ── Agent callers ──

async function runSourcing(productName: string, description: string): Promise<SourcingSummary> {
  const input: SourcingPromptInput = {
    productName,
    category: "",
    targetPrice: "",
    targetPlatform: "",
    description: description.slice(0, 1000),
  };

  try {
    const result = await callAiJson<unknown>({
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: AI_TIMEOUT_MS,
      messages: [
        { role: "system", content: "你只输出严格 JSON object。不要输出 Markdown、解释、代码块或额外文本。" },
        { role: "user", content: buildSourcingPrompt(input) },
      ],
    });

    if (!result.ok) throw new Error(result.error.message);
    const data = isPlainObject(result.data) ? result.data : {};
    const risks = Array.isArray(data.risks)
      ? data.risks.filter(isPlainObject).slice(0, 5).map((r: Record<string, unknown>) => ({
          title: asString(r.title, "待确认").slice(0, 40),
          description: asString(r.description, "未提供详细说明"),
          suggestion: asString(r.suggestion, "请人工核实"),
        }))
      : [];

    return {
      feasibility: asString(data.feasibility, "medium"),
      summary: asString(data.summary, "暂未获取到货源判断结果。"),
      searchKeywords: asStringArray(data.searchKeywords).slice(0, 8),
      moqEstimate: asString(data.moqEstimate, "待确认"),
      beginnerFriendly: data.beginnerFriendly !== false,
      beginnerFit: asString(data.beginnerFit, "medium"),
      complianceBarrier: asString(data.complianceBarrier, "low"),
      logisticsDifficulty: asString(data.logisticsDifficulty, "low"),
      afterSalesRisk: asString(data.afterSalesRisk, "low"),
      suggestedEntryLevel: asString(data.suggestedEntryLevel, "beginner"),
    };
  } catch {
    return {
      feasibility: "medium",
      summary: "AI 分析超时或失败，请稍后重试。",
      searchKeywords: [],
      moqEstimate: "未获取",
      beginnerFriendly: true,
      beginnerFit: "medium",
      complianceBarrier: "low",
      logisticsDifficulty: "low",
      afterSalesRisk: "low",
      suggestedEntryLevel: "beginner",
    };
  }
}

async function runRisk(productName: string, description: string): Promise<RiskSummary> {
  const input: RiskCheckPromptInput = {
    productName,
    category: "",
    claims: "",
    description: description.slice(0, 1000),
    targetPlatform: "",
  };

  try {
    const result = await callAiJson<unknown>({
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: AI_TIMEOUT_MS,
      messages: [
        { role: "system", content: "你只输出严格 JSON object。不要输出 Markdown、解释、代码块或额外文本。" },
        { role: "user", content: buildRiskCheckPrompt(input) },
      ],
    });

    if (!result.ok) {
      // Fallback: keyword-based risk classification
      const riskInput = { productName, description };
      const fallbackLevel = classifyKeywordFallbackRisk(riskInput);
      const petContact = isPetFoodContactProduct(riskInput);
      const overallLevel = petContact ? "yellow" : fallbackLevel;
      return {
        overallLevel,
        summary: `AI 风险分析暂时不可用，以下为基于关键词的保守判断。`,
        blacklistMatches: [],
        beginnerFriendly: overallLevel !== "red",
      };
    }

    const data = isPlainObject(result.data) ? result.data : {};
    const risks = Array.isArray(data.risks)
      ? data.risks.filter(isPlainObject).slice(0, 8).map((r: Record<string, unknown>) => ({
          category: asString(r.category),
          level: asString(r.level, "yellow"),
          title: asString(r.title),
          description: asString(r.description),
          suggestion: asString(r.suggestion),
        }))
      : [];

    const overallLevel = (data.overallLevel === "green" || data.overallLevel === "yellow" || data.overallLevel === "red")
      ? data.overallLevel
      : classifyKeywordFallbackRisk({ productName, description });

    // Pet food contact downgrade
    const effectiveLevel = isPetFoodContactProduct({ productName, description }) && overallLevel === "green"
      ? "yellow"
      : overallLevel;

    return {
      overallLevel: effectiveLevel,
      summary: sanitizeUnsupportedCertificationClaims(asString(data.summary, "风险分析未返回有效结论。")),
      blacklistMatches: asStringArray(data.blacklistMatches),
      beginnerFriendly: effectiveLevel !== "red" && data.beginnerFriendly !== false,
    };
  } catch {
    const riskInput = { productName, description };
    const fallbackLevel = classifyKeywordFallbackRisk(riskInput);
    return {
      overallLevel: fallbackLevel,
      summary: "AI 风险分析请求失败，以下为基于关键词的保守判断。",
      blacklistMatches: [],
      beginnerFriendly: fallbackLevel !== "red",
    };
  }
}

async function runSummary(
  productName: string,
  description: string,
  sourcing: SourcingSummary | undefined,
  risk: RiskSummary | undefined,
): Promise<SummaryVerdict> {
  const sourcingFindings = sourcing
    ? `货源可行性：${sourcing.feasibility}。${sourcing.summary} MOQ：${sourcing.moqEstimate}。合规门槛：${sourcing.complianceBarrier}。建议入门级别：${sourcing.suggestedEntryLevel}。`
    : "未进行货源分析。";
  const riskFindings = risk
    ? `整体风险等级：${risk.overallLevel}。${risk.summary}${risk.blacklistMatches.length ? " 命中高风险标签：" + risk.blacklistMatches.join("、") : ""}`
    : "未进行风险分析。";

  const input: SummaryPromptInput = {
    productName,
    sourcingFindings,
    riskFindings,
    productFindings: description.slice(0, 1000),
    viralFindings: "",
    extraNotes: "",
  };

  try {
    const result = await callAiJson<unknown>({
      maxTokens: 1200,
      timeoutMs: AI_TIMEOUT_MS,
      messages: [
        { role: "system", content: "你只输出严格 JSON object。不要输出 Markdown、解释、代码块或额外文本。" },
        { role: "user", content: buildSummaryPrompt(input) },
      ],
    });

    if (!result.ok) throw new Error(result.error.message);
    const data = isPlainObject(result.data) ? result.data : {};

    const aiVerdict = asString(data.verdict, "可做但需控制成本");

    // Apply hard guard
    const guardInput: RiskGuardInput = {
      aiVerdict,
      productName,
      description: description.slice(0, 1000),
      riskOverallLevel: risk?.overallLevel,
      riskBlacklistMatches: risk?.blacklistMatches,
      sourcingComplianceBarrier: sourcing?.complianceBarrier,
      sourcingBeginnerFit: sourcing?.beginnerFit,
      sourcingSuggestedEntryLevel: sourcing?.suggestedEntryLevel,
      sourcingLogisticsDifficulty: sourcing?.logisticsDifficulty,
      sourcingAfterSalesRisk: sourcing?.afterSalesRisk,
    };

    const guarded = applyHardGuard(guardInput);

    return {
      verdict: guarded.safeVerdict,
      confidence: asString(data.confidence, "medium"),
      summary: sanitizeUnsupportedCertificationClaims(asString(data.summary, "未获取到综合结论。")),
      reasons: sanitizeStringArray(asStringArray(data.reasons).length
        ? asStringArray(data.reasons)
        : [guarded.safeVerdict]),
      risks: sanitizeStringArray(asStringArray(data.risks)),
      nextSteps: sanitizeStringArray(asStringArray(data.nextSteps)),
      beginnerTip: asString(data.beginnerTip, "建议先完成货源判断和风险排查后再做最终决策。"),
      downgraded: guarded.downgraded,
      downgradeReasons: guarded.downgradeReasons,
      parseFailed: data.parseFailed === true,
    };
  } catch {
    return {
      verdict: "可做但需控制成本",
      confidence: "low",
      summary: "AI 综合总结暂时不可用，请基于货源和风险结果人工判断。",
      reasons: ["AI 总结生成失败"],
      risks: risk?.overallLevel === "red" ? ["高风险品类，建议人工复核"] : [],
      nextSteps: ["人工复核货源和风险结果", "补充商品信息后重试"],
      beginnerTip: "当前信息不足以给出确定结论，建议先完善商品描述。",
      parseFailed: true,
    };
  }
}

// ── Scoring ──

function calculateScore(candidate: ProductCandidate): number {
  let score = 50;

  // Sourcing-based adjustments
  if (candidate.sourcing) {
    if (candidate.sourcing.feasibility === "high") score += 10;
    else if (candidate.sourcing.feasibility === "low") score -= 10;
    if (candidate.sourcing.beginnerFriendly) score += 10;
    if (candidate.sourcing.complianceBarrier === "high") score -= 10;
    if (candidate.sourcing.logisticsDifficulty === "high") score -= 10;
    if (candidate.sourcing.afterSalesRisk === "high") score -= 10;
    if (candidate.sourcing.suggestedEntryLevel === "experienced") score -= 15;
    else if (candidate.sourcing.suggestedEntryLevel === "beginner") score += 5;
  }

  // Risk-based adjustments
  if (candidate.risk) {
    if (candidate.risk.overallLevel === "green") score += 15;
    else if (candidate.risk.overallLevel === "red") score -= 20;
    else if (candidate.risk.overallLevel === "yellow") score -= 5;
    if ((candidate.risk.blacklistMatches || []).length > 0) score -= 15;
    if (!candidate.risk.beginnerFriendly) score -= 10;
  }

  // Summary-based adjustments
  if (candidate.summary?.downgraded) score -= 10;
  if (candidate.summary?.parseFailed) score -= 5;

  // Clamp to 0-100
  return Math.min(100, Math.max(0, Math.round(score)));
}

function getLevel(score: number): RecommendationLevel {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "E";
}

function buildReasons(candidate: ProductCandidate): string[] {
  const reasons: string[] = [];
  if (candidate.sourcing) {
    if (candidate.sourcing.feasibility === "high") reasons.push("货源易找");
    else if (candidate.sourcing.feasibility === "low") reasons.push("货源较难");
    if (candidate.sourcing.beginnerFriendly) reasons.push("新手友好");
    if (candidate.sourcing.complianceBarrier === "high") reasons.push("合规门槛高");
  }
  if (candidate.risk) {
    if (candidate.risk.overallLevel === "green") reasons.push("风险低");
    else if (candidate.risk.overallLevel === "red") reasons.push("高风险品类");
    else if (candidate.risk.overallLevel === "yellow") reasons.push("需注意风险");
  }
  if (candidate.summary?.downgraded) reasons.push("系统自动降级");
  reasons.push(...(candidate.summary?.reasons?.slice(0, 2) || []));
  return reasons.slice(0, 4);
}

function buildRiskItems(candidate: ProductCandidate): string[] {
  const items: string[] = [];
  if (candidate.risk) {
    if (candidate.risk.blacklistMatches?.length) items.push(...candidate.risk.blacklistMatches);
    items.push(candidate.risk.summary);
  }
  if (candidate.summary?.risks?.length) items.push(...candidate.summary.risks.slice(0, 3));
  return items.slice(0, 5);
}

function buildNextAction(candidate: ProductCandidate): string {
  if (candidate.status === "failed") return "分析失败，请检查商品信息后重试";
  if (candidate.level === "E") return "暂不建议做，建议先观察同类目成功案例";
  if (candidate.level === "D") return "建议有经验的运营继续研究，新手暂缓";
  if (candidate.level === "C") return "建议补充认证信息和利润测算后再评估";
  if (candidate.level === "B") return "可以观察，建议完成利润测算后再决定是否小单测试";
  return "建议安排小单测试，验证利润和转化率";
}

// ── Main orchestrator ──

export async function runOpportunitiesPipeline(
  rawText: string,
): Promise<OpportunitiesResult> {
  const lines = parseCandidateLines(rawText);
  if (lines.length === 0) {
    throw new Error("请至少输入 1 个候选商品。");
  }
  if (lines.length > MAX_CANDIDATES) {
    throw new Error(`每次最多分析 ${MAX_CANDIDATES} 个候选品，当前输入 ${lines.length} 个。`);
  }

  const candidates: ProductCandidate[] = lines.map((line, i) => {
    const link = detectLink(line);
    return {
      index: i,
      rawInput: line,
      name: extractName(line),
      link,
      status: "pending" as const,
      score: 0,
      level: "C" as RecommendationLevel,
      levelLabel: LEVEL_LABELS.C,
      reasons: [],
      risks: [],
      nextAction: "",
    };
  });

  // Process serially
  for (const candidate of candidates) {
    try {
      candidate.status = "running";

      const description = candidate.rawInput;

      // Step 1: Sourcing
      candidate.sourcing = await runSourcing(candidate.name, description);

      // Step 2: Risk
      candidate.risk = await runRisk(candidate.name, description);

      // Step 3: Summary (with sourcing + risk context)
      candidate.summary = await runSummary(candidate.name, description, candidate.sourcing, candidate.risk);

      // Compute score and level
      candidate.score = calculateScore(candidate);
      candidate.level = getLevel(candidate.score);
      candidate.levelLabel = LEVEL_LABELS[candidate.level];
      candidate.reasons = buildReasons(candidate);
      candidate.risks = buildRiskItems(candidate);
      candidate.nextAction = buildNextAction(candidate);

      candidate.status = "completed";
    } catch (error) {
      candidate.status = "failed";
      candidate.errorMessage = error instanceof Error ? error.message : "未知错误";
      candidate.score = calculateScore(candidate);
      candidate.level = getLevel(candidate.score);
      candidate.levelLabel = LEVEL_LABELS[candidate.level];
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  const completedCount = candidates.filter((c) => c.status === "completed").length;
  const failedCount = candidates.filter((c) => c.status === "failed").length;

  return { candidates, totalCount: candidates.length, completedCount, failedCount };
}
