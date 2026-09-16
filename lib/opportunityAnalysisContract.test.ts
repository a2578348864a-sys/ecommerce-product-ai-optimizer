import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKETPLACE,
  findBannedClaimPhrases,
  normalizeOpportunityAnalysisResult,
  sanitizeOpportunityText,
} from "./opportunityAnalysisContract";

describe("机会分析共享契约（V0）", () => {
  it("默认市场为 Amazon US", () => {
    expect(DEFAULT_MARKETPLACE).toBe("Amazon US");
  });

  it("净化违禁结论表达，替换为可验证表述", () => {
    expect(findBannedClaimPhrases("这是爆款，一定赚钱，高销量，市场巨大")).toHaveLength(4);

    const sanitized = sanitizeOpportunityText("这是爆款，一定赚钱，高销量，市场巨大");
    expect(findBannedClaimPhrases(sanitized)).toEqual([]);
    expect(sanitized).not.toContain("爆款");
    expect(sanitized).not.toContain("一定赚钱");
    expect(sanitized).not.toContain("高销量");
    expect(sanitized).not.toContain("市场巨大");
    expect(sanitized).toContain("值得研究的候选方向");
    expect(sanitized).toContain("可能存在机会");
  });

  it("归一化 AI 输出：数组字段、去重、上限", () => {
    const candidates = normalizeOpportunityAnalysisResult({
      candidates: [
        {
          title: "可折叠露营挂灯",
          reason: "值得研究，需要验证夜间照明需求",
          painPoints: ["收纳体积大", "收纳体积大"],
          validationNeeded: ["目标市场同类供给强度未知"],
        },
        {
          title: "可折叠露营挂灯",
          reason: "重复身份应被去重",
          painPoints: [],
          validationNeeded: [],
        },
        {
          title: "便携式地钉拔出器",
          reason: "可能存在机会",
          painPoints: "起钉费力\n冬季冻土更难",
          validationNeeded: "是否真的是高频痛点",
        },
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0].painPoints).toEqual(["收纳体积大"]);
    expect(candidates[1].painPoints).toEqual(["起钉费力", "冬季冻土更难"]);
    expect(candidates[1].validationNeeded).toEqual(["是否真的是高频痛点"]);
  });

  it("候选缺少字段时给出占位，不产出不合规结论", () => {
    const candidates = normalizeOpportunityAnalysisResult({
      candidates: [{ title: "户外折叠桌板" }],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].reason).toBeTruthy();
    expect(candidates[0].painPoints.length).toBeGreaterThan(0);
    expect(candidates[0].validationNeeded.length).toBeGreaterThan(0);
    expect(findBannedClaimPhrases(JSON.stringify(candidates))).toEqual([]);
  });

  it("AI 输出非法结构时返回空数组而不是抛错", () => {
    expect(normalizeOpportunityAnalysisResult(null)).toEqual([]);
    expect(normalizeOpportunityAnalysisResult({ candidates: "not-an-array" })).toEqual([]);
    expect(normalizeOpportunityAnalysisResult({ candidates: [1, "x", null] })).toEqual([]);
  });

  it("最多保留 6 个候选", () => {
    const candidates = normalizeOpportunityAnalysisResult({
      candidates: Array.from({ length: 10 }, (_unused, index) => ({
        title: `候选 ${index + 1}`,
        reason: "值得研究",
        painPoints: ["待验证"],
        validationNeeded: ["待验证"],
      })),
    });

    expect(candidates).toHaveLength(6);
  });
});
