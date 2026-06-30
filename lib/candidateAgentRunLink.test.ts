import { describe, expect, it } from "vitest";
import { buildCandidateAgentRunHref } from "@/lib/candidateAgentRunLink";

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

    const url = new URL(href, "http://localhost:3005");
    const encoded = url.searchParams.get("evidence");
    expect(encoded).toBeTruthy();
    expect(decodeURIComponent(encoded || "")).toContain("qualityScore");
    expect(decodeURIComponent(encoded || "")).not.toContain("cookie");
  });
});
