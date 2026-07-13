import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  callAiJson: vi.fn(),
}));

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: aiMocks.callAiJson,
}));

import {
  getOpportunityDisplayRiskLevel,
  OPPORTUNITY_AI_CALLS_PER_CANDIDATE,
  runOpportunitiesPipeline,
  type ProductCandidate,
} from "./orchestrator";

beforeEach(() => {
  vi.clearAllMocks();
  aiMocks.callAiJson.mockImplementation(async (params: { onProviderCallStart?: () => void | Promise<void> }) => {
    await params.onProviderCallStart?.();
    return { ok: true, data: {}, providerCallStarted: true };
  });
});

function candidate(overrides: Partial<ProductCandidate>): ProductCandidate {
  return {
    index: 0,
    rawInput: "桌面手机支架",
    name: "桌面手机支架",
    link: null,
    status: "completed",
    score: 90,
    level: "A",
    levelLabel: "优先小单测试",
    reasons: [],
    risks: [],
    nextAction: "",
    sourcing: {
      feasibility: "high",
      summary: "普通轻小件，货源成熟。",
      searchKeywords: [],
      moqEstimate: "低",
      beginnerFriendly: true,
      beginnerFit: "high",
      complianceBarrier: "low",
      logisticsDifficulty: "low",
      afterSalesRisk: "low",
      suggestedEntryLevel: "beginner",
    },
    risk: {
      overallLevel: "green",
      summary: "普通轻小件，未发现明显高风险。",
      blacklistMatches: [],
      beginnerFriendly: true,
    },
    summary: {
      verdict: "新手可小单测试",
      confidence: "high",
      summary: "适合小单测试。",
      reasons: [],
      risks: [],
      nextSteps: [],
      beginnerTip: "先小单。",
      downgraded: false,
      downgradeReasons: [],
    },
    ...overrides,
  };
}

describe("getOpportunityDisplayRiskLevel", () => {
  it("儿童带电且已被强降级时展示为高风险", () => {
    const result = getOpportunityDisplayRiskLevel(candidate({
      rawInput: "儿童电动牙刷",
      name: "儿童电动牙刷",
      score: 10,
      level: "E",
      levelLabel: "暂不建议",
      risks: ["儿童用品合规门槛高，需要 CPC 材料检测和电池运输文件。"],
      sourcing: {
        feasibility: "medium",
        summary: "儿童入口使用，带电池，需处理 CPC、材料检测和电池运输问题。",
        searchKeywords: [],
        moqEstimate: "待确认",
        beginnerFriendly: false,
        beginnerFit: "low",
        complianceBarrier: "high",
        logisticsDifficulty: "medium",
        afterSalesRisk: "high",
        suggestedEntryLevel: "experienced",
      },
      risk: {
        overallLevel: "yellow",
        summary: "面向儿童且带电，需确认儿童用品和带电产品资质。",
        blacklistMatches: [],
        beginnerFriendly: false,
      },
      summary: {
        verdict: "新手不建议做",
        confidence: "medium",
        summary: "涉及儿童安全、带电合规和平台资质。",
        reasons: [],
        risks: ["CPC/ASTM/电池运输文件需人工复核"],
        nextSteps: [],
        beginnerTip: "新手暂缓。",
        downgraded: true,
        downgradeReasons: ["货源分析标注合规门槛为「高」。"],
      },
    }));

    expect(result).toBe("red");
  });

  it("普通桌面手机支架保持低风险展示", () => {
    expect(getOpportunityDisplayRiskLevel(candidate({}))).toBe("green");
  });

  it("食品接触且新手不建议时展示为高风险", () => {
    const result = getOpportunityDisplayRiskLevel(candidate({
      rawInput: "硅胶折叠水杯",
      name: "硅胶折叠水杯",
      score: 45,
      level: "D",
      levelLabel: "新手不建议",
      risks: ["食品接触材料需确认 FDA/LFGB 文件。"],
      risk: {
        overallLevel: "yellow",
        summary: "食品接触材料和平台资质需人工复核。",
        blacklistMatches: [],
        beginnerFriendly: false,
      },
      summary: {
        verdict: "可做但需控制成本",
        confidence: "medium",
        summary: "食品接触合规和专利风险需要确认。",
        reasons: [],
        risks: ["食品接触材料合规风险"],
        nextSteps: [],
        beginnerTip: "新手暂缓。",
        downgraded: true,
        downgradeReasons: ["风险排查总体评级为「需注意」。"],
      },
    }));

    expect(result).toBe("red");
  });
});

describe("runOpportunitiesPipeline provider call accounting", () => {
  it("counts three started Provider calls for one candidate", async () => {
    const result = await runOpportunitiesPipeline("Phone stand");

    expect(OPPORTUNITY_AI_CALLS_PER_CANDIDATE).toBe(3);
    expect(aiMocks.callAiJson).toHaveBeenCalledTimes(3);
    expect(result.providerCallStartedCount).toBe(3);
  });

  it("counts N x 3 started Provider calls for multiple candidates", async () => {
    const result = await runOpportunitiesPipeline("Phone stand\nDesk lamp");

    expect(aiMocks.callAiJson).toHaveBeenCalledTimes(6);
    expect(result.providerCallStartedCount).toBe(6);
  });

  it("reports each started Provider call through the progress hook", async () => {
    const onProviderCallStarted = vi.fn();

    const result = await runOpportunitiesPipeline("Phone stand", { onProviderCallStarted });

    expect(result.providerCallStartedCount).toBe(3);
    expect(onProviderCallStarted).toHaveBeenCalledTimes(3);
  });

  it("reports the started boundary before each mocked Provider result resolves", async () => {
    const events: string[] = [];
    aiMocks.callAiJson.mockImplementation(async (params: { onProviderCallStart?: () => void | Promise<void> }) => {
      await params.onProviderCallStart?.();
      events.push("provider-result");
      return { ok: true, data: {}, providerCallStarted: true };
    });

    await runOpportunitiesPipeline("Phone stand", {
      onProviderCallStarted: () => { events.push("persisted"); },
    });

    expect(events).toEqual([
      "persisted", "provider-result",
      "persisted", "provider-result",
      "persisted", "provider-result",
    ]);
  });

  it("does not count calls that fail before the Provider SDK starts", async () => {
    aiMocks.callAiJson.mockResolvedValue({
      ok: false,
      error: { code: "missing_api_key", message: "missing" },
      providerCallStarted: false,
    });

    const result = await runOpportunitiesPipeline("Phone stand");

    expect(aiMocks.callAiJson).toHaveBeenCalledTimes(3);
    expect(result.providerCallStartedCount).toBe(0);
  });
});
