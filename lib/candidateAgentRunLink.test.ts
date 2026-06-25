import { describe, expect, it } from "vitest";
import { buildCandidateAgentRunHref } from "@/lib/candidateAgentRunLink";

describe("buildCandidateAgentRunHref", () => {
  it("builds candidate pool handoff URL for Agent Run", () => {
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
    expect(url.searchParams.get("entry")).toBe("candidate_to_agent_m1");
    expect(url.searchParams.get("candidateId")).toBe("test-candidate");
    expect(url.searchParams.get("productName")).toBe("桌面手机支架");
    expect(url.searchParams.get("sourceTitle")).toBe("test-title");
    expect(url.searchParams.get("sourceUrl")).toBe("https://example.com/item");
    expect(url.searchParams.get("opportunityScore")).toBe("86");
    expect(url.searchParams.get("originalName")).toBe("原始候选：phone stand");
    expect(url.searchParams.get("analyzedName")).toBe("桌面手机支架");
  });
});
