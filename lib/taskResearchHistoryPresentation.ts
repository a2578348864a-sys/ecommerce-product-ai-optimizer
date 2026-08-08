import type { DecisionStatus } from "@/lib/tasks/decisionStatus";

export type ResearchHistoryStatus = {
  key: "completed" | "awaiting_decision" | "incomplete";
  label: "研究已完成" | "待人工决定" | "研究记录待补充";
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

export function deriveResearchHistoryStatus(input: {
  result: unknown;
  decisionStatus: DecisionStatus;
  oneLineSummary: string;
}): ResearchHistoryStatus {
  const result = isRecord(input.result) ? input.result : {};
  const researchSaved = hasSavedResearch(result, input.oneLineSummary);
  const humanDecisionExists = hasVersionedDecision(result)
    || isRecord(result.humanDecision)
    || input.decisionStatus !== "pending";

  if (researchSaved && humanDecisionExists) {
    return { key: "completed", label: "研究已完成", researchSaved, humanDecisionExists };
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
