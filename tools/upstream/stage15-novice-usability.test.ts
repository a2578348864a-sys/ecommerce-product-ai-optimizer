import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type { NoviceMarketScreeningItem, NoviceMarketScreeningRun } from "./novice-market-screening";
import {
  buildStage15NoviceUsabilityMaterials,
  evaluateStage15NoviceUsability,
  type Stage15NoviceUsabilityResponse,
} from "./stage15-novice-usability";

function screeningItem(index: number, status: NoviceMarketScreeningItem["status"]): NoviceMarketScreeningItem {
  const blindItemId = `blind-${String(index).padStart(2, "0")}`;
  return {
    schemaVersion: "novice-market-screening-item.v1",
    candidateId: `candidate-${index}`,
    productKey: `amazon:US:ASIN${String(index).padStart(2, "0")}`,
    stage1Rank: index,
    stage1PromotionDecision: status === "reject" ? "rejected" : status === "insufficient"
      ? "insufficient_evidence"
      : "promoted",
    screeningEvidenceSufficient: status !== "insufficient",
    userUnderstandsProduct: true,
    willingToContinueResearch: true,
    rawHumanAnswer: {
      blindItemId,
      productUnderstood: "yes",
      evidenceSufficient: "yes",
      obviousConcern: "no",
      investigateNext10Minutes: "yes",
      confidence: "medium",
      elapsedSeconds: 30,
      note: null,
    },
    marketEvidenceReasons: [],
    humanGateReasons: status === "watch" ? ["top_k_quota_not_allocated"] : [],
    status,
    supportingEvidence: ["market evidence"],
    counterEvidence: [],
    missingEvidence: [],
    nextValidationPlan: ["next evidence"],
    killCriteria: ["stop condition"],
  };
}

function screeningRun(): NoviceMarketScreeningRun {
  const items = [
    ...Array.from({ length: 5 }, (_, index) => screeningItem(index + 1, "advance")),
    ...Array.from({ length: 11 }, (_, index) => screeningItem(index + 6, "watch")),
    ...Array.from({ length: 3 }, (_, index) => screeningItem(index + 17, "reject")),
    screeningItem(20, "insufficient"),
  ];
  const body = {
    schemaVersion: "novice-market-screening-run.v1" as const,
    displayName: "调查短名单预览" as const,
    status: "completed" as const,
    advanceMeaning: "top_k_investigation_quota_not_quality_or_commercial_approval" as const,
    selectionMechanism: "deterministic_top_k_quota" as const,
    rankingRunId: "ranking-01",
    rankingRuleVersion: "stage1-deterministic-v1.1",
    briefId: "brief-01",
    collectionRunId: "collection-01",
    sourceBatchId: "source-batch-01",
    inputHash: "input-hash-01",
    createdAt: "2026-07-15T12:00:00.000Z",
    configuration: { advanceFloor: 3 as const, advanceLimit: 5 as const },
    summary: { advance: 5, watch: 11, reject: 3, insufficient: 1 },
    items,
    formalCandidateGenerated: false as const,
    productionDatabaseWritten: false as const,
    externalAiApiCalled: false as const,
  };
  return { ...body, screeningHash: stableHash(body) };
}

function completedResponse(
  expectedIds: readonly string[],
  overrides: Partial<Stage15NoviceUsabilityResponse> = {},
): Stage15NoviceUsabilityResponse {
  return {
    schemaVersion: "stage15-novice-usability-response.v1",
    selectedBlindItemIds: [...expectedIds],
    itemExplanations: expectedIds.map((blindItemId) => ({
      blindItemId,
      mainReason: "这是调查名额，现有市场证据支持继续了解。",
      nextValidation: "继续核对新的独立商品事实。",
      killCriterion: "关键证据无法确认时停止。",
    })),
    advanceMeaningAnswer: "investigation_quota_only",
    canDistinguishFourStatuses: "yes",
    elapsedSeconds: 420,
    interruptionOccurred: "no",
    note: null,
    ...overrides,
  };
}

describe("Stage 1.5 novice usability acceptance", () => {
  it("builds a hash-bound protocol and a blank worksheet that does not reveal expected answers", () => {
    const materials = buildStage15NoviceUsabilityMaterials(screeningRun(), "2026-07-15T13:00:00.000Z");
    const worksheetJson = JSON.stringify(materials.worksheet);

    expect(materials.protocol.expectedAdvanceCount).toBe(5);
    expect(materials.protocol.expectedAdvanceBlindItemIds).toEqual([
      "blind-01", "blind-02", "blind-03", "blind-04", "blind-05",
    ]);
    expect(materials.worksheet.response.selectedBlindItemIds).toEqual([]);
    expect(materials.worksheet.response.advanceMeaningAnswer).toBe("missing");
    expect(worksheetJson).not.toContain("expectedAdvanceBlindItemIds");
    expect(worksheetJson).not.toContain("blind-01");
    expect(materials.resultTemplate.status).toBe("pending_user_input");
  });

  it("accepts a complete correct novice response without claiming time saving or screening effectiveness", () => {
    const materials = buildStage15NoviceUsabilityMaterials(screeningRun(), "2026-07-15T13:00:00.000Z");
    const response = completedResponse(materials.protocol.expectedAdvanceBlindItemIds);
    const result = evaluateStage15NoviceUsability(materials.protocol, materials.worksheet, response);

    expect(result.status).toBe("passed");
    expect(result.metrics).toMatchObject({
      identifiedAdvanceCount: 5,
      falseSelectionCount: 0,
      missingAdvanceCount: 0,
      explanationCompleteCount: 5,
      boundaryUnderstood: true,
      fourStatusesUnderstood: true,
      elapsedSeconds: 420,
    });
    expect(result.usabilityConclusion).toBe("novice_comprehension_and_operability_observed");
    expect(result.timeSavingConclusion).toBe("not_validated_without_comparable_baseline");
    expect(result.effectivenessConclusion).toBe("screening_effectiveness_not_validated");
  });

  it("returns needs_revision for a complete but wrong shortlist or commercial misunderstanding", () => {
    const materials = buildStage15NoviceUsabilityMaterials(screeningRun(), "2026-07-15T13:00:00.000Z");
    const wrongSelection = [
      ...materials.protocol.expectedAdvanceBlindItemIds.slice(0, 4),
      "blind-06",
    ];
    const response = completedResponse(wrongSelection, {
      advanceMeaningAnswer: "profitability_proven",
      canDistinguishFourStatuses: "no",
    });
    const result = evaluateStage15NoviceUsability(materials.protocol, materials.worksheet, response);

    expect(result.status).toBe("needs_revision");
    expect(result.metrics).toMatchObject({
      identifiedAdvanceCount: 4,
      falseSelectionCount: 1,
      missingAdvanceCount: 1,
      boundaryUnderstood: false,
      fourStatusesUnderstood: false,
    });
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      "shortlist_identification_incorrect",
      "advance_boundary_misunderstood",
      "four_statuses_not_understood",
    ]));
  });

  it("keeps missing manual input pending and never auto-fills a user result", () => {
    const materials = buildStage15NoviceUsabilityMaterials(screeningRun(), "2026-07-15T13:00:00.000Z");
    const result = evaluateStage15NoviceUsability(
      materials.protocol,
      materials.worksheet,
      materials.worksheet.response,
    );

    expect(result.status).toBe("pending_user_input");
    expect(result.metrics.elapsedSeconds).toBeNull();
    expect(result.usabilityConclusion).toBe("novice_usability_not_executed");
    expect(result.manualUserInputObserved).toBe(false);
  });

  it("fails closed on source tampering, duplicate IDs, unknown IDs and malformed explanations", () => {
    const materials = buildStage15NoviceUsabilityMaterials(screeningRun(), "2026-07-15T13:00:00.000Z");
    expect(() => evaluateStage15NoviceUsability(
      { ...materials.protocol, protocolHash: "tampered" },
      materials.worksheet,
      completedResponse(materials.protocol.expectedAdvanceBlindItemIds),
    )).toThrow("STAGE15_USABILITY_PROTOCOL_HASH_INVALID");

    const duplicate = completedResponse(["blind-01", "blind-01", "blind-02", "blind-03", "blind-04"]);
    expect(() => evaluateStage15NoviceUsability(materials.protocol, materials.worksheet, duplicate))
      .toThrow("STAGE15_USABILITY_SELECTED_IDS_INVALID");

    const unknown = completedResponse(["blind-01", "blind-02", "blind-03", "blind-04", "blind-99"]);
    expect(() => evaluateStage15NoviceUsability(materials.protocol, materials.worksheet, unknown))
      .toThrow("STAGE15_USABILITY_SELECTED_IDS_INVALID");

    const malformed = completedResponse(materials.protocol.expectedAdvanceBlindItemIds);
    malformed.itemExplanations[0].nextValidation = "   ";
    expect(() => evaluateStage15NoviceUsability(materials.protocol, materials.worksheet, malformed))
      .toThrow("STAGE15_USABILITY_EXPLANATION_INVALID");
  });

  it("changes hashes when a critical task definition changes and ignores no Stage 2 input", () => {
    const first = buildStage15NoviceUsabilityMaterials(screeningRun(), "2026-07-15T13:00:00.000Z");
    const changedRun = screeningRun();
    changedRun.items[0].status = "watch";
    changedRun.items[5].status = "advance";
    const { screeningHash: _hash, ...changedBody } = changedRun;
    changedRun.screeningHash = stableHash(changedBody);
    const second = buildStage15NoviceUsabilityMaterials(changedRun, "2026-07-15T13:00:00.000Z");

    expect(second.protocol.protocolHash).not.toBe(first.protocol.protocolHash);
    expect(second.worksheet.worksheetHash).not.toBe(first.worksheet.worksheetHash);
    expect(first.protocol.stage2FieldsConsumed).toBe(false);
  });
});
