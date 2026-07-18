import { describe, expect, it } from "vitest";
import {
  buildStage15ShadowObservation,
  buildStage15ShadowPolicyCandidate,
  type Stage15ShadowObservationInput,
} from "./stage15-shadow-calibration";

const observed = <T>(value: T, exactVariant: boolean | null = true) => ({
  value,
  status: "observed" as const,
  evidenceRefs: ["https://www.amazon.com/dp/B012345678"],
  capturedAt: "2026-07-17T04:00:00.000Z",
  exactVariant,
  missingReason: null,
});
const missing = (reason = "not_visible_on_approved_source") => ({
  value: null,
  status: "missing" as const,
  evidenceRefs: [],
  capturedAt: null,
  exactVariant: null,
  missingReason: reason,
});

function input(): Stage15ShadowObservationInput {
  return {
    schemaVersion: "stage15-shadow-observation-input.v1",
    batchId: "batch-c",
    productKey: "amazon:US:B012345678",
    evidenceSnapshotId: "evidence-1",
    marketValidation: {
      monthlyBought: missing(),
      categoryRank: observed({ rank: 3, category: "Desk Organizers" }),
      rating: observed(4.7),
      reviewCount: observed(1200),
    },
    listingMaturity: {
      firstAvailableAt: missing(),
      ageDays: missing("first_available_at_missing"),
    },
    buyerReviews: {
      positive: missing("exact_variant_reviews_not_collected"),
      negative: missing("exact_variant_reviews_not_collected"),
      sampleCount: missing("exact_variant_reviews_not_collected"),
    },
    decisionImpact: false,
  };
}

describe("stage15 shadow observation", () => {
  it("normalizes traceable evidence and produces a deterministic canonical hash", () => {
    const first = buildStage15ShadowObservation(input());
    const second = buildStage15ShadowObservation(input());
    expect(first).toEqual(second);
    expect(first.observationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.decisionImpact).toBe(false);
  });

  it.each([
    ["observed without refs", () => ({ ...input(), marketValidation: { ...input().marketValidation, rating: { ...observed(4.7), evidenceRefs: [] } } })],
    ["missing without reason", () => ({ ...input(), marketValidation: { ...input().marketValidation, monthlyBought: missing("") } })],
    ["invalid time", () => ({ ...input(), marketValidation: { ...input().marketValidation, rating: { ...observed(4.7), capturedAt: "today" } } })],
    ["age without calculation basis", () => ({ ...input(), listingMaturity: { firstAvailableAt: observed("2026-01-01T00:00:00.000Z"), ageDays: { ...observed(10), capturedAt: null } } })],
    ["similar review claimed exact", () => ({ ...input(), buyerReviews: { ...input().buyerReviews, positive: { ...observed(["good"]), evidenceRefs: ["similar_variant:review-1"] } } })],
  ])("rejects %s", (_name, mutate) => {
    expect(() => buildStage15ShadowObservation(mutate() as Stage15ShadowObservationInput)).toThrow();
  });

  it.each(["score", "weight", "rankOverride", "statusOverride", "profit", "margin"])(
    "rejects forbidden decision input %s",
    (key) => expect(() => buildStage15ShadowObservation({ ...input(), [key]: 1 } as Stage15ShadowObservationInput)).toThrow("SHADOW_FORBIDDEN_INPUT"),
  );
});

describe("stage15 shadow policy candidate", () => {
  it("returns insufficient evidence instead of inventing a rule", () => {
    const observation = buildStage15ShadowObservation(input());
    const policy = buildStage15ShadowPolicyCandidate({
      calibrationBatch: { batchHash: "a".repeat(64), observations: Array.from({ length: 20 }, () => observation) },
      blindEvaluationResult: { resultHash: "b".repeat(64), answers: Array.from({ length: 20 }, (_, index) => ({ evaluationItemId: `c-${index}`, worthFurtherInvestigation: "insufficient_evidence" as const })) },
      allowedSignalMenu: [],
      createdAt: "2026-07-17T05:00:00.000Z",
    });
    expect(policy.status).toBe("insufficient_evidence");
    expect(policy.rules).toEqual([]);
    expect(policy.proposalOnly).toBe(true);
    expect(policy.productionEffect).toBe(false);
  });

  it("allows at most three menu rules and never listing-maturity priority", () => {
    const observation = buildStage15ShadowObservation({
      ...input(),
      buyerReviews: {
        positive: observed(["easy to organize"]),
        negative: observed(["plastic feels thin"]),
        sampleCount: observed(2),
      },
    });
    const policy = buildStage15ShadowPolicyCandidate({
      calibrationBatch: { batchHash: "a".repeat(64), observations: Array.from({ length: 20 }, () => observation) },
      blindEvaluationResult: { resultHash: "b".repeat(64), answers: Array.from({ length: 20 }, (_, index) => ({ evaluationItemId: `c-${index}`, worthFurtherInvestigation: "yes" as const })) },
      allowedSignalMenu: [
        { signal: "market_validation", predicate: "category_rank_observed", effect: "shadow_priority" },
        { signal: "listing_maturity", predicate: "age_missing", effect: "confidence_only" },
        { signal: "buyer_reviews", predicate: "exact_reviews_missing", effect: "shadow_watch" },
      ],
      createdAt: "2026-07-17T05:00:00.000Z",
    });
    expect(policy.status).toBe("frozen");
    expect(policy.rules).toHaveLength(3);
    expect(policy.rules.find((rule) => rule.signal === "listing_maturity")?.effect).not.toBe("shadow_priority");
    expect(policy.policyHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
