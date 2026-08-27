import { describe, expect, it } from "vitest";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  buildProductResearchHash,
  createInitialProductResearchRecord,
  createProductResearchVerification,
} from "@/lib/productResearchRecord";
import {
  TaskResultJsonMutationError,
  applyTaskResultJsonMutation,
  type TaskResultJsonWriter,
} from "@/lib/server/taskResultJsonMutation";

function protectedResult() {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId: "candidate-test",
    runId: "workflow-run-test",
    contextHash: "a".repeat(64),
    inputHash: "b".repeat(64),
    resultHash: "c".repeat(64),
    workflowStatus: "completed",
    reviewState: {
      sourcingReviewed: true,
      riskReviewed: true,
      summaryReviewed: true,
      listingReviewed: true,
      reviewedCount: 4,
      totalReviewSteps: 4,
      allReviewed: true,
    },
  });
  const researchRecord = createInitialProductResearchRecord({
    candidateId: verification.candidateId,
    runId: verification.runId,
    contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: "2026-08-03T00:00:00.000Z",
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: "creative_ready",
      reason: "Evidence reviewed.",
      nextAction: "Wait for a separate handoff.",
    },
  });
  return {
    researchRecord,
    researchVerification: verification,
    unknownNamespace: { nested: [1, { keep: true }] },
    productLifecycle: { state: "investigating" },
    listingPackSnapshot: { version: 1 },
    aiListingPackSnapshot: { version: 1 },
    aiImageDraftSnapshot: { version: 1 },
  };
}

function snapshot(resultJson: string) {
  return {
    id: "task-1",
    type: "workflow",
    updatedAt: new Date("2026-08-03T00:00:00.000Z"),
    resultJson,
    decisionStatus: "continue",
  };
}

describe("task resultJson namespace mutation", () => {
  it.each([
    ["lifecycle", "productLifecycle"],
    ["listing-pack", "listingPackSnapshot"],
    ["ai-listing", "aiListingPackSnapshot"],
    ["ai-image", "aiImageDraftSnapshot"],
  ] as const)("lets %s change only %s while preserving research and unknown namespaces", async (writer, namespace) => {
    const current = protectedResult();
    const currentJson = JSON.stringify(current);
    const next = await applyTaskResultJsonMutation({
      currentResultJson: currentJson,
      writer,
      snapshot: snapshot(currentJson),
      mutate: (document) => ({
        result: { ...document, [namespace]: { version: 2 } },
        value: "saved",
        updatedAt: "2026-08-03T01:00:00.000Z",
      }),
    });
    const saved = JSON.parse(next.resultJson);
    expect(saved.researchRecord).toEqual(current.researchRecord);
    expect(saved.researchVerification).toEqual(current.researchVerification);
    expect(saved.unknownNamespace).toEqual(current.unknownNamespace);
    expect(saved[namespace]).toEqual({ version: 2 });
    expect(next.decisionStatus).toBeUndefined();
  });

  it("rejects an unowned namespace change and non-decision column write", async () => {
    const currentJson = JSON.stringify(protectedResult());
    await expect(applyTaskResultJsonMutation({
      currentResultJson: currentJson,
      writer: "lifecycle",
      snapshot: snapshot(currentJson),
      mutate: (document) => ({
        result: { ...document, productLifecycle: { state: "done" }, researchRecord: null },
        value: null,
      }),
    })).rejects.toMatchObject({ code: "namespace_contract_invalid", status: 500 });

    await expect(applyTaskResultJsonMutation({
      currentResultJson: currentJson,
      writer: "listing-pack",
      snapshot: snapshot(currentJson),
      mutate: (document) => ({
        result: { ...document, listingPackSnapshot: { version: 2 } },
        value: null,
        decisionStatus: "rejected",
      }),
    })).rejects.toMatchObject({ code: "namespace_contract_invalid", status: 500 });
  });

  it.each([
    ["not-json", "invalid_result_json"],
    [JSON.stringify({ researchRecord: "bad" }), "invalid_research_record"],
    [JSON.stringify({ researchRecord: { schema: "product-research-record.v1" } }), "invalid_research_record"],
  ])("fails closed for malformed protected input", async (currentResultJson, code) => {
    await expect(applyTaskResultJsonMutation({
      currentResultJson,
      writer: "listing-pack" as TaskResultJsonWriter,
      snapshot: snapshot(currentResultJson),
      mutate: (document) => ({ result: document, value: null }),
    })).rejects.toEqual(expect.objectContaining({ code }));
  });

  it("only research-decision may change the research namespace and compatibility column", async () => {
    const current = protectedResult();
    const currentJson = JSON.stringify(current);
    const next = await applyTaskResultJsonMutation({
      currentResultJson: currentJson,
      writer: "research-decision",
      snapshot: snapshot(currentJson),
      mutate: (document) => ({
        result: { ...document, researchRecord: current.researchRecord },
        value: null,
        decisionStatus: "need_info",
      }),
    });
    expect(JSON.parse(next.resultJson).researchRecord).toEqual(current.researchRecord);
    expect(next.decisionStatus).toBe("need_info");
  });

  it("returns typed fail-closed errors", () => {
    const error = new TaskResultJsonMutationError("task_result_conflict", 409, "conflict");
    expect(error).toMatchObject({ code: "task_result_conflict", status: 409, name: "TaskResultJsonMutationError" });
  });

  // ── listing-creation-brief：save_listing_brief 专用写者的真实 namespace 合同（不经任何 mock） ──
  it("lets listing-creation-brief create and update listingCreationBrief while preserving every other namespace", async () => {
    const current = protectedResult();
    const withBrief: Record<string, unknown> = {
      ...current,
      listingKeywordBrief: { primaryKeyword: "keep-kw" },
    };
    const currentJson = JSON.stringify(withBrief);
    const next = await applyTaskResultJsonMutation({
      currentResultJson: currentJson,
      writer: "listing-creation-brief",
      snapshot: snapshot(currentJson),
      mutate: (document) => ({
        result: { ...document, listingCreationBrief: { schema: "listing-creation-brief.v1", coreSellingPoint: "updated" } },
        value: "saved",
        updatedAt: "2026-08-03T01:00:00.000Z",
      }),
    });
    const saved = JSON.parse(next.resultJson);
    expect(saved.listingCreationBrief).toEqual({ schema: "listing-creation-brief.v1", coreSellingPoint: "updated" });
    expect(saved.listingKeywordBrief).toEqual({ primaryKeyword: "keep-kw" });
    expect(saved.researchRecord).toEqual(current.researchRecord);
    expect(saved.researchVerification).toEqual(current.researchVerification);
    expect(saved.unknownNamespace).toEqual(current.unknownNamespace);
    expect(saved.productLifecycle).toEqual(current.productLifecycle);
    expect(saved.listingPackSnapshot).toEqual(current.listingPackSnapshot);
    expect(saved.aiListingPackSnapshot).toEqual(current.aiListingPackSnapshot);
    expect(saved.aiImageDraftSnapshot).toEqual(current.aiImageDraftSnapshot);
    expect(next.decisionStatus).toBeUndefined();
  });

  it("lets listing-creation-brief delete its own listingCreationBrief via destructuring without leaving an own property", async () => {
    const current = protectedResult();
    const withBrief: Record<string, unknown> = {
      ...current,
      listingCreationBrief: { schema: "listing-creation-brief.v1", coreSellingPoint: "to-remove" },
    };
    const currentJson = JSON.stringify(withBrief);
    const next = await applyTaskResultJsonMutation({
      currentResultJson: currentJson,
      writer: "listing-creation-brief",
      snapshot: snapshot(currentJson),
      mutate: (document) => {
        const { listingCreationBrief: _removed, ...rest } = document;
        return { result: rest, value: "saved", updatedAt: "2026-08-03T01:00:00.000Z" };
      },
    });
    const saved = JSON.parse(next.resultJson);
    expect(Object.prototype.hasOwnProperty.call(saved, "listingCreationBrief")).toBe(false);
    expect(saved.researchRecord).toEqual(current.researchRecord);
    expect(saved.unknownNamespace).toEqual(current.unknownNamespace);
  });

  it.each([
    ["listingKeywordBrief", { primaryKeyword: "hijack" }],
    ["aiListingPackSnapshot", { version: 99 }],
    ["unownedNewNamespace", { intrude: true }],
  ])("rejects listing-creation-brief touching %s with namespace_contract_invalid/500 and leaves the input untouched", async (intruder, value) => {
    const current = protectedResult();
    const currentJson = JSON.stringify(current);
    await expect(applyTaskResultJsonMutation({
      currentResultJson: currentJson,
      writer: "listing-creation-brief",
      snapshot: snapshot(currentJson),
      mutate: (document) => ({
        result: { ...document, listingCreationBrief: { schema: "listing-creation-brief.v1" }, [intruder]: value },
        value: "saved",
      }),
    })).rejects.toMatchObject({ code: "namespace_contract_invalid", status: 500 });
    expect(currentJson).toBe(JSON.stringify(current));
  });
});
