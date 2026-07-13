import { describe, expect, it } from "vitest";
import {
  adaptR21CommercialHistory,
  classifyR22Evidence,
  evaluateR22MarketDecision,
  parseR22MarketDecisionFromAnalysisJson,
  parseR22MarketDecisionSnapshot,
  type R22MarketDecisionInput,
  type R22MarketRule,
} from "./r22DecisionModel";

const rule: R22MarketRule = {
  ruleVersion: "r22-stage1-market-v1",
  minimumEvidenceCoverage: 100,
  stabilityByBrief: { A: "stable", B: "unstable" },
  reject: {
    stage1ScoreLt: 50,
    customerProofLt: 20,
    visibleOfferSignalLte: 25,
  },
  shortlist: {
    stage1ScoreGte: 70,
    searchFootprintGte: 65,
    customerProofGte: 45,
    visibleOfferSignalGte: 50,
  },
};

function completeInput(): R22MarketDecisionInput {
  return {
    candidateId: "r2-A-B085Q4WJGS",
    asin: "B085Q4WJGS",
    briefId: "A",
    frozenRank: 1,
    title: "Cabinet organizer shelf",
    url: "https://www.amazon.com/dp/B085Q4WJGS",
    priceUsd: 29.99,
    identityAndSourceMapped: true,
    identityConflicts: [],
    candidateBoundSourceRefs: ["stage1-feature-table:B085Q4WJGS"],
    dimensionStatus: {
      searchFootprint: "valid",
      customerProof: "valid",
      visibleOfferSignal: "valid",
    },
    evidenceCoverage: 100,
    stage1Score: 75,
    searchFootprint: 80,
    customerProof: 60,
    visibleOfferSignal: 75,
    confirmedFatalRisk: false,
    stabilityStatus: "stable",
    inputHash: "a".repeat(64),
    createdAt: "2026-07-13T01:00:00.000Z",
  };
}

describe("R2.2 decision model", () => {
  it("keeps R2.1 needs_data in its original commercial meaning", () => {
    const historical = adaptR21CommercialHistory({
      schemaVersion: "r21-objective-evidence-card-v1",
      commercialClassification: "needs_data",
      r21ValidationConclusion: "blocked",
    });

    expect(historical.schemaVersion).toBe("r21-readonly-compat-v1");
    expect(historical.originalCommercialClassification).toBe("needs_data");
    expect(historical.marketDecision).toBeNull();
    expect(historical.readOnly).toBe(true);
  });

  it("does not count common rules or inference as candidate market evidence", () => {
    const common = classifyR22Evidence({
      bindingLevel: "common_rule_reference",
      informationStatus: "confirmed_fact",
      sourceRef: "amazon-fee-rule",
      limitation: null,
    });
    const inference = classifyR22Evidence({
      bindingLevel: "candidate_bound",
      informationStatus: "inference",
      sourceRef: "ai-summary",
      limitation: null,
    });

    expect(common.countsTowardCandidateMarketEvidence).toBe(false);
    expect(common.issue).toBe("unbound");
    expect(inference.countsTowardCandidateMarketEvidence).toBe(false);
  });

  it("keeps limitation, conflict and unbound separate", () => {
    expect(classifyR22Evidence({
      bindingLevel: "candidate_bound",
      informationStatus: "confirmed_fact",
      sourceRef: "product-page",
      limitation: "item weight is not packaged weight",
    }).issue).toBe("limitation");
    expect(classifyR22Evidence({
      bindingLevel: "candidate_bound",
      informationStatus: "conflicting",
      sourceRef: "two-product-pages",
      limitation: null,
    }).issue).toBe("conflict");
    expect(classifyR22Evidence({
      bindingLevel: "category_analog",
      informationStatus: "estimated",
      sourceRef: "supplier-landscape",
      limitation: null,
    }).issue).toBe("unbound");
  });

  it("returns insufficient when a required market field is missing instead of using zero", () => {
    const result = evaluateR22MarketDecision({
      ...completeInput(),
      dimensionStatus: { ...completeInput().dimensionStatus, customerProof: "unknown" },
      customerProof: null,
    }, rule);

    expect(result.marketDecision).toBe("insufficient_market_data");
    expect(result.marketMissingFields).toContain("customerProof");
    expect(result.dataCompleteness).toBeLessThan(1);
  });

  it("does not use frozen Top or Control identity to grant shortlist", () => {
    const weak = { ...completeInput(), stage1Score: 60, customerProof: 35 };
    const top = evaluateR22MarketDecision({ ...weak, frozenGroup: "top" }, rule);
    const control = evaluateR22MarketDecision({ ...weak, frozenGroup: "control" }, rule);

    expect(top.marketDecision).toBe("market_watch");
    expect(control.marketDecision).toBe("market_watch");
    expect(top.decisionReasons).toEqual(control.decisionReasons);
  });

  it("shortlists only when every frozen market threshold is met", () => {
    expect(evaluateR22MarketDecision(completeInput(), rule).marketDecision).toBe("market_shortlisted");
    expect(evaluateR22MarketDecision({ ...completeInput(), visibleOfferSignal: 49 }, rule).marketDecision).toBe("market_watch");
  });

  it("rejects confirmed fatal risk or consistent weak market evidence", () => {
    expect(evaluateR22MarketDecision({ ...completeInput(), confirmedFatalRisk: true }, rule).marketDecision).toBe("market_reject");
    expect(evaluateR22MarketDecision({
      ...completeInput(),
      stage1Score: 49,
      customerProof: 19,
      visibleOfferSignal: 25,
    }, rule).marketDecision).toBe("market_reject");
  });

  it.each([
    ["complete but consistently weak", {
      stage1Score: 49, searchFootprint: 30, customerProof: 19, visibleOfferSignal: 25,
      confirmedFatalRisk: false, candidateBoundSourceRefs: ["fixture:consistent-weak"],
    }],
    ["high-feedback brand concentration with confirmed fatal IP risk", {
      stage1Score: 95, searchFootprint: 95, customerProof: 95, visibleOfferSignal: 95,
      confirmedFatalRisk: true, candidateBoundSourceRefs: ["fixture:fatal-brand-ip-risk"],
    }],
    ["data-rich candidate with confirmed fatal platform restriction", {
      stage1Score: 90, searchFootprint: 90, customerProof: 80, visibleOfferSignal: 80,
      confirmedFatalRisk: true, candidateBoundSourceRefs: ["fixture:fatal-platform-restriction"],
    }],
  ])("keeps market_reject reachable for %s", (_name, patch) => {
    expect(evaluateR22MarketDecision({ ...completeInput(), ...patch }, rule).marketDecision)
      .toBe("market_reject");
  });

  it("records distinct confirmed fatal risk reasons without changing reject thresholds", () => {
    const brandRisk = evaluateR22MarketDecision({
      ...completeInput(), confirmedFatalRisk: true, confirmedFatalRiskCode: "brand_or_ip",
    } as R22MarketDecisionInput, rule);
    const platformRisk = evaluateR22MarketDecision({
      ...completeInput(), confirmedFatalRisk: true, confirmedFatalRiskCode: "platform_restriction",
    } as R22MarketDecisionInput, rule);
    expect(brandRisk.decisionReasons).toEqual(["confirmed_fatal_market_or_platform_risk:brand_or_ip"]);
    expect(platformRisk.decisionReasons).toEqual(["confirmed_fatal_market_or_platform_risk:platform_restriction"]);
  });

  it("derives Brief stability from the frozen rule instead of trusting the caller", () => {
    const briefA = evaluateR22MarketDecision({ ...completeInput(), stabilityStatus: "unstable" }, rule);
    const briefB = evaluateR22MarketDecision({
      ...completeInput(), briefId: "B", stabilityStatus: "stable",
    }, rule);
    expect(briefA.stabilityStatus).toBe("stable");
    expect(briefB.stabilityStatus).toBe("unstable");
  });

  it("requires exact 100 coverage and at least one non-blank candidate-bound source", () => {
    const excessiveCoverage = evaluateR22MarketDecision({
      ...completeInput(), evidenceCoverage: 101,
    }, rule);
    const blankSource = evaluateR22MarketDecision({
      ...completeInput(), candidateBoundSourceRefs: ["   "],
    }, rule);
    expect(excessiveCoverage.marketDecision).toBe("insufficient_market_data");
    expect(excessiveCoverage.marketMissingFields).toContain("evidenceCoverage");
    expect(blankSource.marketDecision).toBe("insufficient_market_data");
    expect(blankSource.marketMissingFields).toContain("candidateBoundSourceRefs");
  });

  it("replays identical inputs deterministically", () => {
    expect(evaluateR22MarketDecision(completeInput(), rule))
      .toEqual(evaluateR22MarketDecision(completeInput(), rule));
  });

  it("parses only a complete versioned snapshot", () => {
    const snapshot = evaluateR22MarketDecision(completeInput(), rule);
    expect(parseR22MarketDecisionSnapshot(snapshot)).toEqual(snapshot);
    expect(parseR22MarketDecisionSnapshot({ ...snapshot, inputHash: "bad" })).toBeNull();
    expect(parseR22MarketDecisionSnapshot({ ...snapshot, schemaVersion: "r21" })).toBeNull();
    expect(parseR22MarketDecisionSnapshot({ ...snapshot, dataCompleteness: 1.01 })).toBeNull();
    expect(parseR22MarketDecisionSnapshot({ ...snapshot, dataCompleteness: Number.NaN })).toBeNull();
    expect(parseR22MarketDecisionSnapshot({ ...snapshot, candidateId: "" })).toBeNull();
    expect(parseR22MarketDecisionSnapshot({ ...snapshot, asin: "   " })).toBeNull();
    expect(parseR22MarketDecisionSnapshot({ ...snapshot, stabilityStatus: "unstable" })).toBeNull();
    expect(parseR22MarketDecisionSnapshot({
      ...snapshot, briefId: "B", stabilityStatus: "stable",
    })).toBeNull();
    expect(parseR22MarketDecisionSnapshot({
      ...snapshot, supportingEvidenceRefs: [],
    })).toBeNull();
    expect(parseR22MarketDecisionSnapshot({
      ...snapshot,
      marketDecision: "insufficient_market_data",
      marketMissingFields: [],
      dataCompleteness: 1,
      confidence: "low",
    })).toBeNull();
    expect(parseR22MarketDecisionSnapshot({
      ...snapshot,
      marketMissingFields: ["customerProof"],
      dataCompleteness: 0.9,
    })).toBeNull();
  });

  it("extracts only a validated R2.2 snapshot from the stored analysis wrapper", () => {
    const snapshot = evaluateR22MarketDecision(completeInput(), rule);
    expect(parseR22MarketDecisionFromAnalysisJson(JSON.stringify({
      version: "candidate-analysis-v2",
      r22MarketDecision: snapshot,
    }))).toEqual(snapshot);
    expect(parseR22MarketDecisionFromAnalysisJson(JSON.stringify({
      r22MarketDecision: { ...snapshot, inputHash: "client-claim" },
    }))).toBeNull();
    expect(parseR22MarketDecisionFromAnalysisJson("{")).toBeNull();
  });
});
