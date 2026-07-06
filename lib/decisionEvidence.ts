import { getDecisionStatusOption, normalizeDecisionStatus, type DecisionStatus } from "@/lib/tasks/decisionStatus";

export type EvidenceKind =
  | "fact"
  | "user_input"
  | "calculation"
  | "rule"
  | "ai_inference"
  | "missing"
  | "conflict"
  | "human_decision";

export type EvidenceSourceType =
  | "user"
  | "candidate"
  | "product_url"
  | "system_rule"
  | "calculation"
  | "ai"
  | "historical_snapshot"
  | "unknown";

export type EvidenceStatus =
  | "confirmed"
  | "unverified"
  | "estimated"
  | "needs_review"
  | "missing"
  | "conflicting";

export type MissingPriority = "critical" | "suggested" | "not_applicable";

export type DecisionEvidenceItem = {
  id: string;
  field: string;
  label: string;
  kind: EvidenceKind;
  value?: string | number | boolean | string[] | null;
  summary: string;
  sourceType: EvidenceSourceType;
  sourceLabel?: string;
  sourceUrl?: string;
  capturedAt?: string;
  status: EvidenceStatus;
  confidence?: "high" | "medium" | "low" | "unknown";
  assumptions?: string[];
  dependencies?: string[];
  verificationNote?: string;
  missingPriority?: MissingPriority;
};

export type HumanDecisionEvidence = {
  status: DecisionStatus;
  statusLabel: string;
  reason: string;
  nextAction: string;
  decidedAt: string;
  confirmedItems: string[];
  unconfirmedItems: string[];
  source: "user";
};

export type DecisionEvidenceSnapshot = {
  version: "decision-evidence-v1";
  generatedAt: string;
  items: DecisionEvidenceItem[];
  missingData: DecisionEvidenceItem[];
  conflicts: DecisionEvidenceItem[];
  humanDecision?: HumanDecisionEvidence;
  historicalFallback: boolean;
  warnings: string[];
};

export type HumanDecisionInput = {
  status?: unknown;
  reason?: unknown;
  nextAction?: unknown;
  decidedAt?: unknown;
  confirmedItems?: unknown;
  unconfirmedItems?: unknown;
};

const SENSITIVE_KEY_PATTERN = /\b(token|access_token|api_key|key|secret|password|cookie|session|authorization|bearer)\b\s*[:=]\s*[^\s&;,]+/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function text(value: unknown, fallback = "", limit = 220) {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .trim()
    .replace(SENSITIVE_KEY_PATTERN, "$1=[redacted]")
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, "bearer [redacted]");
  return cleaned.length > limit ? `${cleaned.slice(0, Math.max(0, limit - 1))}…` : cleaned;
}

function stringArray(value: unknown, limit = 8) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const cleaned = text(item, "", 160);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function numberValue(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeUrl(value: unknown) {
  const raw = text(value, "", 500);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lowered = key.toLowerCase();
      if (["token", "key", "secret", "password", "cookie", "session"].some((sensitive) => lowered.includes(sensitive))) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function item(input: DecisionEvidenceItem): DecisionEvidenceItem {
  return input;
}

export function normalizeHumanDecision(input: HumanDecisionInput | null | undefined): HumanDecisionEvidence | undefined {
  if (!input || !isRecord(input)) return undefined;
  const status = normalizeDecisionStatus(input.status);
  const option = getDecisionStatusOption(status);
  const reason = text(input.reason, "", 500);
  const nextAction = text(input.nextAction, "", 300);
  const decidedAtRaw = text(input.decidedAt, "", 80);
  const decidedAt = decidedAtRaw && !Number.isNaN(Date.parse(decidedAtRaw))
    ? new Date(decidedAtRaw).toISOString()
    : new Date().toISOString();

  return {
    status,
    statusLabel: option.shortLabel,
    reason: reason || "未填写原因",
    nextAction: nextAction || option.description,
    decidedAt,
    confirmedItems: stringArray(input.confirmedItems, 12),
    unconfirmedItems: stringArray(input.unconfirmedItems, 12),
    source: "user",
  };
}

function pushMissing(
  items: DecisionEvidenceItem[],
  id: string,
  field: string,
  label: string,
  summary: string,
  sourceLabel = "当前任务字段检查",
  priority: MissingPriority = "critical",
) {
  items.push(item({
    id,
    field,
    label,
    kind: "missing",
    summary,
    sourceType: "system_rule",
    sourceLabel,
    status: "missing",
    confidence: "high",
    missingPriority: priority,
    verificationNote: priority === "critical"
      ? "该数据直接影响利润和风险判断，建议优先补充。"
      : priority === "suggested"
        ? "建议补充以提升判断可信度。"
        : "当前任务结构未覆盖该信息，暂不影响核心判断。",
  }));
}

export function buildDecisionEvidenceSnapshot(input: {
  workflowResult?: unknown;
  sourceMeta?: unknown;
  profitSnapshot?: unknown;
  riskReviewSnapshot?: unknown;
  reviewState?: unknown;
  humanDecision?: HumanDecisionInput | null;
} = {}): DecisionEvidenceSnapshot {
  const workflow = record(input.workflowResult);
  const finalReport = record(workflow.finalReport);
  const summary = record(workflow.summary);
  const risk = record(workflow.risk);
  const listing = record(workflow.listing);
  const sourceMeta = record(input.sourceMeta || workflow.sourceMeta);
  const sourceEvidence = record(sourceMeta.evidenceSnapshot);
  const profit = record(input.profitSnapshot);
  const riskReview = record(input.riskReviewSnapshot);
  const reviewState = record(input.reviewState);
  const items: DecisionEvidenceItem[] = [];
  const missingData: DecisionEvidenceItem[] = [];
  const conflicts: DecisionEvidenceItem[] = [];
  const generatedAt = new Date().toISOString();

  const productName = text(workflow.productName || sourceMeta.analyzedName || sourceMeta.opportunityTitle, "", 120);
  if (productName) {
    items.push(item({
      id: "product-name",
      field: "productName",
      label: "商品名称",
      kind: "user_input",
      value: productName,
      summary: "商品名称来自用户输入或候选池带入，尚不等于外部市场事实。",
      sourceType: sourceMeta.opportunityTitle ? "candidate" : "user",
      sourceLabel: sourceMeta.opportunityTitle ? "候选池上下文" : "用户输入",
      status: "unverified",
      confidence: "medium",
    }));
  } else {
    pushMissing(missingData, "missing-product-name", "productName", "商品名称", "缺少商品名称，无法可靠复盘本次判断对象。");
  }

  const sourceUrl = safeUrl(sourceMeta.sourceUrl || sourceEvidence.sourceUrl);
  if (sourceMeta.opportunityTitle || sourceEvidence.sourceName || sourceUrl) {
    items.push(item({
      id: "candidate-source",
      field: "sourceMeta",
      label: "候选来源",
      kind: "fact",
      value: text(sourceMeta.sourceTitle || sourceMeta.opportunityTitle || sourceEvidence.sourceName || sourceUrl, "候选来源", 180),
      summary: "来源只证明当前任务记录了一个候选入口，不证明销量、利润或市场需求。",
      sourceType: sourceUrl ? "product_url" : "candidate",
      sourceLabel: text(sourceEvidence.sourceName || sourceMeta.opportunitySource || "候选池记录", "", 120),
      ...(sourceUrl ? { sourceUrl } : {}),
      capturedAt: text(sourceMeta.importedAt || sourceEvidence.generatedAt, "", 80) || undefined,
      status: "unverified",
      confidence: sourceEvidence.confidence === "high" || sourceEvidence.confidence === "medium" || sourceEvidence.confidence === "low"
        ? sourceEvidence.confidence
        : "unknown",
      verificationNote: "没有接入真实市场数据；来源仍需人工打开核实。",
    }));
  } else {
    pushMissing(missingData, "missing-source", "sourceMeta", "商品来源", "当前任务没有标准化来源链接或候选池证据。", "来源元数据检查");
  }

  const purchaseCost = numberValue(profit.purchaseCost);
  const salePrice = numberValue(profit.salePrice);
  const platformFeeRate = numberValue(profit.platformFeeRate);
  const estimatedProfit = numberValue(profit.estimatedProfit);
  const estimatedMarginRate = numberValue(profit.estimatedMarginRate);
  if (purchaseCost !== null) {
    items.push(item({
      id: "purchase-cost",
      field: "profitSnapshot.purchaseCost",
      label: "采购价",
      kind: "user_input",
      value: purchaseCost,
      summary: "采购价来自人工填写或历史快照，系统未验证成交价。",
      sourceType: "user",
      sourceLabel: "成本利润估算卡",
      status: "estimated",
      confidence: "unknown",
      verificationNote: "需要用真实供应商报价或成交记录确认。",
    }));
  } else {
    pushMissing(missingData, "missing-purchase-cost", "profitSnapshot.purchaseCost", "真实采购价", "缺少采购价，利润结果不能作为采购决策依据。");
  }
  if (salePrice !== null) {
    items.push(item({
      id: "sale-price",
      field: "profitSnapshot.salePrice",
      label: "目标售价",
      kind: "user_input",
      value: salePrice,
      summary: "目标售价来自人工填写或历史快照，不代表平台真实成交价。",
      sourceType: "user",
      sourceLabel: "成本利润估算卡",
      status: "estimated",
      confidence: "unknown",
    }));
  } else {
    pushMissing(missingData, "missing-sale-price", "profitSnapshot.salePrice", "目标售价", "缺少目标售价，无法判断售价和成本的关系。");
  }
  if (purchaseCost !== null && salePrice !== null && platformFeeRate !== null && estimatedProfit !== null) {
    items.push(item({
      id: "profit-calculation",
      field: "profitSnapshot.estimatedProfit",
      label: "预计利润",
      kind: "calculation",
      value: estimatedProfit,
      summary: `按 售价 - 采购价 - 平台费 估算；当前平台费率 ${Math.round(platformFeeRate * 1000) / 10}%。`,
      sourceType: "calculation",
      sourceLabel: "代码计算",
      status: "estimated",
      confidence: "medium",
      dependencies: ["profitSnapshot.salePrice", "profitSnapshot.purchaseCost", "profitSnapshot.platformFeeRate"],
      assumptions: ["未包含真实头程/尾程物流费", "未包含广告费", "未包含退货和售后成本", "不代表实际订单利润"],
      verificationNote: estimatedMarginRate !== null ? `预计毛利率约 ${(estimatedMarginRate * 100).toFixed(1)}%，仍需补齐真实费用。` : "毛利率缺失或无法计算。",
    }));
  }
  pushMissing(missingData, "missing-logistics-cost", "profitSnapshot.logisticsCost", "真实物流成本", "当前利润结构没有保存真实物流成本。", "成本利润估算卡", "suggested");
  pushMissing(missingData, "missing-ad-cost", "profitSnapshot.adCost", "广告成本", "当前利润结构没有保存真实广告 CPC/ACOS。", "成本利润估算卡", "suggested");
  pushMissing(missingData, "missing-return-rate", "profitSnapshot.returnRate", "退货率", "当前任务没有真实退货率或售后损耗。", "成本利润估算卡", "suggested");

  const riskItems = Array.isArray(riskReview.items) ? riskReview.items.filter(isRecord) : [];
  const priorityRiskItems = riskItems.filter((riskItem) => {
    const level = text(riskItem.precheckLevel, "", 30);
    const status = text(riskItem.status, "", 30);
    return level === "medium" || level === "high" || status === "needs_check" || status === "high_risk";
  }).slice(0, 5);
  for (const [index, riskItem] of priorityRiskItems.entries()) {
    items.push(item({
      id: `risk-rule-${index + 1}`,
      field: `riskReviewSnapshot.items.${text(riskItem.key, String(index), 50)}`,
      label: text(riskItem.label, "规则风险", 80),
      kind: "rule",
      value: text(riskItem.precheckLevel, "unknown", 30),
      summary: text(riskItem.precheckReason || riskItem.checkAction, "规则命中，需要人工复核。", 220),
      sourceType: "system_rule",
      sourceLabel: "规则预筛",
      status: text(riskItem.status, "", 30) === "high_risk" ? "needs_review" : "unverified",
      confidence: "medium",
      verificationNote: text(riskItem.evidenceHint, "需留存平台规则、供应商材料或检索截图。", 220),
    }));
  }
  if (!priorityRiskItems.length) {
    pushMissing(missingData, "missing-risk-review", "riskReviewSnapshot", "合规 / 专利 / 平台规则确认", "当前任务没有已命中的结构化风险复核项，仍需人工确认合规和侵权。");
  }

  const finalVerdictEvidence = text(finalReport.finalVerdict, "", 220);
  if (finalVerdictEvidence) {
    items.push(item({
      id: "ai-final-verdict",
      field: "finalReport.finalVerdict",
      label: "AI 最终建议",
      kind: "ai_inference",
      value: finalVerdictEvidence,
      summary: "这是 AI 辅助推断和规则归纳后的建议，不是真实市场事实，也不是人工最终决定。",
      sourceType: "ai",
      sourceLabel: "Agent finalReport",
      status: "needs_review",
      confidence: "unknown",
      assumptions: ["未接入真实销量", "未接入真实广告成本", "未接入真实平台费用", "未完成法律或合规审查"],
    }));
  }

  const aiDecision = text(summary.decisionReason, "", 220);
  if (aiDecision) {
    items.push(item({
      id: "ai-final-decision",
      field: "summarySnapshot.decisionReason",
      label: "系统建议",
      kind: "ai_inference",
      value: aiDecision,
      summary: "这是 AI 辅助推断和规则归纳后的建议，不是真实市场结论，也不是人工最终决定。",
      sourceType: "ai",
      sourceLabel: "Agent summary / finalReport",
      status: "needs_review",
      confidence: "unknown",
      assumptions: ["未接入真实销量", "未接入真实广告成本", "未接入真实平台费用", "未完成法律或合规审查"],
    }));
  }

  const riskReason = text(risk.summary || finalReport.riskLevel, "", 220);
  if (riskReason) {
    items.push(item({
      id: "ai-risk-reason",
      field: "risk.summary",
      label: "AI 风险解释",
      kind: "ai_inference",
      value: riskReason,
      summary: "风险解释来自 AI 输出或兜底结果，需要结合规则预筛和人工材料确认。",
      sourceType: "ai",
      sourceLabel: "Agent risk step",
      status: "needs_review",
      confidence: "unknown",
    }));
  }

  const listingTitle = text(listing.title || listing.titleDraft, "", 160);
  if (listingTitle) {
    items.push(item({
      id: "listing-title-draft",
      field: "listing.title",
      label: "Listing 标题草稿",
      kind: "ai_inference",
      value: listingTitle,
      summary: "Listing 内容是 AI 草稿，不能直接视为可发布文案。",
      sourceType: "ai",
      sourceLabel: "Agent listing step",
      status: "needs_review",
      confidence: "unknown",
      verificationNote: "发布前需人工检查品牌词、认证、功效宣称、平台规则和真实产品参数。",
    }));
  } else {
    pushMissing(missingData, "missing-listing-title", "listing.title", "Listing 标题草稿", "当前任务缺少 Listing 标题草稿。", "Agent listing step", "suggested");
  }

  if (reviewState.allReviewed === true) {
    items.push(item({
      id: "manual-review-state",
      field: "reviewState",
      label: "人工复核状态",
      kind: "human_decision",
      value: "已完成基础人工复核",
      summary: `已复核 ${numberValue(reviewState.reviewedCount) ?? 0}/${numberValue(reviewState.totalReviewSteps) ?? 4} 项。`,
      sourceType: "user",
      sourceLabel: "人工复核勾选",
      capturedAt: text(reviewState.reviewedAt, "", 80) || undefined,
      status: "confirmed",
      confidence: "high",
    }));
  } else {
    pushMissing(missingData, "missing-manual-review", "reviewState", "人工复核完成状态", "当前任务尚未记录完整人工复核。");
  }

  const humanDecision = normalizeHumanDecision(input.humanDecision);
  if (humanDecision) {
    items.push(item({
      id: "human-final-decision",
      field: "humanDecision",
      label: "人工最终决定",
      kind: "human_decision",
      value: humanDecision.statusLabel,
      summary: humanDecision.reason,
      sourceType: "user",
      sourceLabel: "人工决定",
      capturedAt: humanDecision.decidedAt,
      status: "confirmed",
      confidence: "high",
      verificationNote: humanDecision.nextAction,
    }));
  } else {
    pushMissing(missingData, "missing-human-decision", "humanDecision", "人工最终决定原因", "当前任务尚未保存人工最终决定原因和下一步动作。");
  }

  const aiVerdict = text(finalReport.finalVerdict, "", 160);
  if (humanDecision && aiVerdict) {
    const humanRejected = humanDecision.status === "rejected";
    const aiPositive = /(可|继续|小单|推进|recommend|recommended|continue|small batch|proceed)/i.test(aiVerdict)
      && !/(不建议|暂不|放弃|not recommend|reject|stop|abandon)/i.test(aiVerdict);
    if (humanRejected && aiPositive) {
      conflicts.push(item({
        id: "conflict-ai-human-decision",
        field: "finalReport.finalVerdict vs humanDecision.status",
        label: "系统建议与人工决定不一致",
        kind: "conflict",
        value: [`系统建议：${aiVerdict}`, `人工决定：${humanDecision.statusLabel}`],
        summary: "人工决定与系统建议不同，系统保留两者，不用人工决定覆盖 AI 原始建议。",
        sourceType: "unknown",
        status: "conflicting",
        confidence: "high",
      }));
    }
  }

  const allItems = [...items, ...missingData, ...conflicts];
  return {
    version: "decision-evidence-v1",
    generatedAt,
    items: allItems,
    missingData,
    conflicts,
    ...(humanDecision ? { humanDecision } : {}),
    historicalFallback: false,
    warnings: missingData.length > 0 ? [`${missingData.length} 项关键数据仍需补充`] : [],
  };
}

export function extractDecisionEvidenceSnapshot(task: unknown): DecisionEvidenceSnapshot | null {
  let parsed = task;
  if (typeof task === "string") {
    try {
      parsed = JSON.parse(task);
    } catch {
      return null;
    }
  }
  const root = record(parsed);
  const snapshot = root.decisionEvidence;
  if (!isRecord(snapshot) || snapshot.version !== "decision-evidence-v1" || !Array.isArray(snapshot.items)) {
    return null;
  }
  return snapshot as DecisionEvidenceSnapshot;
}
