import { describe, expect, it } from "vitest";
import { validateCopyQualityContract } from "@/lib/listingHandoff/listingRuntimeSkill";

describe("Copy Quality 红测：坏稿必须判不合格", () => {
  // HydroJug 坏稿复现（任务书锁定四句）
  const BAD_BULLETS = [
    "The straw lid option fits the everyday use of this Tumbler.",
    "The Tumbler pairs with the Tumbler for everyday use.",
    "Easy cleaning matches the dishwasher safe option for this Tumbler.",
    "Available construction with the Tumbler of this Tumbler.",
  ];
  const FACTS = [
    { factId: "functional_feature", field: "functional_feature", label: "功能特性", value: "Leak Proof, Water Bottle" },
    { factId: "construction", field: "construction", label: "构造/做工", value: "Tumbler" },
    { factId: "care", field: "care", label: "清洁保养", value: "dishwasher safe" },
  ];

  it("红：option fits 模板句 → template_jargon", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: BAD_BULLETS,
      description: "The HydroJug Tumbler with a straw lid for daily use. It has a leak proof water bottle feature.",
      facts: FACTS,
      typeLabel: "Tumbler",
      cannotSay: ["leakproof"],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "template_jargon")).toBe(true);
  });

  it("红：Tumbler pairs with Tumbler → self_reference / subject_object_duplicate", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: ["The Tumbler pairs with the Tumbler for everyday use."],
      description: "A Tumbler for daily use.",
      facts: FACTS,
      typeLabel: "Tumbler",
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "self_reference")).toBe(true);
  });

  it("红：Leak Proof 命中 cannotSay（同义规范化）", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: ["The leak proof option fits the everyday use of this Tumbler."],
      description: "A Tumbler for daily use.",
      facts: FACTS,
      typeLabel: "Tumbler",
      cannotSay: ["leakproof"],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "cannot_say")).toBe(true);
  });

  it("红：duplicate_shopper_need — 两角色同一 shopperNeed → 不合格", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: ["Good bullet one with the Tumbler.", "Good bullet two with the Tumbler."],
      description: "A Tumbler for daily use.",
      facts: FACTS,
      typeLabel: "Tumbler",
      bulletPlans: [
        { role: "core_outcome", shopperNeed: "日常使用需求", featureFactIds: ["functional_feature"] },
        { role: "ease_of_use", shopperNeed: "日常使用需求", featureFactIds: ["care"] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "duplicate_shopper_need")).toBe(true);
  });

  it("红：好稿（自然、互异、锚定事实）→ copy quality ok", () => {
    const goodFacts = [
      { factId: "functional_feature", field: "functional_feature", label: "功能特性", value: "straw lid with push-open mechanism" },
      { factId: "construction", field: "construction", label: "构造/做工", value: "double-wall vacuum insulation" },
      { factId: "care", field: "care", label: "清洁保养", value: "dishwasher safe" },
    ];
    const good = validateCopyQualityContract({
      title: "HydroJug 40oz Tumbler",
      bullets: [
        "The straw lid with push-open mechanism makes one-handed drinking easy.",
        "Double-wall vacuum insulation keeps drinks cold for hours without sweat.",
        "Dishwasher safe parts make cleaning quick after every use.",
      ],
      description: "This 40oz tumbler keeps beverages cold all day. The straw lid works for driving or gym use. Rinse and load the parts into the dishwasher.",
      facts: goodFacts,
      typeLabel: "Tumbler",
      cannotSay: ["leakproof"],
      bulletPlans: [
        { role: "core_outcome", shopperNeed: "单手饮用", featureFactIds: ["functional_feature"] },
        { role: "proof_or_fit", shopperNeed: "保冷时长", featureFactIds: ["construction"] },
        { role: "ease_of_use", shopperNeed: "快速清洁", featureFactIds: ["care"] },
      ],
    });
    expect(good.ok).toBe(true);
  });
});

describe("反向验证（防作弊）", () => {
  it("反向②：临时恢复 pairs with 模板 → Copy Quality 必须红", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: ["This Tumbler pairs with the Tumbler for easy use."],
      description: "A Tumbler for daily use.",
      facts: [{ factId: "included_components", field: "included_components", label: "组件", value: "Tumbler" }],
      typeLabel: "Tumbler",
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "subject_object_duplicate" || i.code === "template_jargon")).toBe(true);
  });

  it("反向③：复制同一 shopperNeed 到两角色 → 计划 Copy Quality 红", () => {
    const r = validateCopyQualityContract({
      title: "HydroJug Tumbler",
      bullets: ["Bullet one with Tumbler.", "Bullet two with Tumbler."],
      description: "Tumbler for daily use.",
      facts: [{ factId: "functional_feature", field: "functional_feature", label: "功能", value: "leakproof" }],
      typeLabel: "Tumbler",
      bulletPlans: [
        { role: "core_outcome", shopperNeed: "相同需求", featureFactIds: ["functional_feature"] },
        { role: "ease_of_use", shopperNeed: "相同需求", featureFactIds: ["functional_feature"] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "duplicate_shopper_need")).toBe(true);
  });

  it("反向①：Leak Proof 改词（同义）仍被 Claim Policy 拦截（prohibited）", async () => {
    const { classifyClaimPolicy } = await import("@/lib/listingHandoff/listingClaimPolicy");
    const verdict = classifyClaimPolicy({
      field: "functional_feature",
      value: "Leak Proof, Water Bottle",
      explicitHighRiskConfirmed: true,
      prohibited: ["leakproof"],
    });
    expect(verdict.tier).toBe("prohibited");
  });
});
