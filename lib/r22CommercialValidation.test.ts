import { describe, expect, it } from "vitest";
import {
  buildR22CommercialSnapshot,
  buildR22PendingCommercialRunSnapshot,
  calculateR22ContributionRange,
  classifyR22CommercialEvidence,
  evaluateR22Stage2Entry,
  prepareR22Stage2Handoff,
  evaluateR22StoredCandidateStage2Gate,
  parseR22CommercialRunSnapshot,
  type R22CommercialEvidenceInput,
} from "./r22CommercialValidation";

function evidenceInput(): R22CommercialEvidenceInput {
  return {
    candidateId: "r2-A-B085Q4WJGS",
    marketDecision: "market_shortlisted",
    explicitHumanReview: false,
    evaluationVariantBound: false,
    candidateBoundSupplierEvidenceCount: 0,
    candidateBoundFeeEvidenceCount: 0,
    packagedDimensionsAndWeightBound: false,
    candidateBoundLogisticsEvidenceCount: 0,
    candidateBoundRiskReviewCount: 0,
    candidateBoundHtsEvidenceCount: 0,
    assumptionOnlyEvidenceCount: 0,
    criticalUnknownCount: 4,
    fatalOrHighRiskCount: 0,
    sourceRefs: [],
  };
}

describe("R2.2 Stage 2 commercial evidence", () => {
  it("treats absent supplier facts as supplier confirmation required, not a Stage 1 failure", () => {
    expect(classifyR22CommercialEvidence(evidenceInput())).toEqual({
      status: "supplier_confirmation_required",
      reasons: [
        "evaluation_variant_not_bound",
        "candidate_supplier_evidence_missing",
        "candidate_fee_evidence_missing",
        "packaged_dimensions_or_weight_missing",
        "candidate_logistics_evidence_missing",
        "candidate_risk_review_missing",
        "candidate_hts_evidence_missing",
        "critical_unknowns_present",
        "candidate_source_refs_missing",
      ],
    });
  });

  it("does not promote category analogs or assumptions into candidate-bound purchase facts", () => {
    const result = classifyR22CommercialEvidence({
      ...evidenceInput(),
      assumptionOnlyEvidenceCount: 3,
      sourceRefs: ["category-analog-1", "common-fee-rule-1"],
    });
    expect(result.status).toBe("commercial_assumption_only");
    expect(result.reasons).toContain("candidate_supplier_evidence_missing");
  });

  it("blocks confirmed fatal or high commercial risk before ready", () => {
    expect(classifyR22CommercialEvidence({
      ...evidenceInput(),
      evaluationVariantBound: true,
      candidateBoundSupplierEvidenceCount: 1,
      candidateBoundFeeEvidenceCount: 1,
      packagedDimensionsAndWeightBound: true,
      candidateBoundLogisticsEvidenceCount: 1,
      candidateBoundRiskReviewCount: 1,
      candidateBoundHtsEvidenceCount: 1,
      criticalUnknownCount: 0,
      fatalOrHighRiskCount: 1,
      sourceRefs: ["supplier-1", "fee-1", "risk-1"],
    }).status).toBe("commercial_blocked_risk");
  });

  it("requires bound variant, candidate supplier and fee evidence, no critical unknowns, and sources for ready", () => {
    const ready = {
      ...evidenceInput(),
      evaluationVariantBound: true,
      candidateBoundSupplierEvidenceCount: 1,
      candidateBoundFeeEvidenceCount: 1,
      packagedDimensionsAndWeightBound: true,
      candidateBoundLogisticsEvidenceCount: 1,
      candidateBoundRiskReviewCount: 1,
      candidateBoundHtsEvidenceCount: 1,
      criticalUnknownCount: 0,
      sourceRefs: ["supplier-1", "fee-1"],
    };
    expect(classifyR22CommercialEvidence(ready)).toEqual({
      status: "commercial_ready_for_decision",
      reasons: [],
    });
  });

  it("keeps each critical commercial binding fail-closed and validates counters", () => {
    const ready: R22CommercialEvidenceInput = {
      ...evidenceInput(),
      evaluationVariantBound: true,
      candidateBoundSupplierEvidenceCount: 1,
      candidateBoundFeeEvidenceCount: 1,
      packagedDimensionsAndWeightBound: true,
      candidateBoundLogisticsEvidenceCount: 1,
      candidateBoundRiskReviewCount: 1,
      candidateBoundHtsEvidenceCount: 1,
      criticalUnknownCount: 0,
      sourceRefs: ["supplier-1", "packaging-1", "logistics-1", "fee-1", "risk-1", "hts-1"],
    };
    const cases: Array<[keyof R22CommercialEvidenceInput, unknown, string]> = [
      ["packagedDimensionsAndWeightBound", false, "packaged_dimensions_or_weight_missing"],
      ["candidateBoundLogisticsEvidenceCount", 0, "candidate_logistics_evidence_missing"],
      ["candidateBoundRiskReviewCount", 0, "candidate_risk_review_missing"],
      ["candidateBoundHtsEvidenceCount", 0, "candidate_hts_evidence_missing"],
      ["candidateBoundSupplierEvidenceCount", -1, "invalid_candidate_supplier_evidence_count"],
      ["assumptionOnlyEvidenceCount", -1, "invalid_assumption_only_evidence_count"],
      ["fatalOrHighRiskCount", -1, "invalid_fatal_or_high_risk_count"],
    ];
    for (const [field, value, reason] of cases) {
      const result = classifyR22CommercialEvidence({ ...ready, [field]: value });
      expect(result.status).toBe("supplier_confirmation_required");
      expect(result.reasons).toContain(reason);
    }
  });

  it("does not let not-started or blank source refs hide a confirmed risk or missing evidence", () => {
    expect(classifyR22CommercialEvidence({
      ...evidenceInput(), collectionStarted: false, fatalOrHighRiskCount: 1,
    }).status).toBe("commercial_blocked_risk");
    const result = classifyR22CommercialEvidence({
      ...evidenceInput(),
      evaluationVariantBound: true,
      candidateBoundSupplierEvidenceCount: 1,
      candidateBoundFeeEvidenceCount: 1,
      packagedDimensionsAndWeightBound: true,
      candidateBoundLogisticsEvidenceCount: 1,
      candidateBoundRiskReviewCount: 1,
      candidateBoundHtsEvidenceCount: 1,
      criticalUnknownCount: 0,
      sourceRefs: ["   "],
    });
    expect(result).toMatchObject({
      status: "supplier_confirmation_required",
      reasons: ["candidate_source_refs_missing"],
    });
  });
});

describe("R2.2 contribution range", () => {
  const scenario = {
    netSalesRevenue: { low: 28, high: 32 },
    unitPurchaseCost: { low: 5, high: 7 },
    domesticFreightPerUnit: { low: 0.4, high: 0.8 },
    packagingLabelInspectionPerUnit: { low: 0.2, high: 0.5 },
    internationalFreightPerUnit: { low: 1, high: 2 },
    tariffAssessmentBasePerUnit: { low: 5, high: 7 },
    tariffRate: { low: 0.05, high: 0.1 },
    customsClearancePerUnit: { low: 0.2, high: 0.5 },
    referralFeePerUnit: { low: 4.2, high: 4.8 },
    fbaFulfillmentFeePerUnit: { low: 4, high: 5 },
    storagePerUnit: { low: 0.1, high: 0.2 },
    otherVariablePlatformFeePerUnit: { low: 0, high: 0.2 },
    advertisingRate: { low: 0.15, high: 0.15 },
    returnRate: { low: 0.08, high: 0.08 },
    returnLossRate: { low: 0.5, high: 0.5 },
  };

  it("returns a reproducible best/worst range rather than a fake precise value", () => {
    const result = calculateR22ContributionRange(scenario);
    expect(result.status).toBe("calculated_range");
    if (result.status !== "calculated_range") return;
    expect(result.bestCase.contributionMarginRate).toBeGreaterThan(result.worstCase.contributionMarginRate);
    expect(result.singlePointEstimate).toBeNull();
    expect(result.formulaVersion).toBe("r22-contribution-range-v1");
  });

  it("keeps the range missing when any critical input is absent", () => {
    expect(calculateR22ContributionRange({ ...scenario, unitPurchaseCost: undefined }).status)
      .toBe("needs_data");
  });

  it("rejects negative money values and rates outside zero-to-one", () => {
    expect(calculateR22ContributionRange({
      ...scenario, unitPurchaseCost: { low: -1, high: 2 },
    })).toEqual({ status: "needs_data", missingFields: ["unitPurchaseCost"] });
    expect(calculateR22ContributionRange({
      ...scenario, tariffRate: { low: 0.1, high: 1.1 },
    })).toEqual({ status: "needs_data", missingFields: ["tariffRate"] });
  });
});

describe("R2.2 Stage 2 entry and shared handoff", () => {
  it("allows shortlisted candidates into evidence work even when supplier confirmation is required", () => {
    expect(evaluateR22Stage2Entry(evidenceInput())).toEqual({ allowed: true, reasons: [] });
  });

  it("allows market watch only after explicit review and fails closed for reject or insufficient data", () => {
    expect(evaluateR22Stage2Entry({ ...evidenceInput(), marketDecision: "market_watch" }).allowed).toBe(false);
    expect(evaluateR22Stage2Entry({
      ...evidenceInput(), marketDecision: "market_watch", explicitHumanReview: true,
    }).allowed).toBe(true);
    expect(evaluateR22Stage2Entry({ ...evidenceInput(), marketDecision: "market_reject" }).allowed).toBe(false);
    expect(evaluateR22Stage2Entry({
      ...evidenceInput(), marketDecision: "insufficient_market_data",
    }).allowed).toBe(false);
  });

  it("uses one decision gate for Owner and Visitor while storage remains an adapter concern", () => {
    const owner = prepareR22Stage2Handoff(evidenceInput(), "owner", "2026-07-13T00:00:00.000Z");
    const visitor = prepareR22Stage2Handoff(evidenceInput(), "visitor", "2026-07-13T00:00:00.000Z");
    expect(owner.allowed).toBe(visitor.allowed);
    expect(owner.snapshot.stage2Entry).toEqual(visitor.snapshot.stage2Entry);
    expect(owner.storageTarget).toBe("owner_repository");
    expect(visitor.storageTarget).toBe("visitor_sandbox");
  });

  it("builds a versioned append-only snapshot with source and decision bindings", () => {
    const snapshot = buildR22CommercialSnapshot(evidenceInput(), "2026-07-13T00:00:00.000Z");
    expect(snapshot.version).toBe("r22-commercial-evidence-v1");
    expect(snapshot.appendOnly).toBe(true);
    expect(snapshot.marketDecision).toBe("market_shortlisted");
    expect(snapshot.commercialEvidence.status).toBe("supplier_confirmation_required");
  });

  it("binds a real Stage 2 run while preserving not-evaluated commercial semantics", () => {
    const market = {
      schemaVersion: "r22-market-decision-v1" as const,
      evidenceVersion: "r22-evidence-semantics-v1" as const,
      candidateId: "candidate-1",
      asin: "B000000001",
      briefId: "A" as const,
      frozenRank: 1,
      marketDecision: "market_shortlisted" as const,
      decisionReasons: ["fixture"],
      supportingEvidenceRefs: ["fixture:market"],
      opposingEvidenceRefs: [],
      marketMissingFields: [],
      dataCompleteness: 1,
      confidence: "high" as const,
      stabilityStatus: "stable" as const,
      ruleVersion: "r22-stage1-market-v1" as const,
      inputHash: "a".repeat(64),
      createdAt: "2026-07-13T00:00:00.000Z",
    };
    const snapshot = buildR22PendingCommercialRunSnapshot(
      market, "wf-real-stage2-1", "2026-07-13T00:01:00.000Z",
    );
    expect(snapshot).toMatchObject({
      schemaVersion: "r22-commercial-run-v1",
      runId: "wf-real-stage2-1",
      commercialEvidenceStatus: "supplier_confirmation_required",
      commercialDecision: "not_evaluated",
      profitScenario: null,
      ruleVersion: "r22-stage1-market-v1",
    });
    expect(parseR22CommercialRunSnapshot(snapshot)).toEqual(snapshot);
    expect(parseR22CommercialRunSnapshot({ ...snapshot, runId: "stage2-pending-candidate-1" }))
      .toBeNull();
  });

  it("enforces stored R2.2 authority while leaving legacy candidates backward compatible", () => {
    expect(evaluateR22StoredCandidateStage2Gate({ candidateId: "legacy", analysisJson: "{}" }))
      .toEqual({ applies: false, allowed: true, reasons: [] });
    expect(evaluateR22StoredCandidateStage2Gate({ candidateId: "broken", analysisJson: "{" }))
      .toEqual({ applies: true, allowed: false, reasons: ["invalid_analysis_json"] });
    const snapshot = {
      schemaVersion: "r22-market-decision-v1",
      evidenceVersion: "r22-evidence-semantics-v1",
      candidateId: "candidate-1",
      asin: "B000000001",
      briefId: "A",
      frozenRank: 1,
      marketDecision: "market_reject",
      decisionReasons: ["confirmed_fatal_market_or_platform_risk"],
      supportingEvidenceRefs: ["fixture:risk"],
      opposingEvidenceRefs: [],
      marketMissingFields: [],
      dataCompleteness: 1,
      confidence: "high",
      stabilityStatus: "stable",
      ruleVersion: "r22-stage1-market-v1",
      inputHash: "a".repeat(64),
      createdAt: "2026-07-13T00:00:00.000Z",
    };
    expect(evaluateR22StoredCandidateStage2Gate({
      candidateId: "candidate-1",
      analysisJson: JSON.stringify({ r22MarketDecision: snapshot }),
    })).toEqual({ applies: true, allowed: false, reasons: ["market_rejected"] });

    expect(evaluateR22StoredCandidateStage2Gate({
      candidateId: "candidate-1",
      analysisJson: JSON.stringify({ r22MarketDecision: { ...snapshot, ruleVersion: "old" } }),
    })).toEqual({ applies: true, allowed: false, reasons: ["invalid_market_snapshot"] });
  });

  it("allows a watch candidate only with a server-stored, matching human review", () => {
    const snapshot = {
      schemaVersion: "r22-market-decision-v1",
      evidenceVersion: "r22-evidence-semantics-v1",
      candidateId: "candidate-1",
      asin: "B000000001",
      briefId: "A",
      frozenRank: 1,
      marketDecision: "market_watch",
      decisionReasons: ["complete_but_below_shortlist"],
      supportingEvidenceRefs: ["fixture:market"],
      opposingEvidenceRefs: [],
      marketMissingFields: [],
      dataCompleteness: 1,
      confidence: "medium",
      stabilityStatus: "stable",
      ruleVersion: "r22-stage1-market-v1",
      inputHash: "a".repeat(64),
      createdAt: "2026-07-13T00:00:00.000Z",
    };
    const analysis = {
      r22MarketDecision: snapshot,
      r22MarketWatchReview: {
        schemaVersion: "r22-market-watch-review-v1",
        reviewId: "review-1",
        candidateId: "candidate-1",
        stage1InputHash: "a".repeat(64),
        reviewerType: "human",
        approved: true,
        reviewedAt: "2026-07-13T00:01:00.000Z",
      },
    };
    expect(evaluateR22StoredCandidateStage2Gate({
      candidateId: "candidate-1", analysisJson: JSON.stringify(analysis),
    })).toEqual({ applies: true, allowed: true, reasons: [] });
    expect(evaluateR22StoredCandidateStage2Gate({
      candidateId: "candidate-1",
      analysisJson: JSON.stringify({
        ...analysis,
        r22MarketWatchReview: { ...analysis.r22MarketWatchReview, stage1InputHash: "b".repeat(64) },
      }),
    })).toEqual({ applies: true, allowed: false, reasons: ["market_watch_review_required"] });
  });
});
