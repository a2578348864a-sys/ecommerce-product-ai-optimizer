/**
 * Listing Capability V2 —— 事实支撑 Bullet 能力合同（纯函数）测试。
 *
 * 合同边界：
 * - 消费已通过 listingClaimPolicy 裁决的事实（tier = verified / review / prohibited）；
 *   本模块不复制、不另造禁词/高风险规则。
 * - 只有 verified 且非空事实参与能力计算；review / prohibited / 未知字段不得增加 Bullet 数。
 * - 固定分组；同一卖点组最多贡献一条核心 Bullet；颜色/变体（secondary_variant）
 *   不增加正式 Bullet 数；supportedBulletCount 最大为 5。
 * - 纯函数：无 DB/文件/env/网络/Provider/日期/随机；同输入同输出。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateListingCapability,
  isTrivialSingleUnitSelfReference,
  claimGroupOfField,
  isTrivialSingleUnitQuantity,
  CORE_CLAIM_GROUPS,
  type ListingCapabilityFact,
} from "@/lib/listingHandoff/listingCapabilityV2";

function fact(
  factId: string,
  field: string,
  value: string,
  tier: ListingCapabilityFact["tier"] = "verified",
): ListingCapabilityFact {
  return { factId, field, value, tier };
}

describe("ListingCapabilityV2 能力合同", () => {
  it("空事实：facts_only，canCallProvider=false，hasIdentity=false", () => {
    const r = evaluateListingCapability({ facts: [] });
    expect(r.level).toBe("facts_only");
    expect(r.supportedBulletCount).toBe(0);
    expect(r.targetBulletCount).toBe(0);
    expect(r.canCallProvider).toBe(false);
    expect(r.hasIdentity).toBe(false);
    expect(r.isBlocked).toBe(false);
  });

  it("仅身份事实（brand）：hasIdentity=true 但 0 核心组 → facts_only，canCallProvider=false", () => {
    const r = evaluateListingCapability({
      facts: [fact("f1", "brand", "ThermoBrand")],
    });
    expect(r.hasIdentity).toBe(true);
    expect(r.level).toBe("facts_only");
    expect(r.supportedBulletCount).toBe(0);
    expect(r.canCallProvider).toBe(false);
    expect(r.eligibleGroups.map((g) => g.group)).toEqual(["identity"]);
  });

  it("1 个核心组 → facts_only，canCallProvider=false", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
      ],
    });
    expect(r.hasIdentity).toBe(true);
    expect(r.level).toBe("facts_only");
    expect(r.supportedBulletCount).toBe(1);
    expect(r.canCallProvider).toBe(false);
    expect(r.targetBulletCount).toBe(0);
  });

  it("2 个核心组 → partial_draft，targetBulletCount=2，canCallProvider=false", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f3", "capacity", "10 oz"),
      ],
    });
    expect(r.level).toBe("partial_draft");
    expect(r.supportedBulletCount).toBe(2);
    expect(r.targetBulletCount).toBe(2);
    expect(r.canCallProvider).toBe(false);
  });

  it("3 个核心组 → standard_draft，target=3，canCallProvider=true", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f3", "capacity", "10 oz"),
        fact("f4", "functional_feature", "Vacuum Insulated"),
      ],
    });
    expect(r.level).toBe("standard_draft");
    expect(r.supportedBulletCount).toBe(3);
    expect(r.targetBulletCount).toBe(3);
    expect(r.canCallProvider).toBe(true);
  });

  it("4 个核心组 → standard_draft，target=4，canCallProvider=true", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f3", "capacity", "10 oz"),
        fact("f4", "functional_feature", "Vacuum Insulated"),
        fact("f5", "usage", "School Lunch"),
      ],
    });
    expect(r.level).toBe("standard_draft");
    expect(r.supportedBulletCount).toBe(4);
    expect(r.targetBulletCount).toBe(4);
    expect(r.canCallProvider).toBe(true);
  });

  it("5 个核心组 → full_draft，target=5，canCallProvider=true", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f3", "capacity", "10 oz"),
        fact("f4", "functional_feature", "Vacuum Insulated"),
        fact("f5", "usage", "School Lunch"),
        fact("f6", "care", "Dishwasher Safe"),
      ],
    });
    expect(r.level).toBe("full_draft");
    expect(r.supportedBulletCount).toBe(5);
    expect(r.targetBulletCount).toBe(5);
    expect(r.canCallProvider).toBe(true);
  });

  it("6 个核心组 → full_draft，supportedBulletCount 封顶 5，target=5", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "material", "Stainless Steel"),
        fact("f2", "capacity", "10 oz"),
        fact("f3", "functional_feature", "Vacuum Insulated"),
        fact("f4", "usage", "School Lunch"),
        fact("f5", "care", "Dishwasher Safe"),
        fact("f6", "included_components", "Folding Spoon"),
        fact("f7", "certification", "FDA"),
      ],
    });
    expect(r.level).toBe("full_draft");
    expect(r.supportedBulletCount).toBe(5);
    expect(r.targetBulletCount).toBe(5);
  });

  it("同组多个事实合并为 1 组：只 +1，且保留全部去重后的 factId", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f3", "construction", "Double Wall"),
        fact("f3", "construction", "Double Wall"), // 同一 factId 重复出现
        fact("f4", "capacity", "10 oz"),
        fact("f4", "capacity", "10 oz"),
      ],
    });
    const matGroup = r.eligibleGroups.find((g) => g.group === "material_construction");
    expect(matGroup).toBeTruthy();
    expect([...new Set(matGroup!.factIds)].sort()).toEqual(["f2", "f3"]);
    expect(r.supportedBulletCount).toBe(2); // material+capacity = 2 组
  });

  it("review 事实不计数：核心组只有 review 事实 → 该组不算可用，且进入 missing", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
      ],
    });
    const reviewOnly = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f5", "insulation", "Keeps warm 12 hours", "review"),
      ],
    });
    // material 组 verified 可用 1 组；insulation 属 core_function_operation 组但 review → 不计数
    expect(reviewOnly.supportedBulletCount).toBe(r.supportedBulletCount);
    expect(reviewOnly.missingClaimGroups).toContain("core_function_operation");
  });

  it("prohibited 事实不计数：核心组只有 prohibited 事实 → 该组不算可用", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
      ],
    });
    const prohibitedOnly = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f3", "capacity", "100% BPA-Free", "prohibited"),
      ],
    });
    expect(prohibitedOnly.supportedBulletCount).toBe(r.supportedBulletCount);
    expect(prohibitedOnly.missingClaimGroups).toContain("size_capacity_fit");
  });

  it("颜色/变体不计数：secondary_variant 有 verified 事实也不增加 supportedBulletCount", () => {
    const base = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f3", "capacity", "10 oz"),
      ],
    });
    const withColor = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f3", "capacity", "10 oz"),
        fact("f4", "color_or_variant", "Pink"),
      ],
    });
    expect(withColor.supportedBulletCount).toBe(base.supportedBulletCount);
    expect(withColor.eligibleGroups.map((g) => g.group)).toContain("secondary_variant");
  });

  it("无身份事实：3 个核心组 → level 仍 standard_draft，但 canCallProvider=false", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "material", "Stainless Steel"),
        fact("f2", "capacity", "10 oz"),
        fact("f3", "functional_feature", "Vacuum Insulated"),
      ],
    });
    expect(r.hasIdentity).toBe(false);
    expect(r.level).toBe("standard_draft");
    expect(r.supportedBulletCount).toBe(3);
    expect(r.canCallProvider).toBe(false);
  });

  it("已知字段但 tier 未知枚举不参与：未知 tier 当 review 处理不计数", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        { factId: "f3", field: "capacity", value: "10 oz", tier: "unknown" as never },
      ],
    });
    expect(r.supportedBulletCount).toBe(1);
    expect(r.missingClaimGroups).toContain("size_capacity_fit");
  });

  it("hasBlockingIssue=true：isBlocked=true、canCallProvider=false，但仍如实返回可用组和数量", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f3", "capacity", "10 oz"),
        fact("f4", "functional_feature", "Vacuum Insulated"),
      ],
      hasBlockingIssue: true,
    });
    expect(r.isBlocked).toBe(true);
    expect(r.canCallProvider).toBe(false);
    expect(r.supportedBulletCount).toBe(3); // 仍如实返回
    expect(r.level).toBe("standard_draft");
    expect(r.eligibleGroups.length).toBeGreaterThan(0);
  });

  it("suggestedQuestions 最多 3 个，顺序固定，且不询问已具备的组", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
      ],
    });
    // 缺失：size_capacity_fit、core_function_operation、use_scenario、care_cleaning、package_contents、proof_performance
    expect(r.suggestedQuestions.length).toBe(3);
    expect(r.suggestedQuestions[0]).toContain("容量");
    expect(r.suggestedQuestions[1]).toContain("功能特性");
    expect(r.suggestedQuestions[2]).toContain("使用场景");
    // 已具备的组不得被询问
    for (const q of r.suggestedQuestions) {
      expect(q).not.toContain("材质");
    }
  });

  it("CORE_CLAIM_GROUPS 固定且 identity/secondary_variant 不在其中", () => {
    expect(CORE_CLAIM_GROUPS).toEqual([
      "material_construction",
      "size_capacity_fit",
      "core_function_operation",
      "use_scenario",
      "care_cleaning",
      "package_contents",
      "proof_performance",
    ]);
  });

  it("相同输入深度相等（同输入同输出 / 纯函数）", () => {
    const input = {
      facts: [
        fact("f1", "brand", "ThermoBrand"),
        fact("f2", "material", "Stainless Steel"),
        fact("f3", "capacity", "10 oz"),
      ],
    };
    expect(evaluateListingCapability(input)).toEqual(evaluateListingCapability(input));
  });
});

describe("dimensions 权威字段映射（canonical：dimensions；历史别名：dimension）", () => {
  it("claimGroupOfField(dimensions) === size_capacity_fit；dimension 兼容不变", () => {
    expect(claimGroupOfField("dimensions")).toBe("size_capacity_fit");
    expect(claimGroupOfField("dimension")).toBe("size_capacity_fit");
  });

  it("brand+product_type+material+dimensions(5 in)+usage → dimensions 计入 size_capacity_fit、supportedBulletCount=3、Plan 可消费、missing 不含该组", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "Acme"),
        fact("f2", "product_type", "Water Bottle"),
        fact("f3", "material", "Plastic"),
        fact("f4", "dimensions", "5 in"),
        fact("f5", "usage", "Home"),
      ],
    });
    const sizeGroup = r.eligibleGroups.find((g) => g.group === "size_capacity_fit");
    expect(sizeGroup?.factIds).toEqual(["f4"]);
    expect(r.supportedBulletCount).toBe(3); // material + size_capacity_fit + use_scenario
    expect(r.missingClaimGroups).not.toContain("size_capacity_fit");
    // 不改变 identity / secondary_variant / 其他组规则
    expect(r.hasIdentity).toBe(true);
    expect(r.eligibleGroups.map((g) => g.group)).not.toContain("secondary_variant");
    expect(CORE_CLAIM_GROUPS.includes("size_capacity_fit")).toBe(true);
  });
});

describe("isTrivialSingleUnitQuantity：1 Count 假卖点隔离（有界单件默认值）", () => {
  it("1 Count / 1 count / 1Ct → true（单件默认数量无消费者选择价值）", () => {
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", "1 Count")).toBe(true);
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", "1 count")).toBe(true);
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", " 1 Count ")).toBe(true);
  });

  it("其他字段不适用（只处理 quantity_or_pack_size）", () => {
    expect(isTrivialSingleUnitQuantity("capacity", "1 Count")).toBe(false);
    expect(isTrivialSingleUnitQuantity("included_components", "1 Count")).toBe(false);
    expect(isTrivialSingleUnitQuantity("", "1 Count")).toBe(false);
  });

  it("多件/组合装不得被误杀", () => {
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", "10 Count")).toBe(false);
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", "12 Count")).toBe(false);
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", "21 Count")).toBe(false);
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", "2-pack set")).toBe(false);
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", "1 set with 3 pieces")).toBe(false);
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", "1.5 L")).toBe(false);
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", "Pack of 2")).toBe(false);
    expect(isTrivialSingleUnitQuantity("quantity_or_pack_size", "Single Unit")).toBe(false);
  });
});

describe("1 Count 不形成正式卖点（Capability 层隔离）", () => {
  const ONE_COUNT_FACTS = [
    fact("f1", "brand", "Acme"),
    fact("f2", "product_type", "Water Bottle"),
    fact("f3", "material", "Plastic"),
    fact("f4", "capacity", "12 oz"),
    fact("f5", "quantity_or_pack_size", "1 Count"),
  ];

  it("1 Count 不单独形成 package_contents 卖点组；supportedBulletCount=2；缺失组含 package_contents", () => {
    const r = evaluateListingCapability({ facts: ONE_COUNT_FACTS });
    expect(r.eligibleGroups.map((g) => g.group)).not.toContain("package_contents");
    expect(r.supportedBulletCount).toBe(2); // material + size_capacity_fit
    expect(r.missingClaimGroups).toContain("package_contents");
  });

  it("1 Count 事实仍被保留为已确认事实（内部确认不删除），只是不组卖点", () => {
    const r = evaluateListingCapability({ facts: ONE_COUNT_FACTS });
    // 不因 1 Count 提升能力：与完全无该事实的输入等价
    const base = evaluateListingCapability({ facts: ONE_COUNT_FACTS.filter((f) => f.factId !== "f5") });
    expect(r.supportedBulletCount).toBe(base.supportedBulletCount);
    expect(r.level).toBe(base.level);
    // eligibleGroups 也不得包含 package_contents
    expect(r.eligibleGroups.some((g) => g.group === "package_contents")).toBe(false);
  });

  it("2-pack set 不被误杀：仍形成 package_contents 卖点组", () => {
    const r = evaluateListingCapability({
      facts: [fact("f1", "brand", "Acme"), fact("f2", "product_type", "Water Bottle"),
        fact("f3", "material", "Plastic"), fact("f4", "capacity", "12 oz"),
        fact("f5", "quantity_or_pack_size", "2-pack set")],
    });
    const pkg = r.eligibleGroups.find((g) => g.group === "package_contents");
    expect(pkg?.factIds).toEqual(["f5"]);
    expect(r.supportedBulletCount).toBe(3);
  });

  it("高风险复合功能值不占可渲染能力组", () => {
    const r = evaluateListingCapability({
      facts: [
        fact("f1", "brand", "Acme"),
        fact("f2", "product_type", "Organizer"),
        fact("f3", "material", "Plastic"),
        fact("f4", "functional_feature", "Extra Large Capacity, Expandable, Sturdy, Food Safe, Waterproof"),
      ],
    });
    expect(r.eligibleGroups.map((g) => g.group)).not.toContain("core_function_operation");
    expect(r.supportedBulletCount).toBe(1);
  });
});

describe("低价值单件自身事实（第八版合同）", () => {
  it("included_components 与商品身份同义且数量=1 → 不可渲染", () => {
    expect(isTrivialSingleUnitSelfReference("included_components", "1 Expandable Silverware Organizer", "organizer")).toBe(true);
    expect(isTrivialSingleUnitSelfReference("included_components", "1 plastic organizer", "organizer")).toBe(true);
    expect(isTrivialSingleUnitSelfReference("included_components", "1 Count", "organizer")).toBe(true);
    expect(isTrivialSingleUnitSelfReference("quantity_or_pack_size", "1 Count", "tumbler")).toBe(true);
  });
  it("真配件、多件套、组合装保持可渲染", () => {
    expect(isTrivialSingleUnitSelfReference("included_components", "Lid", "tumbler")).toBe(false);
    expect(isTrivialSingleUnitSelfReference("included_components", "Brush and Adapter", "mixer")).toBe(false);
    expect(isTrivialSingleUnitSelfReference("included_components", "2 Trays", "organizer")).toBe(false);
    expect(isTrivialSingleUnitSelfReference("included_components", "2-pack", "organizer")).toBe(false);
    expect(isTrivialSingleUnitSelfReference("included_components", "organizer tray", "organizer")).toBe(false);
  });
  it("Organizer 夹具：单件自身不进 eligibleGroups，care_cleaning 在", () => {
    const facts: ListingCapabilityFact[] = [
      { factId: "brand", field: "brand", value: "ukeetap", tier: "verified" },
      { factId: "product_type", field: "product_type", value: "Organizer", tier: "verified" },
      { factId: "material", field: "material", value: "Plastic", tier: "verified" },
      { factId: "capacity", field: "capacity", value: "40-50 pieces of cutlery", tier: "verified" },
      { factId: "functional_feature", field: "functional_feature", value: "Expandable design with multiple compartments", tier: "verified" },
      { factId: "usage", field: "usage", value: "stores knives forks and spoons in a kitchen drawer", tier: "verified" },
      { factId: "included_components", field: "included_components", value: "1 Expandable Silverware Organizer", tier: "verified" },
      { factId: "care", field: "care", value: "wipe clean with a damp cloth", tier: "verified" },
    ];
    const result = evaluateListingCapability({ facts });
    const groups = result.eligibleGroups.map((g) => g.group);
    expect(groups).not.toContain("package_contents");
    expect(groups).toContain("care_cleaning");
  });
});