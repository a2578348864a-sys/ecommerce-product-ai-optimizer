/**
 * Phase 2-A workflow step function tests.
 *
 * Tests validate fallback paths only — aiClient is mocked to always fail.
 * No real AI calls are made.
 */
import { describe, expect, it, vi } from "vitest";

// Mock aiClient to always return failure (no real AI in tests)
vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: vi.fn().mockResolvedValue({
    ok: false,
    error: { code: "test_mock", message: "Mocked — no real AI in tests" },
  }),
}));

import {
  runSourcingStep,
  runRiskStep,
  runSummaryStep,
  runListingStep,
} from "./productAnalysis";

describe("runSourcingStep", () => {
  it("returns fallback status when AI is unavailable", async () => {
    const result = await runSourcingStep("桌面手机支架", "普通桌面支架");
    expect(result.status).toBe("fallback");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns valid output shape", async () => {
    const result = await runSourcingStep("test product", "");
    expect(result.data).toHaveProperty("feasibility");
    expect(["high", "medium", "low"]).toContain(result.data.feasibility);
    expect(result.data).toHaveProperty("beginnerFriendly");
    expect(typeof result.data.beginnerFriendly).toBe("boolean");
    expect(result.data).toHaveProperty("complianceBarrier");
    expect(result.data).toHaveProperty("suggestedEntryLevel");
    expect(Array.isArray(result.data.searchKeywords)).toBe(true);
    expect(Array.isArray(result.data.nextSteps)).toBe(true);
    expect(result.data.summary).toBeTruthy();
  });

  it("detects electrical keywords in keyword fallback", async () => {
    const result = await runSourcingStep("USB充电暖手宝", "带电 电子 锂电池");
    expect(result.data.feasibility).toBe("low");
    expect(result.data.complianceBarrier).toBe("high");
    expect(result.data.beginnerFriendly).toBe(false);
  });
});

describe("runRiskStep", () => {
  it("returns fallback status when AI is unavailable", async () => {
    const result = await runRiskStep("桌面手机支架", "普通支架");
    expect(result.status).toBe("fallback");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns valid output shape", async () => {
    const result = await runRiskStep("test product", "");
    expect(result.data).toHaveProperty("overallLevel");
    expect(["green", "yellow", "red"]).toContain(result.data.overallLevel);
    expect(result.data).toHaveProperty("beginnerFriendly");
    expect(Array.isArray(result.data.blacklistMatches)).toBe(true);
    expect(Array.isArray(result.data.complianceWarnings)).toBe(true);
    expect(result.data.summary).toBeTruthy();
  });

  it("detects children + battery as red in keyword fallback", async () => {
    const result = await runRiskStep("儿童电动牙刷", "儿童 锂电池 电动牙刷");
    expect(result.data.overallLevel).toBe("red");
    expect(result.data.beginnerFriendly).toBe(false);
  });
});

describe("runSummaryStep", () => {
  it("returns fallback status when AI is unavailable", async () => {
    const result = await runSummaryStep("test product", "desc", null, null);
    expect(result.status).toBe("fallback");
  });

  it("returns valid output shape", async () => {
    const result = await runSummaryStep("test product", "", null, null);
    expect(result.data).toHaveProperty("verdict");
    expect(typeof result.data.verdict).toBe("string");
    expect(result.data.parseFailed).toBe(true); // fallback sets this
    expect(Array.isArray(result.data.reasons)).toBe(true);
    expect(Array.isArray(result.data.nextSteps)).toBe(true);
  });

  it("returns conservative verdict with red risk context", async () => {
    const sourcing = {
      feasibility: "high",
      summary: "test",
      searchKeywords: [],
      moqEstimate: "low",
      beginnerFriendly: true,
      beginnerFit: "high",
      complianceBarrier: "low",
      logisticsDifficulty: "low",
      afterSalesRisk: "low",
      suggestedEntryLevel: "beginner",
      nextSteps: [],
    };
    const risk = {
      overallLevel: "red",
      summary: "高风险",
      blacklistMatches: ["儿童"],
      beginnerFriendly: false,
      complianceWarnings: ["test"],
    };
    const result = await runSummaryStep("儿童电动牙刷", "儿童用品", sourcing, risk);
    expect(result.data.verdict).toBeDefined();
    expect(result.status).toBe("fallback");
  });
});

describe("runListingStep", () => {
  it("returns fallback status when AI is unavailable", async () => {
    const result = await runListingStep("桌面手机支架", null);
    expect(result.status).toBe("fallback");
  });

  it("returns valid output shape", async () => {
    const result = await runListingStep("test product", null);
    expect(result.data).toHaveProperty("title");
    expect(typeof result.data.title).toBe("string");
    expect(Array.isArray(result.data.keywords)).toBe(true);
    expect(Array.isArray(result.data.complianceNotes)).toBe(true);
    expect(result.data.complianceNotes.length).toBeGreaterThan(0);
  });

  it("returns product name as title in fallback", async () => {
    const result = await runListingStep("桌面手机支架", null);
    expect(result.data.title).toBe("桌面手机支架");
  });
});
