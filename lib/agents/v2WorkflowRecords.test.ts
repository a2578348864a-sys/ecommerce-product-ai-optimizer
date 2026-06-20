import { describe, it, expect } from "vitest";
import { extractCandidates, type V2RecordsInput } from "./v2WorkflowRecords";

/* ── Fixtures ──────────────────────────────────── */

/** 完整的 3 候选品 opportunities 记录（模拟真实 API 响应） */
function makeFullFixture(): V2RecordsInput {
  return {
    items: [
      {
        type: "opportunities",
        result: {
          leaderboard: ["1. [优先小单测试] 桌面手机支架（90分）"],
          candidates: [
            {
              name: "桌面手机支架",
              score: 90,
              level: "A",
              levelLabel: "优先小单测试",
              displayRiskLevel: "yellow",
              reasons: ["货源易找", "新手友好"],
              risks: ["确认无磁铁或电池"],
              nextAction: "建议小单测试",
              sourcingSummary: "1688货源充足，MOQ 10-50个",
              riskSummary: "通用品类，无侵权风险",
              summaryVerdict: "新手可小单测试",
              status: "completed",
            },
            {
              name: "宠物慢食碗",
              score: 55,
              level: "B",
              levelLabel: "可以观察",
              displayRiskLevel: "yellow",
              reasons: ["货源稳定"],
              risks: ["食品接触需认证"],
              nextAction: "先确认材质认证",
              sourcingSummary: "供应商较多，需筛选",
              riskSummary: "食品接触类，需FDA/LFGB",
              summaryVerdict: "有经验可尝试",
              status: "completed",
            },
            {
              name: "儿童电动牙刷",
              score: 10,
              level: "E",
              levelLabel: "暂不建议",
              displayRiskLevel: "red",
              reasons: [],
              risks: ["儿童用品", "带电", "CPC认证"],
              nextAction: "不建议新手做",
              sourcingSummary: "供应商少，MOQ高",
              riskSummary: "高风险：儿童+带电+认证",
              summaryVerdict: "新手不建议",
              status: "completed",
            },
          ],
        },
      },
    ],
  };
}

/** records 字段的变体（API 有时用 records 不用 items） */
function makeRecordsVariant(): V2RecordsInput {
  return {
    records: [
      {
        type: "opportunities",
        result: {
          candidates: [
            {
              name: "硅胶折叠水杯",
              score: 45,
              levelLabel: "有经验再做",
              displayRiskLevel: "yellow",
              sourcingSummary: "供应商适中",
              riskSummary: "食品接触+专利风险",
              summaryVerdict: "有经验可试",
            },
          ],
        },
      },
    ],
  };
}

/* ── Tests ─────────────────────────────────────── */

describe("extractCandidates", () => {
  it("从完整 opportunities 记录解析 3 个候选品", () => {
    const result = extractCandidates(makeFullFixture());
    expect(result).toHaveLength(3);

    // 第一个候选品应完整
    const first = result[0];
    expect(first.name).toBe("桌面手机支架");
    expect(first.score).toBe(90);
    expect(first.level).toBe("A");
    expect(first.levelLabel).toBe("优先小单测试");
    expect(first.displayRiskLevel).toBe("yellow");
    expect(first.reasons).toEqual(["货源易找", "新手友好"]);
    expect(first.risks).toEqual(["确认无磁铁或电池"]);
    expect(first.nextAction).toBe("建议小单测试");
    expect(first.sourcingSummary).toBe("1688货源充足，MOQ 10-50个");
    expect(first.riskSummary).toBe("通用品类，无侵权风险");
    expect(first.summaryVerdict).toBe("新手可小单测试");
    expect(first.status).toBe("completed");

    // 第三个候选品（高风险，reasons 为空）
    const third = result[2];
    expect(third.name).toBe("儿童电动牙刷");
    expect(third.score).toBe(10);
    expect(third.displayRiskLevel).toBe("red");
    expect(third.reasons).toEqual([]);
    expect(third.sourcingSummary).not.toBe("暂无该项数据");
  });

  it("records 字段变体也能解析", () => {
    const result = extractCandidates(makeRecordsVariant());
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("硅胶折叠水杯");
    expect(result[0].score).toBe(45);
  });

  it("candidates 缺失时返回空数组", () => {
    const input: V2RecordsInput = {
      items: [{ type: "opportunities", result: {} }],
    };
    expect(extractCandidates(input)).toEqual([]);
  });

  it("空输入返回空数组", () => {
    expect(extractCandidates({})).toEqual([]);
    expect(extractCandidates({ items: [] })).toEqual([]);
    expect(extractCandidates({ records: [] })).toEqual([]);
  });

  it("非 opportunities 类型返回空数组", () => {
    const input: V2RecordsInput = {
      items: [{ type: "viral", result: { candidates: [{ name: "x" }] } }],
    };
    expect(extractCandidates(input)).toEqual([]);
  });

  it("candidate 缺少 sourcing/risk/summary 时使用默认值", () => {
    const input: V2RecordsInput = {
      items: [
        {
          type: "opportunities",
          result: {
            candidates: [{ name: "测试商品" }],
          },
        },
      ],
    };
    const result = extractCandidates(input);
    expect(result).toHaveLength(1);
    const c = result[0];
    expect(c.name).toBe("测试商品");
    expect(c.score).toBe(0);
    expect(c.level).toBe("");
    expect(c.levelLabel).toBe("");
    expect(c.displayRiskLevel).toBe("");
    expect(c.sourcingSummary).toBe("暂无该项数据");
    expect(c.riskSummary).toBe("暂无该项数据");
    expect(c.summaryVerdict).toBe("暂无该项数据");
    expect(c.reasons).toEqual([]);
    expect(c.risks).toEqual([]);
    expect(c.nextAction).toBe("");
    expect(c.status).toBe("");
  });

  it("score 为字符串时能正确转换为数字", () => {
    const input: V2RecordsInput = {
      items: [
        {
          type: "opportunities",
          result: {
            candidates: [{ name: "字符串分数", score: "88" }],
          },
        },
      ],
    };
    const result = extractCandidates(input);
    expect(result[0].score).toBe(88);
  });

  it("NaN score 返回 0", () => {
    const input: V2RecordsInput = {
      items: [
        {
          type: "opportunities",
          result: {
            candidates: [{ name: "坏分数", score: "not-a-number" }],
          },
        },
      ],
    };
    const result = extractCandidates(input);
    expect(result[0].score).toBe(0);
  });

  it("多任务时只取第一条 opportunities", () => {
    const input: V2RecordsInput = {
      items: [
        { type: "viral", result: { candidates: [{ name: "忽略" }] } },
        {
          type: "opportunities",
          result: {
            candidates: [{ name: "目标商品" }],
          },
        },
        {
          type: "opportunities",
          result: {
            candidates: [{ name: "第二条忽略" }],
          },
        },
      ],
    };
    const result = extractCandidates(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("目标商品");
  });

  it("不会因为单个候选品字段异常而抛错", () => {
    const input: V2RecordsInput = {
      items: [
        {
          type: "opportunities",
          result: {
            candidates: [
              null,
              undefined,
              "not an object",
              123,
              { name: "正常" },
              { name: "坏分数", score: null },
              { name: undefined },
            ],
          },
        },
      ],
    };
    // 不应抛异常
    const result = extractCandidates(input);
    expect(Array.isArray(result)).toBe(true);
    // 非 object 元素被过滤，因为 .map() 里 isRecord 对 null/undefined/string/number 返回 false，变成 {}
    // 所以我们至少有 7 个元素，每个都是安全的 V2Candidate
    expect(result.length).toBeGreaterThanOrEqual(1);
    // 每个元素都应有 string name（不会抛 undefined 给前端）
    for (const c of result) {
      expect(typeof c.name).toBe("string");
      expect(typeof c.score).toBe("number");
      expect(Number.isFinite(c.score)).toBe(true);
      expect(typeof c.sourcingSummary).toBe("string");
      expect(typeof c.riskSummary).toBe("string");
      expect(typeof c.summaryVerdict).toBe("string");
    }
  });

  it("null result 不抛异常", () => {
    const input: V2RecordsInput = {
      items: [{ type: "opportunities", result: null }],
    };
    expect(extractCandidates(input)).toEqual([]);
  });

  it("undefined result 不抛异常", () => {
    const input: V2RecordsInput = {
      items: [{ type: "opportunities" }],
    };
    expect(extractCandidates(input)).toEqual([]);
  });
});
