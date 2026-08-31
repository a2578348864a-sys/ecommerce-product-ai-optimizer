import { describe, expect, it } from "vitest";
import { classifyClaimTier } from "@/lib/listingHandoff/listingClaimTier";

describe("轮 16：Claim 三级判定", () => {
  it("直接事实 → verified", () => {
    const r = classifyClaimTier(["Extra-wide slots fit thick bread."], ["extra-wide slots fit thick bread"]);
    expect(r[0].tier).toBe("verified");
  });

  it("依附已确认功能的低风险价值表达 → review（保留并提醒）", () => {
    const r = classifyClaimTier(["Cord wrap storage makes the countertop tidy."], ["cord wrap storage keeps countertop tidy"]);
    expect(r[0].tier).toBe("review");
    expect(r[0].reason).toContain("人工确认");
  });

  it("无事实支持新增硬属性 → blocked（stainless steel 无材质事实）", () => {
    const r = classifyClaimTier(["Made with durable stainless steel construction."], ["toaster"]);
    expect(r[0].tier).toBe("blocked");
  });

  it("绝对承诺/疗效 → blocked", () => {
    const r = classifyClaimTier(["The best toaster you will ever own."], ["toaster"]);
    expect(r[0].tier).toBe("blocked");
  });

  it("已确认事实值直接陈述（含属性词）+ 值匹配 → verified", () => {
    const r = classifyClaimTier(["Stainless steel construction."], ["stainless steel construction"]);
    expect(r[0].tier).toBe("verified");
  });

  it("无事实锚点的泛化营销句 → blocked（不得默认 review）", () => {
    const r = classifyClaimTier(["Perfect for busy family mornings."], ["stainless steel", "12 oz", "dishwasher-safe bottle and lid"]);
    expect(r[0].tier).toBe("blocked");
  });

  it("无事实锚点的氛围话术 → blocked（不得默认 verified）", () => {
    const r = classifyClaimTier(["Adds cheerful style to every kitchen."], ["stainless steel", "12 oz"]);
    expect(r[0].tier).toBe("blocked");
  });

  it("假认证、无依据防漏 → blocked", () => {
    const r = classifyClaimTier(
      ["FDA certified for your family.", "100% leakproof lid."],
      ["stainless steel", "12 oz", "dishwasher-safe bottle and lid"],
    );
    expect(r[0].tier).toBe("blocked");
    expect(r[1].tier).toBe("blocked");
  });

  it("无依据性能词（spill-resistant）即使含品牌词也不得放行 → blocked", () => {
    const r = classifyClaimTier(
      ["The Owala FreeSip bottle offers a spill-resistant drinking experience and is easy to carry and store."],
      ["24 oz", "Stainless Steel", "straw lid", "push-open mechanism", "dishwasher-safe removable parts", "double-wall vacuum insulation"],
    );
    expect(r[0].tier).toBe("blocked");
  });

  it("低风险表达含已确认功能锚点 → review 保留", () => {
    const r = classifyClaimTier(
      ["The dishwasher-safe bottle and lid make everyday cleaning simple and convenient."],
      ["dishwasher-safe bottle and lid", "stainless steel", "12 oz"],
    );
    expect(r[0].tier).toBe("review");
  });
});

describe("FAILURE_ATTRIBUTION 判定（身份锚点验证）", () => {
  const CONFIRMED = [
    "Stainless Steel",
    "24 oz",
    "straw lid with push-open mechanism",
    "double-wall vacuum insulation",
    "dishwasher-safe removable parts",
  ];

  it("行为1：'Stainless Steel is the material of this Water Bottle.' + 值集 → 应为 verified", () => {
    const r = classifyClaimTier(["Stainless Steel is the material of this Water Bottle."], CONFIRMED);
    // 记录真实结果（供判定），断言事实：值在句中 -> 应为 verified
    expect(r[0].tier).toBe("verified");
  });

  it("行为2：'24 oz is the capacity of this Water Bottle.' + 值集 → 应为 verified（DIMENSION 特判）", () => {
    const r = classifyClaimTier(["24 oz is the capacity of this Water Bottle."], CONFIRMED);
    expect(r[0].tier).toBe("verified");
  });

  it("行为3（已收紧）：'Water Bottle' 仅传非身份值集（无 brand/product_type/series）→ 必须 blocked + 原因含无锚点", () => {
    const nonIdentityValues = CONFIRMED; // 生成链 tierInput 传的非身份事实值
    const r = classifyClaimTier(["Water Bottle"], nonIdentityValues);
    expect(r[0].tier).toBe("blocked");
    expect(r[0].reason ?? "").toContain("无已确认事实锚点");
  });
});
