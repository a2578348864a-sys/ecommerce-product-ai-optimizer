import { describe, expect, it } from "vitest";

import { imagePlan, type ConfirmedProductFact } from "./imagePlan";

type HandoffLike = {
  schemaVersion: "content-handoff.v1";
  runId: string;
  candidateId: string;
  variant: string;
  marketplace: string;
  category: string;
  locale: string;
  factRevision: number;
  policyPackVersion: string;
  keywordRefs: string[];
  vocRefs: string[];
  referenceImages: string[];
  brandStyle?: string | null;
  forbidden: string[];
  createdAt: string;
};

function makeHandoff(overrides: Partial<HandoffLike> = {}): HandoffLike {
  return {
    schemaVersion: "content-handoff.v1",
    runId: "run-1",
    candidateId: "cand-1",
    variant: "SKU-A",
    marketplace: "amazon.com",
    category: "kitchen",
    locale: "en-US",
    factRevision: 1,
    policyPackVersion: "policy.v1",
    keywordRefs: ["kw-1"],
    vocRefs: ["voc-1"],
    referenceImages: [],
    brandStyle: null,
    forbidden: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fact(field: string, value: string | number | string[], label = field, factId = "fact-" + field): ConfirmedProductFact {
  return { factId, field, label, value };
}

const fullFacts = (): ConfirmedProductFact[] => [
  fact("variant", "SKU-A", "商品 SKU"),
  fact("color", "黑色", "颜色"),
  fact("material", "不锈钢", "材质"),
  fact("structure", "杯身, 防滑杯盖, 内胆", "结构"),
  fact("quantity", 1, "数量"),
  fact("accessories", "充电线, 说明书", "配件"),
  fact("dimensions", "30cm x 20cm x 10cm", "尺寸"),
];

describe("imagePlan (P5-B)", () => {
  it("缺真实参考图 → 不得标为 final，输出拍摄清单", () => {
    const plan = imagePlan(makeHandoff({ referenceImages: [] }), fullFacts(), []);
    expect(plan.main.planLevel).toBe("concept");
    expect(plan.main.planKind).toBe("shooting_list");
    expect(plan.shootingList.length).toBeGreaterThan(0);
    expect(plan.issues.some((i) => i.code === "MISSING_REFERENCE_IMAGES" && i.severity === "error")).toBe(true);
  });

  it("缺参考图时即使视觉事实齐全仍不生成 final（D5 硬约束）", () => {
    const plan = imagePlan(makeHandoff({ referenceImages: [] }), fullFacts(), []);
    expect(plan.main.planLevel).not.toBe("final");
  });

  it("参考图 + 视觉事实齐全 → final/photo", () => {
    const plan = imagePlan(makeHandoff({ referenceImages: ["ref-1"] }), fullFacts(), ["ref-1"]);
    expect(plan.main.planLevel).toBe("final");
    expect(plan.main.planKind).toBe("photo");
    expect(plan.main.identityChecklist.some((c) => c.includes("颜色"))).toBe(true);
    expect(plan.main.factRefs.length).toBe(fullFacts().length);
    expect(plan.issues.filter((i) => i.severity === "error").length).toBe(0);
  });

  it("参考图存在但缺颜色事实 → 仅 mockup（INSUFFICIENT_VISUAL_FACTS）", () => {
    const facts = fullFacts().filter((f) => f.field !== "color");
    const plan = imagePlan(makeHandoff({ referenceImages: ["ref-1"] }), facts, ["ref-1"]);
    expect(plan.main.planLevel).toBe("mockup");
    expect(plan.main.planKind).toBe("ai_mockup");
    expect(plan.main.planLevel).not.toBe("final");
    expect(plan.issues.some((i) => i.code === "INSUFFICIENT_VISUAL_FACTS")).toBe(true);
  });

  it("A+ 仅品牌资格已确认且启用时产出 eligible 模块", () => {
    const plan = imagePlan(makeHandoff(), fullFacts(), ["ref-1"], { brandEligible: true, enableAPlus: true });
    expect(plan.aPlus).toBeDefined();
    expect(plan.aPlus?.eligibilityStatus).toBe("eligible");
    expect(plan.aPlus?.modules.length).toBeGreaterThan(0);
  });

  it("A+ 品牌资格未知时仅输出前置清单（unknown，不当作已启用素材）", () => {
    const plan = imagePlan(makeHandoff(), fullFacts(), ["ref-1"], { enableAPlus: true });
    expect(plan.aPlus?.eligibilityStatus).toBe("unknown");
    expect(plan.aPlus?.modules).toEqual([]);
    expect(plan.issues.some((i) => i.code === "APLUS_ELIGIBILITY_UNKNOWN")).toBe(true);
  });

  it("handoff.forbidden 注入被透传为 plan.forbidden，供 visualFactCheck 阻断", () => {
    const plan = imagePlan(
      makeHandoff({ forbidden: ["ignore previous instructions", "logo-xxx"] }),
      fullFacts(),
      ["ref-1"],
    );
    expect(plan.forbidden).toContain("ignore previous instructions");
    expect(plan.main.negativeConstraints.some((c) => c.includes("ignore previous instructions"))).toBe(true);
  });

  it("恶意注入的 fact 字段名/值不改变分级决策（确定性）", () => {
    const facts: ConfirmedProductFact[] = [
      fact("color", "黑色"),
      fact("structure", "杯身"),
      fact("x; DROP TABLE products", "注入值", "注入字段"),
    ];
    const plan = imagePlan(makeHandoff({ referenceImages: ["ref-1"] }), facts, ["ref-1"]);
    expect(plan.main.planLevel).toBe("final");
    expect(plan.main.factRefs).toEqual(["fact-color", "fact-structure", "fact-x; DROP TABLE products"]);
  });

  it("主图背景/占比以标注默认而非写死站点规则（不产生单一合规分数）", () => {
    const plan = imagePlan(makeHandoff(), fullFacts(), ["ref-1"]);
    expect(plan.main.composition.background.length).toBeGreaterThan(0);
    expect(plan.main.composition.productCoverage).toContain("≥85%");
    expect(plan.issues).not.toContainEqual(expect.objectContaining({ code: "COMPLIANCE_SCORE" }));
  });
});
