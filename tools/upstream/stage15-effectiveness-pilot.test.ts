import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type { NoviceMarketScreeningItem, NoviceMarketScreeningRun } from "./novice-market-screening";
import {
  buildStage15EffectivenessPilotResult,
  buildStage15EffectivenessRevalidationBrief,
  buildStage15EffectivenessPilot,
  type Stage15PilotItemResponse,
  type Stage15PilotVisualPacket,
} from "./stage15-effectiveness-pilot";

function item(
  index: number,
  status: NoviceMarketScreeningItem["status"],
  humanGateReasons: string[] = [],
): NoviceMarketScreeningItem {
  const asin = `B${String(index).padStart(9, "0")}`;
  return {
    schemaVersion: "novice-market-screening-item.v1",
    candidateId: `candidate-${index}`,
    productKey: `amazon:US:${asin}`,
    stage1Rank: index,
    stage1PromotionDecision: status === "reject" ? "rejected" : status === "insufficient"
      ? "insufficient_evidence"
      : "promoted",
    screeningEvidenceSufficient: status !== "insufficient",
    userUnderstandsProduct: !humanGateReasons.some((reason) => reason.startsWith("product_understood_")),
    willingToContinueResearch: !humanGateReasons.some((reason) => reason.startsWith("continue_research_")),
    rawHumanAnswer: {
      blindItemId: `blind-${String(index).padStart(2, "0")}`,
      productUnderstood: "yes",
      evidenceSufficient: "yes",
      obviousConcern: "no",
      investigateNext10Minutes: "yes",
      confidence: "medium",
      elapsedSeconds: 30,
      note: null,
    },
    marketEvidenceReasons: [],
    humanGateReasons,
    status,
    supportingEvidence: ["locked market evidence"],
    counterEvidence: [],
    missingEvidence: [...humanGateReasons],
    nextValidationPlan: ["continue"],
    killCriteria: ["stop"],
  };
}

function run(): NoviceMarketScreeningRun {
  const items = [
    ...Array.from({ length: 5 }, (_, index) => item(index + 1, "advance")),
    ...Array.from({ length: 7 }, (_, index) => item(index + 6, "watch", ["top_k_quota_not_allocated"])),
    item(13, "watch", ["product_understood_no"]),
    item(14, "watch", ["continue_research_uncertain"]),
    item(15, "reject"),
    item(16, "reject"),
    item(17, "reject"),
    item(18, "insufficient"),
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
    sourceBatchId: "batch-01",
    inputHash: "screening-input-hash",
    createdAt: "2026-07-15T12:00:00.000Z",
    configuration: { advanceFloor: 3 as const, advanceLimit: 5 as const },
    summary: { advance: 5, watch: 9, reject: 3, insufficient: 1 },
    items,
    formalCandidateGenerated: false as const,
    productionDatabaseWritten: false as const,
    externalAiApiCalled: false as const,
  };
  return { ...body, screeningHash: stableHash(body) };
}

function visualPacket(screeningRun: NoviceMarketScreeningRun): Stage15PilotVisualPacket {
  const body = {
    schemaVersion: "solo-novice-visual-blind-review-packet.v2" as const,
    sourceBlindReviewId: "blind-review-01",
    sourceEvidenceHash: "visual-source-hash",
    items: screeningRun.items.map((screeningItem) => ({
      blindItemId: screeningItem.rawHumanAnswer.blindItemId!,
      title: `Title ${screeningItem.productKey}`,
      sourceUrl: `https://www.amazon.com/dp/${screeningItem.productKey.split(":").at(-1)}`,
      capturedAt: "2026-07-14T10:31:54.838Z",
      image: {
        imageUrl: null,
        sourceType: "direct_observation" as const,
        capturedAt: "2026-07-14T10:31:54.838Z",
        missingReason: "not_cached_offline_no_external_access",
      },
      chinesePresentation: {
        productTypeZh: "中文类型",
        primaryUseZh: "中文用途",
        sourceType: "ai_generated" as const,
        status: "presentation_aid_not_source_fact" as const,
        basedOnFields: ["title"],
      },
    })),
  };
  return { ...body, packetHash: stableHash(body) };
}

describe("Stage 1.5 effectiveness pilot protocol", () => {
  it("selects five advance and five deterministic controls only from comparable quota-overflow watch items", () => {
    const source = run();
    const result = buildStage15EffectivenessPilot({
      screeningRun: source,
      visualPacket: visualPacket(source),
      createdAt: "2026-07-15T13:00:00.000Z",
    });

    expect(result.protocol.sampleSummary).toEqual({
      advanceCount: 5,
      comparableControlPoolCount: 7,
      selectedControlCount: 5,
      blindedItemCount: 10,
    });
    expect(result.protocol.assignments.filter((entry) => entry.group === "advance")).toHaveLength(5);
    expect(result.protocol.assignments.filter((entry) => entry.group === "control")).toHaveLength(5);
    expect(result.protocol.assignments.filter((entry) => entry.group === "control").every((entry) => {
      const sourceItem = source.items.find((candidate) => candidate.productKey === entry.productKey)!;
      return sourceItem.status === "watch"
        && sourceItem.humanGateReasons.length === 1
        && sourceItem.humanGateReasons[0] === "top_k_quota_not_allocated";
    })).toBe(true);
    expect(result.protocol.assignments.some((entry) => entry.productKey === "amazon:US:B000000013")).toBe(false);
  });

  it("is deterministic across source item order and binds critical protocol fields into hashes", () => {
    const source = run();
    const visual = visualPacket(source);
    const first = buildStage15EffectivenessPilot({ screeningRun: source, visualPacket: visual, createdAt: "2026-07-15T13:00:00.000Z" });
    const reordered = { ...source, items: [...source.items].reverse() };
    const { screeningHash: _oldHash, ...reorderedBody } = reordered;
    reordered.screeningHash = stableHash(reorderedBody);
    const second = buildStage15EffectivenessPilot({
      screeningRun: reordered,
      visualPacket: visual,
      createdAt: "2026-07-15T13:00:00.000Z",
    });

    expect(second.protocol.assignments).toEqual(first.protocol.assignments);
    expect(second.blindPacket.items).toEqual(first.blindPacket.items);
    expect(second.protocol.protocolHash).not.toBe(first.protocol.protocolHash);
    const modified = structuredClone(first.protocol) as unknown as {
      protocolHash: string;
      evidencePolicy: { prohibitedInputs: string[] };
      [key: string]: unknown;
    };
    modified.evidencePolicy.prohibitedInputs.push("changed-critical-field");
    const { protocolHash: _hash, ...modifiedBody } = modified;
    expect(stableHash(modifiedBody)).not.toBe(first.protocol.protocolHash);
  });

  it("keeps group, Stage 1 rank, score, market metrics and human answers out of the blind packet", () => {
    const source = run();
    const result = buildStage15EffectivenessPilot({
      screeningRun: source,
      visualPacket: visualPacket(source),
      createdAt: "2026-07-15T13:00:00.000Z",
    });
    const serialized = JSON.stringify(result.blindPacket);

    expect(result.blindPacket.items).toHaveLength(10);
    expect(serialized).not.toContain('"group"');
    expect(serialized).not.toContain('"stage1Rank"');
    expect(serialized).not.toContain('"totalScore"');
    expect(serialized).not.toContain('"price"');
    expect(serialized).not.toContain('"rating"');
    expect(serialized).not.toContain('"reviewCount"');
    expect(serialized).not.toContain('"rawHumanAnswer"');
    expect(result.resultTemplate.items.every((entry) => entry.outcome === "missing")).toBe(true);
    expect(result.resultTemplate.effectivenessConclusion).toBe("screening_effectiveness_not_validated");
  });

  it("fails closed when source hashes, sample counts or visual bindings are invalid", () => {
    const source = run();
    const visual = visualPacket(source);
    expect(() => buildStage15EffectivenessPilot({
      screeningRun: { ...source, screeningHash: "tampered" },
      visualPacket: visual,
      createdAt: "2026-07-15T13:00:00.000Z",
    })).toThrow("STAGE15_PILOT_SOURCE_SCREENING_HASH_INVALID");

    const tooFewControls = run();
    tooFewControls.items = tooFewControls.items.filter((entry) => ![
      "amazon:US:B000000010",
      "amazon:US:B000000011",
      "amazon:US:B000000012",
    ].includes(entry.productKey));
    const { screeningHash: _hash, ...tooFewBody } = tooFewControls;
    tooFewControls.screeningHash = stableHash(tooFewBody);
    expect(() => buildStage15EffectivenessPilot({
      screeningRun: tooFewControls,
      visualPacket: visualPacket(tooFewControls),
      createdAt: "2026-07-15T13:00:00.000Z",
    })).toThrow("STAGE15_PILOT_CONTROL_POOL_INSUFFICIENT");

    const brokenVisual = visualPacket(source);
    brokenVisual.items[0].blindItemId = "wrong";
    const { packetHash: _packetHash, ...brokenVisualBody } = brokenVisual;
    brokenVisual.packetHash = stableHash(brokenVisualBody);
    expect(() => buildStage15EffectivenessPilot({
      screeningRun: source,
      visualPacket: brokenVisual,
      createdAt: "2026-07-15T13:00:00.000Z",
    })).toThrow("STAGE15_PILOT_VISUAL_BINDING_INVALID");
  });

  it("defines pilot completion without claiming effectiveness or consuming Stage 2", () => {
    const source = run();
    const result = buildStage15EffectivenessPilot({
      screeningRun: source,
      visualPacket: visualPacket(source),
      createdAt: "2026-07-15T13:00:00.000Z",
    });

    expect(result.protocol.pilotAcceptance).toMatchObject({
      completedMeaning: "effectiveness_pilot_completed_not_screening_effectiveness_validated",
      requiredResolvedItems: 10,
      directionalThresholds: null,
    });
    expect(result.protocol.evidencePolicy.prohibitedInputs).toEqual(expect.arrayContaining([
      "stage1_rank_or_score",
      "locked_human_answers",
      "stage2_cost_profit_or_supplier_fields",
    ]));
    expect(result.resultTemplate.stage2FieldsConsumed).toBe(false);
    expect(result.resultTemplate.formalCandidateGenerated).toBe(false);
    expect(result.resultTemplate.productionDatabaseWritten).toBe(false);
  });

  it("validates completed responses and computes descriptive metrics without upgrading effectiveness", () => {
    const source = run();
    const built = buildStage15EffectivenessPilot({
      screeningRun: source,
      visualPacket: visualPacket(source),
      createdAt: "2026-07-15T13:00:00.000Z",
    });
    let advanceSeen = 0;
    let controlSeen = 0;
    const responses = built.protocol.assignments.map((assignment) => {
      const groupIndex = assignment.group === "advance" ? advanceSeen++ : controlSeen++;
      const shouldContinue = assignment.group === "advance" ? groupIndex < 4 : groupIndex < 2;
      return {
        pilotItemId: assignment.pilotItemId,
        checklist: built.protocol.evidencePolicy.requiredChecklist.map((checkId) => ({
          checkId,
          status: "confirmed" as const,
          evidenceRefs: [`evidence:${assignment.pilotItemId}:${checkId}`],
          missingReason: null,
        })),
        outcome: shouldContinue ? "continue_after_revalidation" as const : "stop_after_revalidation" as const,
        evidenceRefs: [`evidence:${assignment.pilotItemId}`],
        reasonCodes: [shouldContinue ? "independent_evidence_supports_continue" : "independent_evidence_supports_stop"],
      };
    });

    const result = buildStage15EffectivenessPilotResult(built.protocol, built.blindPacket, responses);

    expect(result.status).toBe("completed");
    expect(result.metrics).toEqual({
      advanceContinueRate: 0.8,
      controlContinueRate: 0.4,
      missedControlCount: 2,
      investigationScopeReduction: 0.75,
      evidenceResolutionRate: 1,
    });
    expect(result.pilotConclusion).toBe("effectiveness_pilot_completed");
    expect(result.effectivenessConclusion).toBe("screening_effectiveness_not_validated");
    expect(result.directionalSignal).toBe("descriptive_only_no_approved_thresholds");
  });

  it("keeps incomplete responses pending and rejects untraceable or malformed completed outcomes", () => {
    const source = run();
    const built = buildStage15EffectivenessPilot({
      screeningRun: source,
      visualPacket: visualPacket(source),
      createdAt: "2026-07-15T13:00:00.000Z",
    });
    const pending = buildStage15EffectivenessPilotResult(
      built.protocol,
      built.blindPacket,
      built.resultTemplate.items,
    );
    expect(pending).toMatchObject({
      status: "pending_evidence",
      metrics: {
        advanceContinueRate: null,
        controlContinueRate: null,
        missedControlCount: null,
        evidenceResolutionRate: null,
      },
      pilotConclusion: "effectiveness_pilot_not_started",
    });

    const invalid = structuredClone(built.resultTemplate.items) as unknown as Stage15PilotItemResponse[];
    invalid[0].outcome = "continue_after_revalidation";
    expect(() => buildStage15EffectivenessPilotResult(built.protocol, built.blindPacket, invalid))
      .toThrow("STAGE15_PILOT_COMPLETED_OUTCOME_EVIDENCE_INVALID");

    const duplicate = [...built.resultTemplate.items, built.resultTemplate.items[0]];
    expect(() => buildStage15EffectivenessPilotResult(built.protocol, built.blindPacket, duplicate))
      .toThrow("STAGE15_PILOT_RESULT_PARTITION_INVALID");
  });

  it("builds a pending authorization brief with ten bound Amazon paths and zero retries", () => {
    const source = run();
    const built = buildStage15EffectivenessPilot({
      screeningRun: source,
      visualPacket: visualPacket(source),
      createdAt: "2026-07-15T13:00:00.000Z",
    });
    const brief = buildStage15EffectivenessRevalidationBrief(
      built.protocol,
      built.blindPacket,
      "2026-07-15T14:00:00.000Z",
    );

    expect(brief.status).toBe("pending_user_authorization");
    expect(brief.accessBudget).toEqual({
      runs: 1,
      initialPages: 1,
      productDetailNavigations: 10,
      searchNavigations: 0,
      retries: 0,
    });
    expect(brief.targets).toHaveLength(10);
    expect(new Set(brief.targets.map((target) => target.safePath)).size).toBe(10);
    expect(brief.targets.every((target) => target.origin === "https://www.amazon.com")).toBe(true);
    expect(brief.targets.every((target) => /^\/dp\/[A-Z0-9]{10}$/.test(target.safePath))).toBe(true);
    expect(brief.userAuthorization).toBeNull();
    expect(brief.externalWebsiteAccessed).toBe(false);
    expect(brief.stage2FieldsConsumed).toBe(false);
  });

  it("fails closed when revalidation targets leave the fixed public Amazon scope", () => {
    const source = run();
    const built = buildStage15EffectivenessPilot({
      screeningRun: source,
      visualPacket: visualPacket(source),
      createdAt: "2026-07-15T13:00:00.000Z",
    });
    const alteredPacket = structuredClone(built.blindPacket);
    alteredPacket.items[0].sourceUrl = "https://example.com/dp/ASIN000001";
    const { packetHash: _hash, ...alteredBody } = alteredPacket;
    alteredPacket.packetHash = stableHash(alteredBody);

    expect(() => buildStage15EffectivenessRevalidationBrief(
      built.protocol,
      alteredPacket,
      "2026-07-15T14:00:00.000Z",
    )).toThrow("STAGE15_REVALIDATION_TARGET_URL_INVALID");
    expect(() => buildStage15EffectivenessRevalidationBrief(
      { ...built.protocol, protocolHash: "tampered" },
      built.blindPacket,
      "2026-07-15T14:00:00.000Z",
    )).toThrow("STAGE15_REVALIDATION_PROTOCOL_HASH_INVALID");
  });
});
