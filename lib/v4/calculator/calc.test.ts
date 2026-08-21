import { describe, it, expect } from "vitest";

import { calcCommercial, roundHalfUp } from "@/lib/v4/calculator/calc";
import type { CalcInput, CalcRuleMeta } from "@/lib/v4/calculator/contract";

const NOW = "2026-08-21T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function advance(days: number): string {
  return new Date(Date.parse(NOW) + days * DAY_MS).toISOString();
}

function rules(over: Partial<CalcRuleMeta> = {}): CalcRuleMeta {
  return {
    version: "calc-commercial.v1",
    marketplace: "amazon_us",
    category: "kitchen",
    reviewedAt: advance(-20),
    sourceUrl: "https://sellercentral.amazon.com/fees",
    stale: false,
    ...over,
  };
}

function baseInput(over: Partial<CalcInput> = {}): CalcInput {
  return {
    purchasePrice: { value: 15, currency: "CNY", kind: "source_value", capturedAt: "2026-08-20T00:00:00.000Z" },
    moq: 100,
    salePrice: { value: 12, currency: "USD" },
    dims: { lengthCm: 30, widthCm: 20, heightCm: 10 },
    weightKg: 1.5,
    freightPerKg: { value: 20, currency: "CNY" },
    commissionRate: 0.15,
    fulfillmentFee: { value: 3, currency: "USD" },
    fxRate: 7.5,
    fxDate: "2026-08-20T00:00:00.000Z",
    ...over,
  };
}

describe("calcCommercial — deterministic Calculator (calc-commercial.v1)", () => {
  it("baseline: 公式金标 (landedCost / margin / marginRate / moqCapital / breakEven)", () => {
    const res = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const b = res.output.scenarios.baseline;
    expect(b.landedCostPerUnit).toBe(6); // (15+30)/7.5
    expect(b.preAdContributionMargin).toBe(1.2); // 12 - 6 - 1.8 - 3
    expect(b.marginRate).toBe(0.1); // 1.2/12
    expect(b.moqCapital).toBe(200); // 15*100/7.5
    expect(b.breakEvenUnits).toBe(166.67); // 200/1.2
  });

  it("货币换算: 本币货物成本按 /fxRate 折算到结算币", () => {
    const res = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules() });
    if (!res.ok) return;
    expect(res.output.scenarios.baseline.landedCostPerUnit).toBe(6);
  });

  it("单位(kg/cm): 体积重大于实重时按体积重计费，小于时按实重计费", () => {
    // 体积重 = 50*50*50/5000 = 25kg > 实重 2kg => 计费重 = 25kg
    const volBig = calcCommercial(
      baseInput({ dims: { lengthCm: 50, widthCm: 50, heightCm: 50 }, weightKg: 2 }),
      { now: NOW, rulesMeta: rules() },
    );
    if (!volBig.ok) return;
    // freight = 20*25 = 500; landed = (15+500)/7.5 = 68.6667
    expect(volBig.output.scenarios.baseline.landedCostPerUnit).toBe(68.67);

    // 体积重 = 1.2kg < 实重 1.5kg => 计费重 = 1.5kg（base 用例）
    const volSmall = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules() });
    if (!volSmall.ok) return;
    expect(volSmall.output.scenarios.baseline.landedCostPerUnit).toBe(6);
  });

  it("三情景: optimistic / pessimistic 系数应用（头程×0.9+汇率×1.05 / 头程×1.3+汇率×0.95）", () => {
    const res = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules() });
    if (!res.ok) return;
    const opt = res.output.scenarios.optimistic;
    const pess = res.output.scenarios.pessimistic;
    // optimistic: fx=7.875, freight=27, landed=(15+27)/7.875=5.3333, margin=12-5.3333-1.8-3=1.8667
    expect(opt.landedCostPerUnit).toBe(5.33);
    expect(opt.preAdContributionMargin).toBe(1.87);
    expect(opt.marginRate).toBe(0.1556);
    expect(opt.moqCapital).toBe(190.48); // 200/1.05
    expect(opt.breakEvenUnits).toBe(102.04);
    // pessimistic: fx=7.125, freight=39, landed=54/7.125=7.5789, margin=12-7.5789-1.8-3=-0.3789
    expect(pess.landedCostPerUnit).toBe(7.58);
    expect(pess.preAdContributionMargin).toBe(-0.38);
    expect(pess.breakEvenUnits).toBeNull(); // margin<=0 -> null
    expect(pess.moqCapital).toBe(210.53); // 200/0.95
    // 单调性: optimistic > baseline > pessimistic 的 landed cost
    expect(res.output.scenarios.optimistic.landedCostPerUnit).toBeLessThan(res.output.scenarios.baseline.landedCostPerUnit);
    expect(res.output.scenarios.baseline.landedCostPerUnit).toBeLessThan(res.output.scenarios.pessimistic.landedCostPerUnit);
  });

  it("退货率: optimistic 强制为 0；baseline/pessimistic 应用给定 returnRate", () => {
    const withReturn = baseInput({ optional: { returnRate: 0.05 } });
    const res = calcCommercial(withReturn, { now: NOW, rulesMeta: rules() });
    if (!res.ok) return;
    // optimistic 强制 returnOverride=0 -> returnLoss 0
    expect(res.output.scenarios.optimistic.preAdContributionMargin).toBeCloseTo(12 - 5.33333 - 1.8 - 3, 1);
    // baseline 应用 0.05 -> returnLoss = 0.6
    expect(res.output.scenarios.baseline.preAdContributionMargin).toBeCloseTo(12 - 6 - 1.8 - 3 - 0.6, 1);
    // pessimistic 应用 0.05 -> margin = 12 - 7.57895 - 1.8 - 3 - 0.6 = -0.9789（breakEven null）
    expect(res.output.scenarios.pessimistic.preAdContributionMargin).toBeCloseTo(12 - 7.57895 - 1.8 - 3 - 0.6, 1);
    expect(res.output.scenarios.pessimistic.breakEvenUnits).toBeNull();
  });

  it("边界/零/负值 -> INVALID_INPUT", () => {
    const cases: [string, Partial<CalcInput>][] = [
      ["salePrice=0", { salePrice: { value: 0, currency: "USD" } }],
      ["salePrice negative", { salePrice: { value: -1, currency: "USD" } }],
      ["moq=0", { moq: 0 }],
      ["moq negative", { moq: -5 }],
      ["purchasePrice negative", { purchasePrice: { value: -1, currency: "CNY", kind: "source_value", capturedAt: "2026-08-20T00:00:00.000Z" } }],
      ["fxRate=0", { fxRate: 0 }],
      ["fxRate negative", { fxRate: -7.5 }],
      ["commissionRate>1", { commissionRate: 1.5 }],
      ["commissionRate<0", { commissionRate: -0.1 }],
      ["weightKg negative", { weightKg: -2 }],
      ["dims negative", { dims: { lengthCm: -1, widthCm: 20, heightCm: 10 } }],
      ["fulfillmentFee negative", { fulfillmentFee: { value: -1, currency: "USD" } }],
      ["returnRate>1", { optional: { returnRate: 1.2 } }],
      ["tariffRate<0", { optional: { tariffRate: -0.1 } }],
    ];
    for (const [name, over] of cases) {
      const res = calcCommercial(baseInput(over), { now: NOW, rulesMeta: rules() });
      expect(res.ok, name).toBe(false);
      if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
    }
  });

  it("purchasePrice=0 为合法（非负）；规则新鲜时仍返回 ok", () => {
    const res = calcCommercial(
      baseInput({ purchasePrice: { value: 0, currency: "CNY", kind: "owner_input", capturedAt: "2026-08-20T00:00:00.000Z" } }),
      { now: NOW, rulesMeta: rules() },
    );
    expect(res.ok).toBe(true);
  });

  it("缺失: freightPerKg 缺失 -> BLOCKED_MISSING_INPUT", () => {
    const res = calcCommercial(baseInput({ freightPerKg: null }), { now: NOW, rulesMeta: rules() });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("BLOCKED_MISSING_INPUT");
      expect(res.missing).toContain("freightPerKg");
    }
  });

  it("缺失: 尺寸与重量同时缺失 -> BLOCKED_MISSING_INPUT", () => {
    const res = calcCommercial(baseInput({ dims: null, weightKg: null }), { now: NOW, rulesMeta: rules() });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("BLOCKED_MISSING_INPUT");
      expect(res.missing).toEqual(expect.arrayContaining(["weightKg", "dims"]));
    }
  });

  it("缺失: 仅缺尺寸（有重量）-> ok:true 部分结果，运费 unknown + 未覆盖成本", () => {
    const res = calcCommercial(baseInput({ dims: null }), { now: NOW, rulesMeta: rules() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.unknowns).toContain("freight_volumetric_weight_unavailable");
    expect(res.output.uncoveredCosts).toContain("freight (partially unknown)");
    // 照实重计费: freight = 20*1.5 = 30, landed = 45/7.5 = 6
    expect(res.output.scenarios.baseline.landedCostPerUnit).toBe(6);
  });

  it("缺失: 仅缺重量（有尺寸）-> ok:true 部分结果，运费按体积重", () => {
    const res = calcCommercial(baseInput({ weightKg: null }), { now: NOW, rulesMeta: rules() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.unknowns).toContain("freight_actual_weight_unavailable");
    // 体积重 = 30*20*10/5000 = 1.2kg, freight = 20*1.2 = 24, landed = 39/7.5 = 5.2
    expect(res.output.scenarios.baseline.landedCostPerUnit).toBe(5.2);
  });

  it("unknown 不补全: 缺失项进入 unknowns，不伪造填充为‘已知’", () => {
    const res = calcCommercial(baseInput({ dims: null }), { now: NOW, rulesMeta: rules({ category: "" }) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.unknowns).toEqual(
      expect.arrayContaining(["freight_volumetric_weight_unavailable", "category"]),
    );
    // 指标照实计算，且明确标记未覆盖，不把运费当作已覆盖
    expect(res.output.uncoveredCosts).toContain("freight (partially unknown)");
  });

  it("四舍五入: round-half-up 确定性（含负数远离零）", () => {
    expect(roundHalfUp(12.345, 2)).toBe(12.35);
    expect(roundHalfUp(12.344, 2)).toBe(12.34);
    expect(roundHalfUp(1.5, 0)).toBe(2);
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
    expect(roundHalfUp(-2.5, 0)).toBe(-3);
    expect(roundHalfUp(-2.4, 0)).toBe(-2);
  });

  it("确定性: 相同输入 + 相同 now => 两次调用输出深等", () => {
    const a = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules() });
    const b = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules() });
    expect(a).toEqual(b);
    if (a.ok && b.ok) expect(a.output).toEqual(b.output);
  });

  it("敏感变量: 排序取 top3，影响按 |Δmargin| 降序，方向确定性", () => {
    const res = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules() });
    if (!res.ok) return;
    const sv = res.output.sensitiveVariables;
    expect(sv).toHaveLength(3);
    expect(sv.map((s) => s.name)).toEqual(["fxRate", "freight", "fulfillmentFee"]);
    // 影响大小降序
    for (let i = 0; i < sv.length - 1; i++) {
      expect(sv[i].deltaImpact).toBeGreaterThanOrEqual(sv[i + 1].deltaImpact);
    }
    expect(sv[0].deltaImpact).toBe(0.67);
    expect(sv[1].deltaImpact).toBe(0.4);
    expect(sv[2].deltaImpact).toBe(0.3);
    // 方向: 成本类 -> down，汇率 -> up（使 margin 上升的移动方向）
    expect(sv.find((s) => s.name === "fxRate")?.direction).toBe("up");
    expect(sv.find((s) => s.name === "freight")?.direction).toBe("down");
    expect(sv.find((s) => s.name === "fulfillmentFee")?.direction).toBe("down");
  });

  it("stale: reviewedAt > 90 天 -> RULES_STALE；<= 90 天 -> ok(stale=false)", () => {
    const staleRes = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules({ reviewedAt: advance(-100) }) });
    expect(staleRes.ok).toBe(false);
    if (!staleRes.ok) expect(staleRes.code).toBe("RULES_STALE");

    const boundary = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules({ reviewedAt: advance(-90) }) });
    expect(boundary.ok).toBe(true);
    if (boundary.ok) expect(boundary.output.rules.stale).toBe(false);

    const fresh = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules() });
    if (fresh.ok) expect(fresh.output.rules.stale).toBe(false);
  });

  it("状态优先级: INVALID 优先于 BLOCKED 优先于 STALE", () => {
    // invalid salePrice + 缺 freightPerKg + stale rules -> INVALID
    const r1 = calcCommercial(
      baseInput({ salePrice: { value: 0, currency: "USD" }, freightPerKg: null }),
      { now: NOW, rulesMeta: rules({ reviewedAt: advance(-100) }) },
    );
    if (!r1.ok) expect(r1.code).toBe("INVALID_INPUT");

    // 正常输入 + 缺 freightPerKg + stale rules -> BLOCKED
    const r2 = calcCommercial(baseInput({ freightPerKg: null }), { now: NOW, rulesMeta: rules({ reviewedAt: advance(-100) }) });
    if (!r2.ok) expect(r2.code).toBe("BLOCKED_MISSING_INPUT");
  });

  it("未覆盖成本: 空 optional -> 列出全部可选成本类别", () => {
    const res = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules() });
    if (!res.ok) return;
    expect(res.output.uncoveredCosts).toEqual([
      "packaging cost",
      "sample/inspection cost",
      "warehousing cost",
      "disposal cost",
      "return rate",
      "tariff rate",
      "ad cost",
    ]);
    expect(res.output.unknowns).toHaveLength(0);
  });

  it("可选成本填入(包装/关税/仓储/退货/广告)后进入计算并从未覆盖列表移除", () => {
    const withOpt = baseInput({
      optional: {
        packagingCostPerUnit: { value: 1, currency: "CNY" },
        tariffRate: 0.1,
        warehousingCostPerUnit: { value: 0.5, currency: "USD" },
        returnRate: 0.02,
        adCostPerUnit: { value: 0.8, currency: "USD" },
      },
    });
    const res = calcCommercial(withOpt, { now: NOW, rulesMeta: rules() });
    if (!res.ok) return;
    // 不再出现在未覆盖列表
    expect(res.output.uncoveredCosts).not.toContain("packaging cost");
    expect(res.output.uncoveredCosts).not.toContain("tariff rate");
    expect(res.output.uncoveredCosts).not.toContain("warehousing cost");
    expect(res.output.uncoveredCosts).not.toContain("return rate");
    expect(res.output.uncoveredCosts).not.toContain("ad cost");
    // 关税: landed = convertedGoods*(1+0.1) = 6*1.1=6.6 (包装成本 1 CNY 加入 baseGoods=46 -> 46/7.5=6.1333; *1.1=6.7467)
    // 我们只做覆盖性断言，不锚定具体数值（由 Lead 裁定关税基数）。
    expect(res.output.scenarios.baseline.landedCostPerUnit).toBeGreaterThan(6);
  });

  it("generatedAt 使用注入的 now（确定性时间基准）", () => {
    const res = calcCommercial(baseInput(), { now: NOW, rulesMeta: rules() });
    if (!res.ok) return;
    expect(res.output.generatedAt).toBe(NOW);
  });
});
