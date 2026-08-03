import "server-only";

import {
  mergeProductResearchRecord,
  type ProductResearchRecordV1,
} from "@/lib/productResearchRecord";

export function buildListingPackSnapshot(
  snapshot: Record<string, unknown>,
  savedAt = new Date().toISOString(),
) {
  const safety = typeof snapshot.safety === "object" && snapshot.safety !== null && !Array.isArray(snapshot.safety)
    ? snapshot.safety as Record<string, unknown>
    : {};
  return {
    ...snapshot,
    safety: {
      ...safety,
      unverifiedClaimsSanitized: true,
      requiresHumanReview: true,
      autoListing: false,
    },
    savedAt,
  };
}

export function createListingPackResultMutation(
  snapshot: Record<string, unknown>,
  updatedAt?: string,
) {
  return (current: Readonly<Record<string, unknown>>) => ({
    result: { ...current, listingPackSnapshot: snapshot },
    value: null,
    ...(updatedAt ? { updatedAt } : {}),
  });
}

export function createAiImageResultMutation(
  snapshot: unknown,
  updatedAt?: string,
) {
  return (current: Readonly<Record<string, unknown>>) => ({
    result: { ...current, aiImageDraftSnapshot: snapshot },
    value: null,
    ...(updatedAt ? { updatedAt } : {}),
  });
}

export function createResearchDecisionResultMutation(input: {
  record: ProductResearchRecordV1;
  decisionStatus: string;
  updatedAt: string;
}) {
  return (current: Readonly<Record<string, unknown>>) => ({
    result: mergeProductResearchRecord(current, input.record),
    value: null,
    decisionStatus: input.decisionStatus,
    updatedAt: input.updatedAt,
  });
}
