import type { DecisionStatus } from "@/lib/tasks/decisionStatus";

export type ResearchHistoryStatus = {
  key: "completed" | "awaiting_decision" | "incomplete" | "abandoned";
  label: "研究已完成" | "待人工决定" | "研究记录待补充" | "已放弃";
  researchSaved: boolean;
  humanDecisionExists: boolean;
};

export type CreativeMaterialStatus = {
  key: "available" | "needs_confirmation" | "invalid";
  label: "可用于创作" | "需要重新确认" | "资料已失效";
};

export type HistoricalArtifactSummary = {
  hasListing: boolean;
  listingUpdatedAt: string | null;
  hasImages: boolean;
  imageCount: number;
  selectedImageId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasVersionedDecision(result: Record<string, unknown>) {
  const summary = result.productResearchSummary;
  return isRecord(summary)
    && summary.schema === "product-research-record.v1"
    && hasText(summary.status);
}

function hasSavedResearch(result: Record<string, unknown>, oneLineSummary: string) {
  return hasVersionedDecision(result)
    || isRecord(result.finalReport)
    || isRecord(result.agentOutputSnapshot)
    || isRecord(result.agentRunSnapshot)
    || hasText(result.summary)
    || hasText(oneLineSummary);
}

/**
 * 第十一轮（Bug 2）：researchCompletion 是「已完成」的唯一终态依据。
 * productResearchSummary / researchRecord / finalReport / agentOutputSnapshot /
 * oneLineSummary 等最多证明「研究过程中有资料/有输出/有决定」，不能证明正式收口。
 */
export function readResearchCompletionStatus(result: Record<string, unknown> | null): "completed" | "abandoned" | null {
  if (!isRecord(result)) return null;
  const completion = result.researchCompletion;
  if (!isRecord(completion)) return null;
  if (completion.schema !== "research-completion.v1") return null;
  if (completion.status === "completed") return "completed";
  if (completion.status === "abandoned") return "abandoned";
  return null;
}

export function deriveResearchHistoryStatus(input: {
  result: unknown;
  decisionStatus: DecisionStatus;
  oneLineSummary: string;
}): ResearchHistoryStatus {
  const result = isRecord(input.result) ? input.result : {};
  const researchSaved = hasSavedResearch(result, input.oneLineSummary);
  // V3 Human Decision Authority Consistency Fix：
  // Human Decision Exists 只能由正式决定载体证明（product-research-record.v1 / 正式 humanDecision）。
  // decisionStatus 兼容列（如存量 candidate_research 的 continue）不是正式人工决定，
  // 不能单独证明"已保存人工决定"（Bentgo cmsw0bzti0004udte4dauumii 等：decisionStatus=continue
  // 但无 researchRecord → 必须显示"待确认"，与决定面板"尚未保存人工决定"一致）。
  const humanDecisionExists = hasVersionedDecision(result)
    || isRecord(result.humanDecision);

  const summaryStatus = isRecord(result.productResearchSummary)
    ? (result.productResearchSummary as Record<string, unknown>).status
    : "";
  // 第十一轮（Bug 2）：正式收口标记唯一终态依据；completed/abandoned 之外的任何
  // 资料/输出/决定组合都不得进入「已完成」。
  const completion = readResearchCompletionStatus(result);
  if (completion === "completed") {
    return { key: "completed", label: "研究已完成", researchSaved: true, humanDecisionExists: true };
  }
  if (completion === "abandoned") {
    return { key: "abandoned", label: "已放弃", researchSaved, humanDecisionExists };
  }
  if (researchSaved && humanDecisionExists) {
    // 第十一轮：abandoned 终态只能由 researchCompletion 证明；
    // 无 completion 时（含 summaryStatus=abandoned）= 研究未收口 → 待人工决定。
    return { key: "awaiting_decision", label: "待人工决定", researchSaved, humanDecisionExists };
  }
  if (researchSaved) {
    return { key: "awaiting_decision", label: "待人工决定", researchSaved, humanDecisionExists };
  }
  return { key: "incomplete", label: "研究记录待补充", researchSaved, humanDecisionExists };
}

export function deriveCreativeMaterialStatus(value: unknown): CreativeMaterialStatus {
  const result = isRecord(value) ? value : {};
  const handoff = isRecord(result.creativeHandoff) ? result.creativeHandoff : null;
  if (!handoff) return { key: "needs_confirmation", label: "需要重新确认" };
  if (handoff.controlState === "active") return { key: "available", label: "可用于创作" };
  if (handoff.controlState === "revoked") return { key: "invalid", label: "资料已失效" };
  return { key: "needs_confirmation", label: "需要重新确认" };
}

function listingTimestamp(result: Record<string, unknown>) {
  const listing = isRecord(result.aiListingPackSnapshot)
    ? result.aiListingPackSnapshot
    : isRecord(result.listingPackSnapshot)
      ? result.listingPackSnapshot
      : null;
  if (!listing) return null;
  for (const key of ["savedAt", "generatedAt", "updatedAt"] as const) {
    if (hasText(listing[key])) return listing[key] as string;
  }
  return null;
}

export function deriveHistoricalArtifactSummary(value: unknown): HistoricalArtifactSummary {
  const result = isRecord(value) ? value : {};
  const imageSnapshot = isRecord(result.aiImageDraftSnapshot) ? result.aiImageDraftSnapshot : null;
  const imageItems = imageSnapshot && Array.isArray(imageSnapshot.items)
    ? imageSnapshot.items.filter(isRecord)
    : [];
  const selection = isRecord(result.imageStudioSelection) ? result.imageStudioSelection : null;
  const selectedImageId = selection && hasText(selection.selectedImageId)
    ? selection.selectedImageId as string
    : null;
  const legacySummary = isRecord(result.legacyListSummary) ? result.legacyListSummary : null;
  const legacyArtifactSummary = legacySummary && isRecord(legacySummary.artifactSummary)
    ? legacySummary.artifactSummary
    : null;
  const legacyHasListing = legacyArtifactSummary?.hasListing === true;
  const legacyImageCount = typeof legacyArtifactSummary?.imageCount === "number"
    && Number.isSafeInteger(legacyArtifactSummary.imageCount)
    && legacyArtifactSummary.imageCount > 0
    ? legacyArtifactSummary.imageCount
    : 0;
  const hasListing = isRecord(result.aiListingPackSnapshot)
    || isRecord(result.listingPackSnapshot)
    || isRecord(result.listingPrepSnapshot)
    || isRecord(result.listing)
    || legacyHasListing;
  const imageCount = Math.max(imageItems.length, legacyImageCount);

  return {
    hasListing,
    listingUpdatedAt: listingTimestamp(result),
    hasImages: imageCount > 0,
    imageCount,
    selectedImageId,
  };
}
