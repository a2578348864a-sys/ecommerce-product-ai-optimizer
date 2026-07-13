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
  it("builds candidate pool handoff URL for /agent/run (Phase Direction-Recovery.3: Gen2 main entry)", () => {
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
    expect(url.pathname).toBe("/agent/run");
    expect(url.searchParams.get("source")).toBe("opportunity");
    expect(url.searchParams.get("from")).toBe("opportunity");
    expect(url.searchParams.get("entry")).toBe("candidate_to_agent_run");
    expect(url.searchParams.get("candidateId")).toBe("test-candidate");
    expect(url.searchParams.get("productName")).toBe("桌面手机支架");
    expect(url.searchParams.get("product")).toBe("桌面手机支架");
    expect(url.searchParams.get("sourceTitle")).toBe("test-title");
    expect(url.searchParams.get("sourceUrl")).toBe("https://example.com/item");
    expect(url.searchParams.get("opportunityScore")).toBe("86");
    expect(url.searchParams.get("originalName")).toBe("原始候选：phone stand");
    expect(url.searchParams.get("analyzedName")).toBe("桌面手机支架");
  });

  it("carries compact candidate evidence snapshot to /agent/run", () => {
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
    const encoded = url.searchParams.get("evidence");
    expect(encoded).toBeTruthy();
    expect(decodeURIComponent(encoded || "")).toContain("qualityScore");
    expect(decodeURIComponent(encoded || "")).not.toContain("cookie");
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
    expect(JSON.parse(parsed.searchParams.get("r22Market") || "{}").marketDecision)
      .toBe("market_shortlisted");
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
