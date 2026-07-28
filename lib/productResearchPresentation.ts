import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { getAiListingPackSnapshot } from "@/lib/tasks/listingSnapshotUi";

export type ProductResearchStageKey =
  | "pending_research"
  | "product_understanding"
  | "market_research"
  | "creative_preparation"
  | "awaiting_human_confirmation"
  | "completed"
  | "archived"
  | "unknown";

export type ProductResearchPresentationInput = {
  id: string;
  title?: string | null;
  type?: string | null;
  decisionStatus?: string | null;
  result?: unknown;
};

export type ProductResearchArtifactKey =
  | "market_analysis"
  | "listing_draft"
  | "image_plan"
  | "human_conclusion";

export type ProductResearchArtifact = {
  key: ProductResearchArtifactKey;
  label: string;
};

export type ProductResearchManualCheck = {
  key: "sourcing" | "profit" | "compliance";
  label: string;
  status: "unverified" | "needs_input" | "needs_human_confirmation";
  statusLabel: "未验证" | "待补充" | "需人工确认";
  message: string;
};

export type ProductResearchAction = {
  label: string;
  href: string;
};

const ARTIFACT_LABELS: Record<ProductResearchArtifactKey, string> = {
  market_analysis: "市场研究结论",
  listing_draft: "Listing 准备内容",
  image_plan: "图片创作需求",
  human_conclusion: "人工结论",
};

const STAGE_LABELS: Record<ProductResearchStageKey, string> = {
  pending_research: "待研究",
  product_understanding: "商品理解中",
  market_research: "市场研究中",
  creative_preparation: "创作准备中",
  awaiting_human_confirmation: "待人工确认",
  completed: "已完成",
  archived: "已归档",
  unknown: "状态待确认",
};

const HUMAN_DECISION_STATUSES = new Set(["continue", "need_info", "rejected"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasStringArray(value: unknown) {
  return Array.isArray(value) && value.some(hasText);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (hasText(value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (!isRecord(value)) return false;
  return Object.values(value).some(hasMeaningfulValue);
}

function recordHasContent(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return keys.some((key) => hasMeaningfulValue(value[key]));
}

function getRecord(value: unknown) {
  return isRecord(value) ? value : null;
}

function cleanStrings(values: unknown[]) {
  return Array.from(new Set(values.filter(hasText).map((value) => value.trim())));
}

function hasSummarySnapshotFacts(value: unknown) {
  const summary = getRecord(value);
  if (!summary) return false;
  const decision = hasText(summary.decision) ? summary.decision : "unknown";
  const decisionReason = hasText(summary.decisionReason) ? summary.decisionReason.trim() : "";
  return decision !== "unknown"
    || recordHasContent(summary, ["targetUser", "sellingPoints", "concerns"])
    || (decisionReason.length > 0 && decisionReason !== "AI 结论不足，需人工判断。");
}

function hasValidatedAiListingPackSnapshot(result: Record<string, unknown>) {
  if (!getAiListingPackSnapshot(result)) return false;
  const snapshot = getRecord(result.aiListingPackSnapshot);
  if (!snapshot || snapshot.savedBy !== "owner") return false;
  if (!hasText(snapshot.savedAt) || Number.isNaN(Date.parse(snapshot.savedAt))) return false;
  return validateAiListingPackDraft(snapshot).ok;
}

function hasMarketFacts(result: Record<string, unknown>) {
  const finalReport = getRecord(result.finalReport);
  const agentOutput = getRecord(result.agentOutputSnapshot);
  const summarySnapshot = getRecord(agentOutput?.summarySnapshot);
  return recordHasContent(finalReport, [
    "finalVerdict",
    "riskLevel",
    "beginnerFit",
    "sellingPoints",
    "riskWarnings",
    "nextSteps",
    "manualReviewChecklist",
  ])
    || hasSummarySnapshotFacts(summarySnapshot)
    || recordHasContent(result.summary, [
      "decision",
      "decisionReason",
      "verdict",
      "sellingPoints",
      "risks",
    ]);
}

function hasListingFacts(result: Record<string, unknown>) {
  const listingPrep = getRecord(result.listingPrepSnapshot);
  const agentOutput = getRecord(result.agentOutputSnapshot);
  const listingSnapshot = getRecord(agentOutput?.listingSnapshot);
  return recordHasContent(listingPrep, [
    "titleStructure",
    "keywordPool",
    "bulletPoints",
    "description",
    "imageMaterialNeeds",
  ])
    || recordHasContent(result.listing, [
      "title",
      "keywords",
      "bulletPoints",
      "description",
      "complianceNotes",
    ])
    || hasValidatedAiListingPackSnapshot(result)
    || recordHasContent(result.listingPackSnapshot, ["pack", "draft", "listing"])
    || (
      Boolean(listingSnapshot)
      && (
        (hasText(listingSnapshot?.titleDraft)
          && listingSnapshot.titleDraft.trim() !== "暂未生成 Listing 标题")
        || recordHasContent(listingSnapshot, [
          "keywordHints",
          "descriptionDraft",
          "imageIdeas",
          "complianceNotes",
        ])
      )
    );
}

function hasImageFacts(result: Record<string, unknown>) {
  const listingPrep = getRecord(result.listingPrepSnapshot);
  const agentOutput = getRecord(result.agentOutputSnapshot);
  const listingSnapshot = getRecord(agentOutput?.listingSnapshot);
  return hasStringArray(listingPrep?.imageMaterialNeeds)
    || hasStringArray(listingSnapshot?.imageIdeas)
    || recordHasContent(result.aiImageDraftSnapshot, ["items"]);
}

function hasHumanConclusion(result: Record<string, unknown>) {
  const humanDecision = getRecord(result.humanDecision);
  if (!humanDecision) return false;
  const status = hasText(humanDecision.status) ? humanDecision.status : "";
  return humanDecision.source === "user"
    && HUMAN_DECISION_STATUSES.has(status)
    && hasStringArray(humanDecision.confirmedItems);
}

function hasCreativeFacts(result: Record<string, unknown>) {
  return hasListingFacts(result) || hasImageFacts(result);
}

function hasProductFacts(result: Record<string, unknown>) {
  return recordHasContent(result.product, [
    "productName",
    "title",
    "asin",
    "url",
    "category",
    "brand",
  ])
    || recordHasContent(result.normalizedProduct, [
      "productName",
      "title",
      "asin",
      "url",
      "category",
      "brand",
    ])
    || recordHasContent(result.normalized, [
      "productName",
      "title",
      "asin",
      "url",
      "category",
      "brand",
    ]);
}

function deriveStage(input: ProductResearchPresentationInput): ProductResearchStageKey {
  const result = isRecord(input.result) ? input.result : {};
  const lifecycle = isRecord(result.productLifecycle) ? result.productLifecycle : {};
  const humanDecision = isRecord(result.humanDecision) ? result.humanDecision : {};
  const decisionStatus = hasText(humanDecision.status)
    ? humanDecision.status
    : input.decisionStatus;

  if (lifecycle.status === "abandoned" || decisionStatus === "rejected") return "archived";
  if (decisionStatus === "continue") return "awaiting_human_confirmation";
  if (lifecycle.status === "ready_to_test") return "awaiting_human_confirmation";
  if (decisionStatus === "need_info" && (hasMarketFacts(result) || hasCreativeFacts(result))) {
    return "awaiting_human_confirmation";
  }
  if (hasCreativeFacts(result)) return "creative_preparation";
  if (hasMarketFacts(result)) return "market_research";
  if (hasProductFacts(result)) return "product_understanding";
  if (input.type === "workflow" || input.type === "opportunities") return "pending_research";
  return "unknown";
}

function deriveArtifacts(
  input: ProductResearchPresentationInput,
  result: Record<string, unknown>,
): ProductResearchArtifact[] {
  const keys: ProductResearchArtifactKey[] = [];
  if (hasMarketFacts(result)) keys.push("market_analysis");
  if (hasListingFacts(result)) keys.push("listing_draft");
  if (hasImageFacts(result)) keys.push("image_plan");
  if (hasHumanConclusion(result)) {
    keys.push("human_conclusion");
  }
  return keys.map((key) => ({ key, label: ARTIFACT_LABELS[key] }));
}

function deriveResearchConclusions(result: Record<string, unknown>) {
  const finalReport = getRecord(result.finalReport);
  const agentOutput = getRecord(result.agentOutputSnapshot);
  const summarySnapshot = getRecord(agentOutput?.summarySnapshot);
  const summary = getRecord(result.summary);
  return cleanStrings([
    finalReport?.finalVerdict,
    summarySnapshot?.decisionReason,
    summary?.decisionReason,
    summary?.verdict,
  ]);
}

function deriveManualChecks(result: Record<string, unknown>): ProductResearchManualCheck[] {
  const hasProfitInput = recordHasContent(result.profitSnapshot, [
    "purchaseCost",
    "salePrice",
    "logisticsCost",
    "commissionRate",
    "estimatedProfit",
  ]);
  const hasRiskReview = recordHasContent(result.riskReviewSnapshot, [
    "riskLevel",
    "overallLevel",
    "overallPrecheckLevel",
    "overallStatus",
    "items",
    "summary",
  ]);

  return [
    {
      key: "sourcing",
      label: "供货与供应商",
      status: "unverified",
      statusLabel: "未验证",
      message: "当前没有可靠供应商数据，需要人工寻找和确认。",
    },
    {
      key: "profit",
      label: "成本与利润",
      status: hasProfitInput ? "needs_human_confirmation" : "needs_input",
      statusLabel: hasProfitInput ? "需人工确认" : "待补充",
      message: hasProfitInput
        ? "已有人工估算输入，仍需补充并核对采购、物流、平台费用和广告预算。"
        : "当前缺少真实采购、物流、平台费用和广告预算，需要人工补充。",
    },
    {
      key: "compliance",
      label: "合规与知识产权",
      status: hasRiskReview ? "needs_human_confirmation" : "unverified",
      statusLabel: hasRiskReview ? "需人工确认" : "未验证",
      message: hasRiskReview
        ? "当前仅提供风险提示，不能替代专业合规或知识产权审核。"
        : "当前没有可靠合规结论，需要人工或专业人员核验。",
    },
  ];
}

function deriveActions(
  input: ProductResearchPresentationInput,
  artifacts: ProductResearchArtifact[],
): ProductResearchAction[] {
  const encodedId = encodeURIComponent(input.id);
  const artifactKeys = new Set(artifacts.map((artifact) => artifact.key));
  const actions: ProductResearchAction[] = [];

  if (artifactKeys.has("market_analysis") || artifactKeys.has("listing_draft")) {
    actions.push({
      label: "打开 Listing Studio",
      href: `/listing-studio?taskId=${encodedId}`,
    });
  }
  if (artifactKeys.has("listing_draft") || artifactKeys.has("image_plan")) {
    actions.push({
      label: "打开 Image Studio",
      href: `/image-studio?taskId=${encodedId}`,
    });
  }
  return actions;
}

export type ProductResearchPresentation = {
  stage: {
    key: ProductResearchStageKey;
    label: string;
  };
  artifacts: ProductResearchArtifact[];
  researchConclusions: string[];
  manualChecks: ProductResearchManualCheck[];
  actions: ProductResearchAction[];
};

export function deriveProductResearchPresentation(
  input: ProductResearchPresentationInput,
): ProductResearchPresentation {
  const result = isRecord(input.result) ? input.result : {};
  const stage = deriveStage(input);
  const artifacts = deriveArtifacts(input, result);
  return {
    stage: {
      key: stage,
      label: STAGE_LABELS[stage],
    },
    artifacts,
    researchConclusions: deriveResearchConclusions(result),
    manualChecks: deriveManualChecks(result),
    actions: deriveActions(input, artifacts),
  };
}
