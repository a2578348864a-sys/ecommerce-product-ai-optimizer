import { describe, expect, it } from "vitest";
import {
  validateRuntimeQualityContract,
  buildSafeFactSentences,
  buildRuntimePromptRules,
  LISTING_RUNTIME_SKILL_VERSION,
  type RuntimeQualityInput,
} from "./listingRuntimeSkill";

const THERMOS_FACTS = [
  { factId: "brand", field: "brand", label: "品牌", value: "THERMOS" },
  { factId: "product_type", field: "product_type", label: "商品类型", value: "Food Jar" },
  { factId: "series_or_model", field: "series_or_model", label: "系列/型号", value: "FUNTAINER Kids" },
  { factId: "capacity", field: "capacity", label: "容量", value: "10oz" },
  { factId: "color_or_variant", field: "color_or_variant", label: "颜色/款式", value: "Pink" },
  { factId: "material", field: "material", label: "材质", value: "Stainless Steel" },
  { factId: "functional_feature", field: "functional_feature", label: "功能特性", value: "vacuum insulated" },
  { factId: "care", field: "care", label: "清洁保养", value: "dishwasher safe" },
  { factId: "included_components", field: "included_components", label: "随附组件", value: "unfolding spoon" },
  { factId: "operation", field: "operation", label: "操作方式", value: "latch" },
  { factId: "usage", field: "usage", label: "使用场景", value: "office, home" },
];

function goodInput(over: Partial<RuntimeQualityInput> = {}): RuntimeQualityInput {
  return {
    title: "THERMOS FUNTAINER Kids 10oz Stainless Steel Food Jar, Pink",
    bullets: [
      "The vacuum insulated design keeps food warm for school lunches and travel days.",
      "The dishwasher safe parts make it simple to clean after snacks and meals.",
      "The unfolding spoon makes it easy to eat lunch anywhere with kids.",
      "The latch keeps the lid on tight for offices and trips.",
      "It is a practical pick for office, home use during school days.",
    ],
    description: "The THERMOS Food Jar is made of Stainless Steel and holds 10oz for easy use. The unfolding spoon helps at school lunch time every day. It comes in Pink for everyday use.",
    keywords: ["THERMOS", "Kids Food Jar", "Stainless Steel", "10oz", "Food Jar"],
    facts: THERMOS_FACTS,
    usedFactIds: ["functional_feature", "care", "included_components", "operation", "usage", "material", "capacity"],
    ...over,
  };
}
describe("运行时 Listing Skill：质量合同", () => {
  it("合格 THERMOS 五点（8-30 词、完整句、逐条事实锚点）通过合同", () => {
    const r = validateRuntimeQualityContract(goodInput());
    expect(r.ok).toBe(true);
  });
  it("碎片句（Latch./Office, home.）被拒绝为 fragment", () => {
    const r = validateRuntimeQualityContract(goodInput({ bullets: ["The THERMOS Food Jar is great.", "Latch.", "Office, home.", "The THERMOS Food Jar keeps food warm for school lunches and travel days.", "The THERMOS Food Jar is dishwasher safe for care at home and at work."] }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "fragment")).toBe(true);
  });
  it("标题品牌重复 → 拒绝", () => {
    const r = validateRuntimeQualityContract(goodInput({ title: "THERMOS FUNTAINER Kids 10oz Stainless Steel THERMOS, Pink" }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "brand_repeat")).toBe(true);
  });
  it("关键词大小写不敏感去重（顺序保留），不允许 THERMOS THERMOS", () => {
    const r = validateRuntimeQualityContract(goodInput({ keywords: ["THERMOS", "Kids Food Jar", "Stainless Steel", "10oz", "Food Jar", "THERMOS"] }));
    // 显式重复（含词内 THERMOS THERMOS）→ 应视为重复并拒绝
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "keyword_duplicate")).toBe(true);
    const ok = validateRuntimeQualityContract(goodInput({ keywords: ["THERMOS", "Kids Food Jar", "Stainless Steel", "10oz", "Food Jar"] }));
    expect(ok.ok).toBe(true);
    expect(ok.normalizedKeywords).toEqual(["THERMOS", "Kids Food Jar", "Stainless Steel", "10oz", "Food Jar"]);
  });
  it("描述为属性碎片拼接（1-2 词句）或句数越界 → 拒绝", () => {
    const r1 = validateRuntimeQualityContract(goodInput({ description: "THERMOS. Latch. Office, home. Dishwasher Safe." }));
    expect(r1.ok).toBe(false);
    expect(r1.issues.some((i) => i.code === "description_fragments")).toBe(true);
    const r2 = validateRuntimeQualityContract(goodInput({ description: "The THERMOS Food Jar keeps food warm." }));
    expect(r2.ok).toBe(false);
    expect(r2.issues.some((i) => i.code === "description_sentences")).toBe(true);
  });
  it("bullet 词数越界（<8 或 >30）→ 拒绝", () => {
    const shortBullet = "The THERMOS Food Jar keeps food warm for school lunches and travel days every single day for kids.";
    const r = validateRuntimeQualityContract(goodInput({ bullets: goodInput().bullets.map((b, i) => i === 0 ? "The THERMOS Food Jar keeps warm." : b) }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "too_short")).toBe(true);
    const long = "The THERMOS Food Jar keeps food warm for school lunches and travel days every single day for kids in the morning and afternoon at school or at home and during the evening at work as well, which is a really long sentence for testing.";
    const r2 = validateRuntimeQualityContract(goodInput({ bullets: goodInput().bullets.map((b, i) => i === 0 ? long : b) }));
    expect(r2.ok).toBe(false);
    expect(r2.issues.some((i) => i.code === "too_long")).toBe(true);
    void shortBullet;
  });
});

describe("运行时 Listing Skill：安全兜底句（事实模板）与事实不足", () => {
  it("THERMOS 事实可组 ≥3 条 8-30 词、含事实值的完整句", () => {
    const r = buildSafeFactSentences({ typeLabel: "Food Jar", facts: THERMOS_FACTS });
    console.log("SAFE_B:", JSON.stringify(r.sentences));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sentences.length).toBeGreaterThanOrEqual(3);
      for (const s of r.sentences) {
        const words = s.trim().split(/\s+/).length;
        expect(words).toBeGreaterThanOrEqual(8);
        expect(words).toBeLessThanOrEqual(30);
        expect(/[.!?]$/.test(s.trim())).toBe(true);
        expect(THERMOS_FACTS.some((f) => s.toLowerCase().includes(f.value.toLowerCase()))).toBe(true);
      }
    }
  });
  it("事实不足（仅品牌/颜色）→ 拒绝并有中文原因（暂无合格草稿依据）", () => {
    const r = buildSafeFactSentences({ typeLabel: "Bottle", facts: [THERMOS_FACTS[0], THERMOS_FACTS[4]] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejected.length).toBeGreaterThan(0);
      expect(r.rejected[0].reason).toMatch(/[\u4e00-\u9fff]/);
    }
  });
  it("Prompt 规则包含版本标记与质量合同", () => {
    const rules = buildRuntimePromptRules({ keywordOptimizationEnabled: true, factsCount: 2, hasPlan: true });
    expect(rules).toContain(LISTING_RUNTIME_SKILL_VERSION);
    expect(rules).toContain("QUALITY_CONTRACT");
    expect(rules).toContain("8-30");
    expect(rules).toContain("buyer value");
    expect(rules).toContain("Do not fabricate");
  });
});

describe("安全兜底句互不重复（第1轮：同模板被 0.75 拦截）", () => {
  it("THERMOS 多事实句通过真实合同（无 bullet_duplicate）", () => {
    const r = buildSafeFactSentences({ typeLabel: "Food Jar", facts: THERMOS_FACTS });
    console.log("SAFE_B:", JSON.stringify(r.sentences));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const contract = validateRuntimeQualityContract({
        title: "Thermos Food Jar",
        bullets: r.sentences,
        description: "The Thermos Food Jar with the 10oz for everyday use. This product is made for daily food storage.",
        keywords: [],
        facts: THERMOS_FACTS,
        usedFactIds: THERMOS_FACTS.map((f) => f.factId),
      });
      expect(contract.ok, JSON.stringify(contract.issues)).toBe(true);
    }
  });
});

describe("反向验证③：同模板重复五点必须被 Runtime 合同拦截（0.75 门禁保持关闭）", () => {
  it("7 帧同模板（仅值不同）→ bullet_duplicate 必须命中，合同拒绝", () => {
    const dup = [
      "The Food Jar with the vacuum insulated for everyday use.",
      "The Food Jar with the dishwasher safe for everyday use.",
      "The Food Jar with the unfolding spoon for everyday use.",
      "The Food Jar with the latch for everyday use.",
      "The Food Jar with the office, home for everyday use.",
      "The Food Jar with the stainless steel for everyday use.",
      "The Food Jar with the 10oz for everyday use.",
    ];
    const r = validateRuntimeQualityContract({
      title: "THERMOS Food Jar",
      bullets: dup,
      description: "The THERMOS Food Jar is made of Stainless Steel and holds 10oz for easy use. The unfolding spoon helps at school lunch time every day.",
      keywords: ["THERMOS", "Kids Food Jar"],
      facts: THERMOS_FACTS,
      usedFactIds: THERMOS_FACTS.map((f) => f.factId),
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "bullet_duplicate")).toBe(true);
    // 事件计数：至少 1 对重复被拒绝（同模板 5 条 → 多对命中）
    const dupCount = r.issues.filter((i) => i.code === "bullet_duplicate").length;
    expect(dupCount).toBeGreaterThanOrEqual(1);
  });
});
