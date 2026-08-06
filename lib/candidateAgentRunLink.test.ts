import { describe, expect, it } from "vitest";
import { buildCandidateAgentRunHref } from "@/lib/candidateAgentRunLink";
import type { R22MarketDecisionSnapshot } from "@/lib/r22DecisionModel";

function marketSnapshot(marketDecision: R22MarketDecisionSnapshot["marketDecision"]): R22MarketDecisionSnapshot {
  return {
    schemaVersion: "r22-market-decision-v1",
    evidenceVersion: "r22-evidence-semantics-v1",
    candidateId: "test-candidate",
    asin: "B000000001",
    briefId: "A",
    frozenRank: 1,
    marketDecision,
    decisionReasons: ["test_reason"],
    supportingEvidenceRefs: ["fixture:market"],
    opposingEvidenceRefs: [],
    marketMissingFields: [],
    dataCompleteness: 1,
    confidence: "high",
    stabilityStatus: "stable",
    ruleVersion: "r22-stage1-market-v1",
    inputHash: "a".repeat(64),
    createdAt: "2026-07-13T00:00:00.000Z",
  };
}

describe("buildCandidateAgentRunHref", () => {
  it("builds an opaque Candidate-only handoff URL for the candidate research page", () => {
    const href = buildCandidateAgentRunHref({
      candidateId: "test-candidate",
      name: "桌面手机支架",
      rawInput: "原始候选：phone stand",
      analyzedName: "桌面手机支架",
      sourceTitle: "test-title",
      sourceUrl: "https://example.com/item",
      source: "机会雷达候选品",
      score: 86.4,
      keyword: "phone stand",
    });

    expect(href).not.toBeNull();
    if (!href) throw new Error("expected authoritative Candidate href");
    const url = new URL(href, "http://localhost:3005");
    // R1: 研究入口已迁移到商品研究池候选详情页
    expect(url.pathname).toBe("/opportunity-candidates/test-candidate");
    expect(url.searchParams.get("source")).toBe("opportunity");
    expect(url.searchParams.get("candidateId")).toBe("test-candidate");
    expect([...url.searchParams.keys()].sort()).toEqual(["candidateId", "source"]);
  });

  it("never carries Candidate evidence or source details in the URL", () => {
    const href = buildCandidateAgentRunHref({
      candidateId: "test-candidate",
      name: "Desk Phone Stand",
      sourceUrl: "https://example.com/item",
      evidenceSnapshot: {
        version: 1,
        sourceType: "web",
        sourceName: "source importer",
        sourceUrl: "https://example.com/item",
        evidenceItems: ["product_page", "price_seen"],
        extractionSignals: ["url_path_product"],
        qualityScore: 86,
        confidence: "high",
        riskFlags: [],
        decision: "recommended",
        decisionReason: "Specific product page with usable source evidence.",
        nextAction: "Continue to agent run after manual confirmation.",
        generatedAt: "2026-06-30T10:00:00.000Z",
      },
    });

    expect(href).not.toBeNull();
    if (!href) throw new Error("expected authoritative Candidate href");
    const url = new URL(href, "http://localhost:3005");
    expect(url.searchParams.get("evidence")).toBeNull();
    expect(url.searchParams.get("productName")).toBeNull();
    expect(url.searchParams.get("sourceUrl")).toBeNull();
    expect(url.searchParams.get("r22Market")).toBeNull();
  });

  it("fails closed for missing or local draft candidate ids", () => {
    expect(buildCandidateAgentRunHref({ name: "无 ID 候选" })).toBeNull();
    expect(buildCandidateAgentRunHref({ candidateId: "opp-local123", name: "本地草稿" })).toBeNull();
  });

  it("carries a validated R2.2 decision and blocks reject or insufficient decisions", () => {
    const href = buildCandidateAgentRunHref({
      candidateId: "test-candidate",
      name: "R2.2 candidate",
      marketDecisionSnapshot: marketSnapshot("market_shortlisted"),
    });
    expect(href).not.toBeNull();
    const parsed = new URL(href || "", "http://localhost:3005");
    expect(parsed.searchParams.get("r22Market")).toBeNull();
    expect(buildCandidateAgentRunHref({
      candidateId: "test-candidate",
      marketDecisionSnapshot: marketSnapshot("market_reject"),
    })).toBeNull();
    expect(buildCandidateAgentRunHref({
      candidateId: "test-candidate",
      marketDecisionSnapshot: marketSnapshot("insufficient_market_data"),
    })).toBeNull();
  });

  it("requires explicit review to route a market watch candidate", () => {
    expect(buildCandidateAgentRunHref({
      candidateId: "test-candidate",
      marketDecisionSnapshot: marketSnapshot("market_watch"),
    })).toBeNull();
    expect(buildCandidateAgentRunHref({
      candidateId: "test-candidate",
      marketDecisionSnapshot: marketSnapshot("market_watch"),
      explicitMarketWatchReview: true,
    })).not.toBeNull();
  });
});
