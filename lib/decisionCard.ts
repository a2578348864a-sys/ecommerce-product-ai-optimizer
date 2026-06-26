/**
 * Phase Core-3 — Decision Card Model
 *
 * Compresses AI long reports into actionable decision cards.
 * Pure functions, no AI calls, no DB writes, no schema changes.
 * Reusable across /agent/run and /tasks/[id].
 */

// ── Types ───────────────────────────────────────

export type DecisionRecommendation = "advance" | "caution" | "reject" | "needs_more_info";

export const RECOMMENDATION_LABELS: Record<DecisionRecommendation, string> = {
  advance: "可继续推进",
  caution: "谨慎推进",
  reject: "建议放弃",
  needs_more_info: "待补资料",
};

export const RECOMMENDATION_TONES: Record<DecisionRecommendation, string> = {
  advance: "border-emerald-200 bg-emerald-50 text-emerald-700",
  caution: "border-amber-200 bg-amber-50 text-amber-700",
  reject: "border-rose-200 bg-rose-50 text-rose-700",
  needs_more_info: "border-sky-200 bg-sky-50 text-sky-700",
};

export type DecisionCard = {
  recommendation: DecisionRecommendation;
  recommendationLabel: string;
  headline: string;

  riskLevel: string;
  biggestRisk: string;

  profitSignal: string;
  profitSummary: string;

  beginnerFitLabel: string;

  nextActionLabel: string;
  nextActionDescription: string;

  reviewPoints: { key: string; label: string; severity: "high" | "medium" | "low" }[];

  listingReadiness: { ready: boolean; label: string; description: string };

  missingFields: string[];
};

// ── Helpers ─────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

// ── Builder ─────────────────────────────────────

export function buildDecisionCard(input: {
  resultJson?: unknown;
  riskReviewSnapshot?: unknown;
  profitSnapshot?: unknown;
  pipelineStatus?: string;
}): DecisionCard {
  const result = isRecord(input.resultJson) ? input.resultJson : null;
  const finalReport = result && isRecord(result.finalReport) ? result.finalReport : null;
  const riskSnap = isRecord(input.riskReviewSnapshot) ? input.riskReviewSnapshot : null;
  const profitSnap = isRecord(input.profitSnapshot) ? input.profitSnapshot : null;
  const pipeStatus = text(input.pipelineStatus).toLowerCase();

  // ── Recommendation ──
  const rawRisk = text(finalReport?.riskLevel || result?.level || "").toLowerCase();
  const verdict = text(finalReport?.finalVerdict || result?.oneLineSummary || "");

  let recommendation: DecisionRecommendation;
  let headline: string;

  if (pipeStatus === "abandoned" || rawRisk === "red" || rawRisk === "high" || /放弃|不建议|淘汰|高风险/.test(verdict)) {
    recommendation = "reject";
    headline = verdict || "AI 分析判断当前候选风险较高，建议放弃或重新评估。";
  } else if (!finalReport && !riskSnap && !profitSnap) {
    recommendation = "needs_more_info";
    headline = "当前商品缺少关键分析数据，建议补充后再判断。";
  } else if (rawRisk === "yellow" || rawRisk === "medium" || /谨慎|注意|复核|确认/.test(verdict)) {
    recommendation = "caution";
    headline = verdict || "AI 分析提示需注意部分风险，建议人工复核后再推进。";
  } else if (rawRisk === "green" || rawRisk === "low" || /可.*测试|可.*推进|继续/.test(verdict)) {
    recommendation = "advance";
    headline = verdict || "AI 分析判断当前候选具备继续推进价值，可进入 Listing 准备。";
  } else {
    recommendation = "caution";
    headline = verdict || "AI 分析已完成，建议人工复核后决定是否推进。";
  }

  // ── Risk ──
  const riskLabel = rawRisk === "red" || rawRisk === "high" ? "高风险" :
    rawRisk === "green" || rawRisk === "low" ? "低风险" :
    rawRisk === "yellow" || rawRisk === "medium" ? "中风险" : "未知";
  const rawRiskSummary = text(riskSnap?.summary || riskSnap?.overallLevel || finalReport?.riskLevel || "");
  // Filter out raw enum values (green/red/yellow) from being displayed as risk description
  const isRawEnum = /^(green|red|yellow|low|medium|high|unknown)$/i.test(rawRiskSummary);
  const riskItems = arr(riskSnap?.complianceWarnings || riskSnap?.blacklistMatches || []);
  const biggestRisk = (!isRawEnum && rawRiskSummary) ? rawRiskSummary
    : riskItems[0]
    || (rawRisk === "red" || rawRisk === "high" ? "存在较高风险，建议先复核侵权、合规、认证和平台禁售规则，再决定是否继续推进。"
    : rawRisk === "yellow" || rawRisk === "medium" ? "存在待复核风险，建议重点确认侵权、平台规则、成本利润和供应商稳定性。"
    : rawRisk === "green" || rawRisk === "low" ? "暂无明确高风险，仍需复核侵权、合规、供应商和售后风险。"
    : "当前缺少结构化风险说明，建议人工复核侵权、认证、平台规则和售后风险。");

  // ── Profit ──
  const hasProfit = profitSnap && (typeof profitSnap === "object");
  const purchaseCost = profitSnap && typeof (profitSnap as Record<string,unknown>).purchaseCost === "number" ? (profitSnap as Record<string,unknown>).purchaseCost as number : 0;
  const salePrice = profitSnap && typeof (profitSnap as Record<string,unknown>).salePrice === "number" ? (profitSnap as Record<string,unknown>).salePrice as number : 0;
  const estProfit = profitSnap && typeof (profitSnap as Record<string,unknown>).estimatedProfit === "number" ? (profitSnap as Record<string,unknown>).estimatedProfit as number : 0;
  const marginRate = profitSnap && typeof (profitSnap as Record<string,unknown>).estimatedMarginRate === "number" ? (profitSnap as Record<string,unknown>).estimatedMarginRate as number : -1;
  const profitSignal = hasProfit && estProfit > 0 ? "有利润空间" : hasProfit ? "利润微薄" : "利润未知";
  const profitSummary = hasProfit
    ? `采购 ¥${purchaseCost} / 售价 ¥${salePrice} / 利润 ¥${estProfit.toFixed(2)}${marginRate >= 0 ? ` / 毛利率 ${(marginRate * 100).toFixed(1)}%` : ""}`
    : "当前缺少结构化利润数据，暂不能判断是否具备小批量测试价值。";

  // ── Beginner ──
  const beginnerFit = text(finalReport?.beginnerFit || "");

  // ── Next action ──
  const nextActionMap: Record<string, { label: string; desc: string }> = {
    advance: { label: "推进到 Listing 准备", desc: "复核通过，可进入标题、关键词、五点描述的生成阶段。" },
    caution: { label: "复核风险点", desc: "AI 提示存在需注意的风险项，请人工确认后再决定是否推进。" },
    reject: { label: "建议放弃或重新评估", desc: "该候选风险较高或利润不足，建议不再继续投入。" },
    needs_more_info: { label: "补充关键信息", desc: "当前缺少利润或风险数据，需补充供应商报价、采购成本等信息后重新判断。" },
  };
  const nextAction = nextActionMap[recommendation] || nextActionMap.caution;

  // ── Review points ──
  const reviewPoints: DecisionCard["reviewPoints"] = [];
  if (riskItems.length > 0) {
    riskItems.slice(0, 3).forEach((r) => reviewPoints.push({ key: "risk_" + r.slice(0, 10), label: r, severity: "high" }));
  } else {
    reviewPoints.push({ key: "compliance", label: "核查侵权、品牌词和平台合规风险", severity: "high" });
  }
  if (!hasProfit || estProfit <= 0) {
    reviewPoints.push({ key: "profit", label: "补充采购成本、售价和运费信息", severity: "high" });
  } else if (recommendation !== "reject") {
    reviewPoints.push({ key: "profit_verify", label: "确认利润空间是否足够覆盖售后和退货成本", severity: "medium" });
  }
  if (!beginnerFit) {
    reviewPoints.push({ key: "beginner", label: "判断是否适合新手操作，是否有特殊门槛", severity: "medium" });
  }
  reviewPoints.push({ key: "supplier", label: "确认供应商 MOQ、报价稳定性和发货周期", severity: "medium" });

  // ── Listing readiness ──
  const listingReady = recommendation === "advance";
  const listingLabel = listingReady ? "可进入 Listing 准备" : recommendation === "reject" ? "不建议生成" : "暂缓 Listing";

  // ── Missing fields ──
  const missingFields: string[] = [];
  if (!finalReport) missingFields.push("AI 分析报告");
  if (!hasProfit) missingFields.push("利润数据");
  if (!riskSnap) missingFields.push("风险快照");

  return {
    recommendation,
    recommendationLabel: RECOMMENDATION_LABELS[recommendation],
    headline,
    riskLevel: riskLabel,
    biggestRisk,
    profitSignal,
    profitSummary,
    beginnerFitLabel: beginnerFit || "暂无",
    nextActionLabel: nextAction.label,
    nextActionDescription: nextAction.desc,
    reviewPoints,
    listingReadiness: {
      ready: listingReady,
      label: listingLabel,
      description: listingReady
        ? "已支持规则草稿 Listing 包，可复制后人工复核；真实 AI 生成待后续升级。"
        : recommendation === "reject"
          ? "该候选不建议继续推进，无需生成 Listing。"
          : "建议先复核风险、利润和供应商信息，再生成或使用 Listing 草稿。",
    },
    missingFields,
  };
}
