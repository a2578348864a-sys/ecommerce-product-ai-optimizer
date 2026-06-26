/**
 * Phase Core-1 — Product Pipeline Status & Next Action Derivation
 *
 * Pure frontend helpers. No DB writes, no AI calls, no schema changes.
 * Derives product advancement status from existing task result data.
 */

// ── Types ───────────────────────────────────────

export type PipelineStatus =
  | "needs_review"
  | "needs_more_info"
  | "ready_to_advance"
  | "ready_for_listing"
  | "listing_ready"
  | "high_risk"
  | "abandoned"
  | "completed";

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  needs_review: "待复核",
  needs_more_info: "待补资料",
  ready_to_advance: "可继续推进",
  ready_for_listing: "准备 Listing",
  listing_ready: "Listing 已准备",
  high_risk: "高风险待放弃",
  abandoned: "已放弃",
  completed: "已完成",
};

export const PIPELINE_STATUS_TONES: Record<PipelineStatus, string> = {
  needs_review: "border-amber-200 bg-amber-50 text-amber-700",
  needs_more_info: "border-sky-200 bg-sky-50 text-sky-700",
  ready_to_advance: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ready_for_listing: "border-teal-200 bg-teal-50 text-teal-700",
  listing_ready: "border-indigo-200 bg-indigo-50 text-indigo-700",
  high_risk: "border-rose-200 bg-rose-50 text-rose-700",
  abandoned: "border-slate-200 bg-slate-50 text-slate-500",
  completed: "border-slate-200 bg-slate-100 text-slate-600",
};

export const PIPELINE_STATUS_ORDER: Record<PipelineStatus, number> = {
  needs_review: 1,
  high_risk: 2,
  needs_more_info: 3,
  ready_to_advance: 4,
  ready_for_listing: 5,
  listing_ready: 6,
  completed: 7,
  abandoned: 8,
};

export type NextActionKey =
  | "review_ai_result"
  | "complete_product_info"
  | "check_risk"
  | "check_profit"
  | "advance_to_listing"
  | "generate_listing_pack"
  | "abandon"
  | "done";

export type ProductNextAction = {
  key: NextActionKey;
  label: string;
  description: string;
  priority: "high" | "medium" | "low";
};

export const NEXT_ACTIONS: Record<NextActionKey, ProductNextAction> = {
  review_ai_result: {
    key: "review_ai_result",
    label: "复核 AI 结论",
    description: "AI 分析已完成，需人工逐项确认货源、风险、利润和结论。",
    priority: "high",
  },
  complete_product_info: {
    key: "complete_product_info",
    label: "补充商品/货源信息",
    description: "关键信息缺失，需补充供应商报价、采购成本、物流等信息后再判断。",
    priority: "high",
  },
  check_risk: {
    key: "check_risk",
    label: "复核风险点",
    description: "存在风险提示，需确认合规、侵权、认证等风险后再推进。",
    priority: "high",
  },
  check_profit: {
    key: "check_profit",
    label: "复核利润空间",
    description: "利润数据不完整或过低，需重新核算后再决定。",
    priority: "high",
  },
  advance_to_listing: {
    key: "advance_to_listing",
    label: "推进到 Listing 准备",
    description: "复核通过，可进入 Listing 标题、关键词、五点描述的生成阶段。",
    priority: "medium",
  },
  generate_listing_pack: {
    key: "generate_listing_pack",
    label: "生成 AI Listing 包",
    description: "Core-4 阶段将自动生成标题、五点描述、关键词、卖点、图片需求。",
    priority: "medium",
  },
  abandon: {
    key: "abandon",
    label: "建议放弃",
    description: "该候选风险过高或利润不足，建议不再推进。",
    priority: "low",
  },
  done: {
    key: "done",
    label: "已完成",
    description: "该任务已完成全部流程，无需进一步动作。",
    priority: "low",
  },
};

export const NEXT_ACTION_PRIORITY_ORDER: Record<string, number> = {
  high: 1,
  medium: 2,
  low: 3,
};

// ── Input type ──────────────────────────────────

export type PipelineInput = {
  decisionStatus?: string | null;
  level?: string | null;
  result?: unknown;
};

// ── Helpers ─────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// ── Derivation ──────────────────────────────────

/** Derive product pipeline status from existing task data */
export function derivePipelineStatus(input: PipelineInput): PipelineStatus {
  const ds = text(input.decisionStatus).toLowerCase();
  const rawLevel = text(input.level).toLowerCase();

  // 1. Explicitly abandoned
  if (ds === "abandoned" || ds === "dismissed" || ds === "rejected") {
    return "abandoned";
  }

  // 2. High risk
  if (rawLevel === "red" || rawLevel === "high" || rawLevel.includes("高") || rawLevel.includes("红")) {
    // Check if human has already reviewed and decided to continue
    if (ds === "continue" || ds === "approved" || ds === "selected" || ds === "ready") {
      return "ready_to_advance"; // human override
    }
    return "high_risk";
  }

  // 3. Check review state
  const result = isRecord(input.result) ? input.result : null;
  const reviewState = result && isRecord(result.reviewState) ? result.reviewState : null;
  const allReviewed = reviewState?.allReviewed === true;
  const reviewedCount = reviewState && typeof reviewState.reviewedCount === "number" ? reviewState.reviewedCount : 0;

  // 4. Not reviewed at all
  if (!allReviewed && reviewedCount === 0) {
    return "needs_review";
  }

  // 5. Partially reviewed
  if (!allReviewed && reviewedCount > 0) {
    return "needs_review";
  }

  // 6. Missing critical info (profit, risk snapshots)
  const hasProfit = result && isRecord(result.profitSnapshot);
  const hasRiskReview = result && isRecord(result.riskReviewSnapshot);
  const hasListingPrep = result && isRecord(result.listingPrepSnapshot);

  if (!hasProfit || !hasRiskReview) {
    return "needs_more_info";
  }

  // 7. All reviewed, info sufficient
  if (ds === "continue" || ds === "approved" || ds === "ready") {
    if (hasListingPrep) return "listing_ready";
    return "ready_for_listing";
  }

  // 8. Reviewed, info OK, but no explicit decision
  if (allReviewed && hasProfit && hasRiskReview) {
    return "ready_to_advance";
  }

  // 9. Completed
  if (ds === "done" || ds === "completed") {
    return "completed";
  }

  return "ready_to_advance";
}

/** Derive the next action for a task based on its pipeline status */
export function deriveNextAction(input: PipelineInput): ProductNextAction {
  const status = derivePipelineStatus(input);

  switch (status) {
    case "needs_review":
      return NEXT_ACTIONS.review_ai_result;
    case "high_risk":
      return NEXT_ACTIONS.check_risk;
    case "needs_more_info": {
      // Check which info is missing
      const result = isRecord(input.result) ? input.result : null;
      const hasProfit = result && isRecord(result.profitSnapshot);
      const hasRisk = result && isRecord(result.riskReviewSnapshot);
      if (!hasProfit) return NEXT_ACTIONS.check_profit;
      if (!hasRisk) return NEXT_ACTIONS.check_risk;
      return NEXT_ACTIONS.complete_product_info;
    }
    case "ready_to_advance":
      return NEXT_ACTIONS.advance_to_listing;
    case "ready_for_listing":
      return NEXT_ACTIONS.advance_to_listing;
    case "listing_ready":
      return NEXT_ACTIONS.generate_listing_pack;
    case "high_risk":
      // double-check: if already in high_risk, suggest abandon
      return NEXT_ACTIONS.abandon;
    case "abandoned":
      return NEXT_ACTIONS.done;
    case "completed":
      return NEXT_ACTIONS.done;
    default:
      return NEXT_ACTIONS.review_ai_result;
  }
}

/** Get a summary of pipeline stats from a list of task inputs */
export function summarizePipeline(tasks: PipelineInput[]): Record<PipelineStatus, number> {
  const counts: Record<PipelineStatus, number> = {
    needs_review: 0,
    needs_more_info: 0,
    ready_to_advance: 0,
    ready_for_listing: 0,
    listing_ready: 0,
    high_risk: 0,
    abandoned: 0,
    completed: 0,
  };
  for (const t of tasks) {
    const s = derivePipelineStatus(t);
    counts[s]++;
  }
  return counts;
}

/** Pipeline board cards for UI rendering */
export const PIPELINE_BOARD_CARDS: { status: PipelineStatus; icon: string; description: string }[] = [
  { status: "needs_review", icon: "🔍", description: "AI 分析已完成，等待人工复核结论。" },
  { status: "needs_more_info", icon: "📋", description: "关键信息缺失，需补充后再判断。" },
  { status: "ready_to_advance", icon: "✅", description: "复核通过，可继续推进下一步。" },
  { status: "ready_for_listing", icon: "📝", description: "可进入 Listing 标题、关键词准备。" },
  { status: "high_risk", icon: "⚠️", description: "存在高风险信号，建议人工确认是否继续。" },
  { status: "abandoned", icon: "🗂️", description: "已放弃，不再继续推进。" },
];
