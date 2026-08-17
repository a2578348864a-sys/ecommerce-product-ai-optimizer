import "server-only";

import {
  mergeProductResearchRecord,
  type ProductResearchRecordV1,
  type ProductResearchVerificationV1,
  type ResearchCompletionV1,
} from "@/lib/productResearchRecord";
import type { AccessContext } from "@/lib/server/accessPassword";
import {
  createTaskResultJsonMutator,
  type TaskResultJsonDatabase,
  type TaskResultJsonStorageVersion,
} from "@/lib/server/taskResultJsonMutation";

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
  verification?: ProductResearchVerificationV1;
  decisionStatus: string;
  updatedAt: string;
}) {
  return (current: Readonly<Record<string, unknown>>) => ({
    result: mergeProductResearchRecord(current, input.record, input.verification),
    value: null,
    decisionStatus: input.decisionStatus,
    updatedAt: input.updatedAt,
  });
}

/** V3 Current Research Normalization：Research Completion 命名空间写入（同一 canonical Task lifecycle 收口） */
export function createResearchCompletionResultMutation(input: {
  completion: ResearchCompletionV1;
  updatedAt: string;
}) {
  return (current: Readonly<Record<string, unknown>>) => ({
    result: { ...current, researchCompletion: input.completion },
    value: null,
    updatedAt: input.updatedAt,
  });
}

type WriterInput = {
  context: AccessContext;
  taskId: string;
  expectedStorageVersion?: TaskResultJsonStorageVersion;
};

export function createTaskResultWriterPersistence(input: {
  ownerDatabase?: TaskResultJsonDatabase;
} = {}) {
  const mutate = createTaskResultJsonMutator(input);
  return Object.freeze({
    persistResearchDecision(request: WriterInput & {
      record: ProductResearchRecordV1;
      verification?: ProductResearchVerificationV1;
      decisionStatus: string;
      updatedAt: string;
    }) {
      return mutate({
        context: request.context,
        taskId: request.taskId,
        writer: "research-decision",
        expectedStorageVersion: request.expectedStorageVersion,
        mutate: createResearchDecisionResultMutation({
          record: request.record,
          verification: request.verification,
          decisionStatus: request.decisionStatus,
          updatedAt: request.updatedAt,
        }),
      });
    },

    persistResearchCompletion(request: WriterInput & {
      completion: ResearchCompletionV1;
      updatedAt: string;
    }) {
      return mutate({
        context: request.context,
        taskId: request.taskId,
        writer: "research-completion",
        expectedStorageVersion: request.expectedStorageVersion,
        mutate: createResearchCompletionResultMutation({
          completion: request.completion,
          updatedAt: request.updatedAt,
        }),
      });
    },

    persistListingPack(request: WriterInput & {
      snapshot: Record<string, unknown>;
      updatedAt?: string;
    }) {
      return mutate({
        context: request.context,
        taskId: request.taskId,
        writer: "listing-pack",
        expectedStorageVersion: request.expectedStorageVersion,
        mutate: createListingPackResultMutation(request.snapshot, request.updatedAt),
      });
    },

    persistAiImage(request: WriterInput & {
      snapshot: unknown;
      updatedAt?: string;
    }) {
      return mutate({
        context: request.context,
        taskId: request.taskId,
        writer: "ai-image",
        expectedStorageVersion: request.expectedStorageVersion,
        mutate: createAiImageResultMutation(request.snapshot, request.updatedAt),
      });
    },
  });
}

export const taskResultWriterPersistence = createTaskResultWriterPersistence();
