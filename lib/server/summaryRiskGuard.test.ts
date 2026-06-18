import { describe, it, expect } from "vitest";
import { applyHardGuard } from "@/lib/server/summaryRiskGuard";
import type { RiskGuardInput } from "@/lib/server/summaryRiskGuard";

// 帮助函数：构造基础 input
function baseInput(overrides: Partial<RiskGuardInput> = {}): RiskGuardInput {
  return {
    aiVerdict: "新手可小单测试",
    productName: "测试商品",
    ...overrides,
  };
}

describe("applyHardGuard", () => {
  // ── Case 1: 儿童餐具/儿童玩具 + 小部件 → 不能推荐 ──

  it("Case 1: 儿童硅胶餐具 → 不能推荐，应为「新手不建议做」", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "新手可小单测试",
        productName: "婴儿硅胶折叠碗",
        category: "母婴用品",
        description: "食品级硅胶材质，适合6个月以上宝宝使用，可折叠便携",
        sourcingComplianceBarrier: "high",
        sourcingSuggestedEntryLevel: "experienced",
      })
    );

    expect(result.downgraded).toBe(true);
    expect(result.safeVerdict).toBe("新手不建议做");
    expect(result.downgradeReasons.length).toBeGreaterThan(0);
    // 不应输出"推荐"级别
    expect(result.safeVerdict).not.toBe("新手可小单测试");
    expect(result.safeVerdict).not.toBe("可做但需控制成本");
  });

  it("Case 1b: 儿童磁力积木玩具（组合命中儿童+磁性+小部件）→ 「新手不建议做」或「暂不建议做」", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "可做但需控制成本",
        productName: "儿童磁力积木拼装玩具",
        category: "玩具乐器",
        description: "磁铁积木，适合3岁以上儿童，含小零件",
        sourcingSuggestedEntryLevel: "experienced",
        sourcingComplianceBarrier: "high",
      })
    );

    expect(result.downgraded).toBe(true);
    // 至少「新手不建议做」
    const conservativeRank = ["新手不建议做", "暂不建议做"];
    expect(conservativeRank).toContain(result.safeVerdict);
    expect(result.downgradeReasons.length).toBeGreaterThanOrEqual(1);
  });

  // ── Case 2: 食品接触硅胶杯/饭盒，材质认证未知 → 不能推荐 ──

  it("Case 2: 硅胶折叠水杯（食品接触）→ AI 给「新手可小单测试」时应降级", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "新手可小单测试",
        productName: "硅胶折叠水杯",
        category: "户外用品",
        description: "食品级硅胶材质，可折叠收纳，容量350ml",
      })
    );

    expect(result.downgraded).toBe(true);
    // 关键词命中"食品接触"相关 → 至少「可做但需控制成本」
    expect(result.safeVerdict).not.toBe("新手可小单测试");
    expect(result.downgradeReasons.some((r) => r.includes("食品接触"))).toBe(true);
  });

  it("Case 2b: 食品接触饭盒 + 风险排查 yellow → 不能再给推荐", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "新手可小单测试",
        productName: "不锈钢保温饭盒",
        category: "家居日用",
        description: "双层真空不锈钢饭盒，食品接触级304不锈钢",
        riskOverallLevel: "yellow",
      })
    );

    expect(result.downgraded).toBe(true);
    expect(result.safeVerdict).not.toBe("新手可小单测试");
  });

  // ── Case 3: 带电池小风扇/电热杯 → 不能推荐 ──

  it("Case 3: 带电池迷你风扇 → AI 给「新手可小单测试」时应降级到「新手不建议做」", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "新手可小单测试",
        productName: "USB充电迷你便携风扇",
        category: "3C数码",
        description: "内置锂电池，三档风速，USB-C充电，续航8小时",
      })
    );

    expect(result.downgraded).toBe(true);
    expect(result.safeVerdict).toBe("新手不建议做");
    expect(result.downgradeReasons.some((r) => r.includes("电池"))).toBe(true);
  });

  it("Case 3b: 电热杯（加热+电器组合）→ 应降级到「新手不建议做」或更保守", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "可做但需控制成本",
        productName: "便携电热杯",
        category: "家居日用",
        description: "智能温控电热水杯，加热保温一体，350ml容量",
      })
    );

    expect(result.downgraded).toBe(true);
    const conservative = ["新手不建议做", "暂不建议做"];
    expect(conservative).toContain(result.safeVerdict);
  });

  // ── Case 4: 普通桌面收纳盒，无强风险 → 可保留原 verdict ──

  it("Case 4: 普通桌面收纳盒 → 如果 AI 给推荐且无风险命中，应保持推荐", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "新手可小单测试",
        productName: "简约桌面收纳盒",
        category: "家居日用",
        description: "PP材质，多格分区，适合桌面文具和小物件收纳",
        riskOverallLevel: "green",
        sourcingBeginnerFit: "high",
        sourcingSuggestedEntryLevel: "beginner",
        sourcingComplianceBarrier: "low",
        sourcingLogisticsDifficulty: "low",
        sourcingAfterSalesRisk: "low",
      })
    );

    // 无强风险命中 + 所有字段绿色 → 可以保持推荐
    expect(result.downgraded).toBe(false);
    expect(result.safeVerdict).toBe("新手可小单测试");
    expect(result.downgradeReasons.length).toBe(0);
  });

  it("Case 4b: 宠物梳子（无入口/食品接触风险）→ 可保留推荐", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "新手可小单测试",
        productName: "宠物去浮毛梳",
        category: "宠物用品",
        description: "不锈钢针梳，适合短毛猫狗日常梳理，人体工学手柄",
        riskOverallLevel: "green",
        sourcingBeginnerFit: "high",
        sourcingComplianceBarrier: "low",
      })
    );

    // 宠物梳子 不是 宠物入口/食品接触 → 不触发规则
    expect(result.downgraded).toBe(false);
    expect(result.safeVerdict).toBe("新手可小单测试");
  });

  // ── Case 5: 信息不足，模糊输入 → 不能直接推荐 ──

  it("Case 5: 信息不足「网红同款神器」→ 应降级，不能给「新手可小单测试」", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "新手可小单测试",
        productName: "网红同款神器",
        description: "",
      })
    );

    // 信息不足（名称太短，无品类/描述/结构化数据）→ 应降级
    expect(result.downgraded).toBe(true);
    expect(result.safeVerdict).not.toBe("新手可小单测试");
    expect(result.downgradeReasons.length).toBeGreaterThan(0);
  });

  it("Case 5b: 只有「爆款单品」四个字 → 信息不足", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "新手可小单测试",
        productName: "爆款",
        description: "单品",
      })
    );

    // 名称只有2个字符 → 不足
    expect(result.downgraded).toBe(true);
  });

  // ── 额外覆盖 ──

  it("风险排查 red → 无论 AI 说什么，至少「暂不建议做」", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "新手可小单测试",
        productName: "某普通商品名",
        category: "家居日用",
        description: "看起来没问题的普通收纳产品",
        riskOverallLevel: "red",
        riskBlacklistMatches: ["医疗器械"],
      })
    );

    expect(result.safeVerdict).toBe("暂不建议做");
    expect(result.downgraded).toBe(true);
  });

  it("侵权关键词 → 「暂不建议做」", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "可做但需控制成本",
        productName: "迪士尼同款卡通水杯",
        category: "家居日用",
        description: "迪士尼风格设计，卡通角色图案",
      })
    );

    expect(result.safeVerdict).toBe("暂不建议做");
    expect(result.downgradeReasons.some((r) => r.includes("侵权"))).toBe(true);
  });

  it("磁性产品 → 「新手不建议做」", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "可做但需控制成本",
        productName: "磁吸手机支架",
        category: "3C数码",
        description: "强磁吸附，车载手机支架",
      })
    );

    expect(result.safeVerdict).toBe("新手不建议做");
  });

  it("AI 返回无效 verdict → 使用保守默认值并降级", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "随便写的不合法值",
        productName: "普通商品",
        category: "家居日用",
        description: "一个正常描述",
      })
    );

    expect(result.downgraded).toBe(true);
    expect(result.safeVerdict).toBe("可做但需控制成本");
  });

  it("降级原因不重复", () => {
    const result = applyHardGuard(
      baseInput({
        aiVerdict: "新手可小单测试",
        productName: "儿童USB充电迷你风扇",
        category: "母婴用品",
        description: "儿童风扇 儿童风扇 婴儿 婴儿", // 多次命中同一规则
        riskOverallLevel: "red",
      })
    );

    // 检查降级原因没有重复
    const uniqueReasons = [...new Set(result.downgradeReasons)];
    expect(result.downgradeReasons).toEqual(uniqueReasons);
    // 应被降级到很保守
    expect(result.safeVerdict).toBe("暂不建议做");
  });
});
