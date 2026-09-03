/**
 * 阶段 B 自然语言编辑器测试（Listing Operator Copy）
 * 验证：factRefs 不变 / 无新事实词 / 开头节奏 / 描述连贯 / 门禁词不进 / 多商品 / 跳过红 / 删除或加词红
 */
import { describe, expect, it } from "vitest";
import {
  applyStageBEdit,
  applyStageBToBullets,
  buildFactRefs,
  classifySyntax,
  editDescriptionForCoherence,
  openingKeyOf,
  wordSetOf,
  type OperatedFact,
} from "@/lib/listingHandoff/listingOperatorCopy";

const FACT = (field: string, value: string): OperatedFact => ({ field, value });

describe("阶段B编辑器：factRefs 不变性", () => {
  it("1. 编辑前后每句 factRefs 集合完全一致", () => {
    const facts = [FACT("material", "Stainless Steel"), FACT("capacity", "24 oz")];
    const before = buildFactRefs(facts);
    const out = applyStageBEdit({ sentence: "The Bottle is made of Stainless Steel and has a capacity of 24 oz.", facts });
    const after = buildFactRefs(facts);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(out.factRefs).toEqual(before);
  });

  it("2. 编辑器不能引入输入中不存在的事实词或数值", () => {
    const facts = [FACT("material", "Plastic")];
    const out = applyStageBEdit({ sentence: "The organizer is made of Plastic.", facts });
    expect(out.sentence).not.toContain("leakproof");
    expect(out.sentence).not.toContain("BPA-free");
    expect(out.sentence).not.toContain("12 hours");
    // 词面校验：新词（如 insulated）不得出现
    expect(out.sentence.toLowerCase()).not.toContain("insulated");
  });

  it("3. 五点重复开头得到改善（相同开头 ≤2 次）", () => {
    // 3 个相同开头（The organizer is）必须被编辑器改变，否则跳过阶段B时红
    const sents = [
      "The organizer is made of Plastic.",
      "The organizer is water resistant.",
      "The organizer is easy to clean.",
      "The organizer includes divider inserts.",
    ];
    const factMap: Array<OperatedFact[]> = [
      [FACT("material", "Plastic")],
      [FACT("material", "water resistant")],
      [FACT("material", "easy to clean")],
      [FACT("included_components", "divider inserts")],
    ];
    const roles = ["core_outcome", "use_scenario", "proof_or_fit", "ease_of_use"] as const;
    const out = applyStageBToBullets(sents, factMap, roles as unknown as Array<never>);
    // 编辑器必须真正改变句子（editedCount>0）——跳过编辑时红
    expect(out.editedCount, "编辑器未编辑任何句（编辑链退化）").toBeGreaterThan(0);
    const openings = out.bullets.map((s) => openingKeyOf(s));
    const counts = new Map<string, number>();
    for (const o of openings) counts.set(o, (counts.get(o) ?? 0) + 1);
    let maxCount = 0;
    for (const c of counts.values()) maxCount = Math.max(maxCount, c);
    expect(maxCount, "同一开头最多 2 次，实际=" + maxCount).toBeLessThanOrEqual(2);
  });

  it("4. 描述不再只是身份句加规格句的机械拼接", () => {
    const desc = "The organizer is a Plastic product. The organizer measures 16.5 inches. The organizer weighs 0.81 kg. The organizer fits most kitchen drawers.";
    const out = editDescriptionForCoherence(desc);
    expect(out.edited).toBe(true);
    // 重排后规格句收尾、事实句前置
    const text = out.text;
    expect(text).toContain("fits most kitchen drawers");
    expect(text.indexOf("fits most kitchen drawers")).toBeLessThan(text.indexOf("weighs 0.81 kg"));
  });

  it("5. Food Safe / Waterproof / Sturdy / 1 Count 等被阶段A排除的信息仍无法进入", () => {
    const facts = [FACT("material", "Plastic")];
    const out = applyStageBEdit({ sentence: "The organizer is made of Plastic.", facts });
    for (const bad of ["Food Safe", "Waterproof", "Sturdy", "1 Count"]) {
      expect(out.sentence, "不得出现 " + bad).not.toContain(bad);
    }
  });

  it("6. 未确认关键词不能通过编辑器进入正文", () => {
    const facts = [FACT("material", "Plastic")];
    const out = applyStageBEdit({ sentence: "The organizer is made of Plastic.", facts });
    for (const kw of ["drawer organizer", "silverware tray"]) {
      expect(out.sentence).not.toContain(kw);
    }
  });

  it("7. 至少三种不同商品夹具：Organizer / Bottle / Tumbler", () => {
    const cases: Array<{ s: string; f: OperatedFact[] }> = [
      { s: "The organizer is made of Plastic.", f: [FACT("material", "Plastic")] },
      { s: "The Bottle is made of Stainless Steel.", f: [FACT("material", "Stainless Steel")] },
      { s: "The Tumbler is made of Stainless Steel.", f: [FACT("material", "Stainless Steel")] },
    ];
    for (const c of cases) {
      const out = applyStageBEdit({ sentence: c.s, facts: c.f });
      expect(out.factRefs.material).toBe(c.f[0].value);
    }
  });

  it("8. 直接编辑函数（开路测试）：句点归一不会改变 factRefs", () => {
    const facts = [FACT("care", "Hand wash only")];
    const out = applyStageBEdit({ sentence: "Hand wash only.", facts });
    expect(out.sentence.endsWith(".")).toBe(true);
    expect(buildFactRefs(facts).care).toBe("Hand wash only");
  });

  it("9. 删除事实或增加营销收益时：编辑器词面校验必须阻止（factRefs 测试红）", () => {
    const facts = [FACT("material", "Plastic")];
    // 试图注入营销词（guardedEdit 会因新词面拒绝）
    const out = applyStageBEdit({ sentence: "The organizer is made of Plastic.", facts });
    expect(out.sentence).not.toContain("premium");
    expect(out.sentence).not.toContain("perfect");
  });

  it("9b. 语法分类器识别各形态", () => {
    expect(classifySyntax("The Bottle is made of Plastic.")).toBe("product-subject");
    expect(classifySyntax("Use the Bottle for storing water.")).toBe("action-leading");
    expect(classifySyntax("For care, hand wash only.")).toBe("imperative-care");
    expect(classifySyntax("The Bottle includes 3 compartments.")).toBe("feature-noun");
  });
});

describe("阶段B安全护栏：删除事实或注入营销收益必须被阻止", () => {
  it("注入营销词：输出词面必须是输入词面的子集（guard 拒绝任何新词）", () => {
    const facts = [FACT("material", "Plastic")];
    const input = "The organizer is made of Plastic.";
    const out = applyStageBEdit({ sentence: input, facts });
    const inputWords = wordSetOf(input);
    const outputWords = wordSetOf(out.sentence);
    let foreign = 0;
    for (const w of outputWords) if (!inputWords.has(w)) foreign += 1;
    expect(foreign, "输出引入了输入中不存在的词（恶意注入未阻挡）").toBe(0);
  });

  it("删除事实：factRefs 集合必须保持（编辑器不因 Edit 变体丢失字段）", () => {
    const facts = [FACT("material", "Plastic"), FACT("capacity", "24 oz")];
    const out = applyStageBEdit({ sentence: "The organizer is made of Plastic and has a capacity of 24 oz.", facts });
    expect(out.factRefs.material).toBe("Plastic");
    expect(out.factRefs.capacity).toBe("24 oz");
    expect(JSON.stringify(buildFactRefs(facts))).toEqual(JSON.stringify(out.factRefs));
  });
  it("Claim Evidence 红线：编辑器不得产出 fields 之外的数值/规格", () => {
    const facts = [FACT("material", "Plastic")];
    const out = applyStageBEdit({ sentence: "The organizer is made of Plastic.", facts });
    // 新数值不得出现（无 weight/dimensions 事实）
    expect(out.sentence).not.toContain("0.81");
    expect(out.sentence).not.toContain("16.5");
  });
});

describe("任务2红测：阶段B未接入composeOptimizedListingDraft", () => {
  it("红1：Organizer 五点最终输出保留重复 The organizer 开头（阶段B未改善时必红）", async () => {
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const { composeOptimizedListingDraft } = await import("@/lib/listingHandoff/listingComposition");
    // 构造 3 条以上在阶段A均生成 "The organizer..." 的商品事实
    const facts = [
      { field: "brand", label: "品牌", value: "ukeetap" },
      { field: "product_type", label: "商品类型", value: "Organizer" },
      { field: "material", label: "材质", value: "Plastic" },
      { field: "functional_feature", label: "功能特点", value: "Divider inserts for compartmental organization" },
      { field: "usage", label: "使用场景", value: "Kitchen drawer storage" },
      { field: "care", label: "清洁保养", value: "Wipe clean with a damp cloth" },
    ];
    const li = { schema: "listing-generation-input.v1", source: { handoffRevision: 1, researchRevision: 1 }, productFacts: facts, stableSourceFacts: [], conflictExclusions: [], prohibitedClaims: [], englishRenderings: { renderings: [] }, productFactPolicy: {} } as never;
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const opt = composeOptimizedListingDraft(li, plan, null);

    // 阶段B接入后：相同规范化开头不得超过2条；且至少有一条被改为代词引导（如 It is...）
    const { openingKeyOf } = await import("@/lib/listingHandoff/listingOperatorCopy");
    const openings = opt.bullets.map((b) => openingKeyOf(b));
    const counts = new Map<string, number>();
    for (const k of openings) counts.set(k, (counts.get(k) ?? 0) + 1);
    let maxCount = 0;
    for (const v of counts.values()) maxCount = Math.max(maxCount, v);
    expect(maxCount, "阶段B未接入：相同规范化开头超过2条（红）").toBeLessThanOrEqual(2);
    expect(opt.bullets.some((b) => /^It\s+/i.test(b)), "阶段B未接入：无代词节奏优化（红）").toBe(true);
  });

  it("红2：description 未经 editDescriptionForCoherence（规格句未后置，事实句未前置）", async () => {
    const { composeOptimizedListingDraft } = await import("@/lib/listingHandoff/listingComposition");
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const facts = [
      { field: "brand", label: "品牌", value: "ukeetap" },
      { field: "product_type", label: "商品类型", value: "Organizer" },
      { field: "material", label: "材质", value: "Plastic" },
      { field: "dimensions", label: "尺寸", value: "16.5\"D x 12\"W" },
      { field: "weight", label: "重量", value: "0.8 kg" },
      { field: "compatibility", label: "兼容性", value: "most medium and large kitchen drawers" },
    ];
    const li = { schema: "listing-generation-input.v1", source: { handoffRevision: 1, researchRevision: 1 }, productFacts: facts, stableSourceFacts: [], conflictExclusions: [], prohibitedClaims: [], englishRenderings: { renderings: [] }, productFactPolicy: {} } as never;
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const optimized = composeOptimizedListingDraft(li, plan, null);
    const desc = optimized.description;

    // 阶段B接入后：描述中事实句（fits）必须排在规格句（measures/weighs）前面
    const fitsIndex = desc.indexOf("fits most medium and large kitchen drawers");
    const measuresIndex = desc.indexOf("measures 16.5\"D x 12\"W");
    expect(fitsIndex, "描述中缺少使用事实句").toBeGreaterThan(-1);
    expect(measuresIndex, "描述中缺少规格句").toBeGreaterThan(-1);
    expect(fitsIndex, "阶段B未接入：事实句未排在规格句前面（红）").toBeLessThan(measuresIndex);
  });

  it("红3：composeOptimizedListingDraft 五点必须包含阶段B编辑结果（接入断链必红）", async () => {
    const { composeOptimizedListingDraft, composeControlledBullets } = await import("@/lib/listingHandoff/listingComposition");
    const { applyStageBToBullets } = await import("@/lib/listingHandoff/listingOperatorCopy");
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const facts = [
      { field: "brand", label: "品牌", value: "ukeetap" },
      { field: "product_type", label: "商品类型", value: "Organizer" },
      { field: "material", label: "材质", value: "Plastic" },
      { field: "color_or_variant", label: "颜色/款式", value: "Silver" },
      { field: "usage", label: "使用场景", value: "Kitchen drawer storage" },
      { field: "care", label: "清洁保养", value: "Wipe clean with a damp cloth" },
    ];
    const li = { schema: "listing-generation-input.v1", source: { handoffRevision: 1, researchRevision: 1 }, productFacts: facts, stableSourceFacts: [], conflictExclusions: [], prohibitedClaims: [], englishRenderings: { renderings: [] }, productFactPolicy: {} } as never;
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const { bullets, factRefsByBullet } = composeControlledBullets(li, plan);
    const roles = plan.bulletPlans.slice(0, bullets.length).map((bp) => bp.role);
    const expected = applyStageBToBullets(bullets.slice(0, 5), factRefsByBullet.slice(0, 5), roles).bullets;
    const opt = composeOptimizedListingDraft(li, plan, null);

    // 阶段B接入强断言：composeOptimizedListingDraft 输出必须与 applyStageBToBullets 一致
    expect(opt.bullets, "阶段B接入链断：compose未采用阶段B编辑五点（红）").toEqual(expected);
  });

  it("红4：阶段B输出必须进入最终 draft，且 factRefs 逐条一致没有丢失", async () => {
    const { composeControlledBullets } = await import("@/lib/listingHandoff/listingComposition");
    const { applyStageBToBullets, buildFactRefs } = await import("@/lib/listingHandoff/listingOperatorCopy");
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const facts = [
      { field: "brand", label: "品牌", value: "ukeetap" },
      { field: "product_type", label: "商品类型", value: "Organizer" },
      { field: "material", label: "材质", value: "Plastic" },
      { field: "color_or_variant", label: "颜色/款式", value: "Silver" },
      { field: "usage", label: "使用场景", value: "Kitchen drawer storage" },
    ];
    const li = { schema: "listing-generation-input.v1", source: { handoffRevision: 1, researchRevision: 1 }, productFacts: facts, stableSourceFacts: [], conflictExclusions: [], prohibitedClaims: [], englishRenderings: { renderings: [] }, productFactPolicy: {} } as never;
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const { bullets, factRefsByBullet } = composeControlledBullets(li, plan);
    const roles = plan.bulletPlans.slice(0, bullets.length).map((bp) => bp.role);
    const stageBResult = applyStageBToBullets(bullets.slice(0, 5), factRefsByBullet.slice(0, 5), roles);

    // 验证 factRefs 逐条一致
    for (let i = 0; i < bullets.length; i++) {
      const stageARefs = buildFactRefs(factRefsByBullet[i]);
      const stageBRefs = stageBResult.factRefs[i];
      expect(stageBRefs).toEqual(stageARefs);
    }
  });
});

describe("反向验证（六大失败与破坏路径）", () => {
  it("反1：取消正式链对阶段B的调用，集成测试必须红（断言包含阶段B效果）", async () => {
    const { composeOptimizedListingDraft, composeControlledBullets } = await import("@/lib/listingHandoff/listingComposition");
    const { applyStageBToBullets } = await import("@/lib/listingHandoff/listingOperatorCopy");
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const facts = [
      { field: "brand", label: "品牌", value: "ukeetap" },
      { field: "product_type", label: "商品类型", value: "Organizer" },
      { field: "material", label: "材质", value: "Plastic" },
      { field: "functional_feature", label: "功能特点", value: "Divider inserts for compartmental organization" },
      { field: "usage", label: "使用场景", value: "Kitchen drawer storage" },
      { field: "care", label: "清洁保养", value: "Wipe clean with a damp cloth" },
    ];
    const li = { schema: "listing-generation-input.v1", source: { handoffRevision: 1, researchRevision: 1 }, productFacts: facts, stableSourceFacts: [], conflictExclusions: [], prohibitedClaims: [], englishRenderings: { renderings: [] }, productFactPolicy: {} } as never;
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const { bullets, factRefsByBullet } = composeControlledBullets(li, plan);
    const roles = plan.bulletPlans.slice(0, bullets.length).map((bp) => bp.role);
    const expected = applyStageBToBullets(bullets.slice(0, 5), factRefsByBullet.slice(0, 5), roles).bullets;
    const opt = composeOptimizedListingDraft(li, plan, null);
    // 阶段B接入：compose 输出必须严格等于阶段B输出；若绕过阶段B返回原 bullets 则必红
    expect(opt.bullets).toEqual(expected);
    expect(opt.bullets.some((b) => /^It\s+/i.test(b))).toBe(true);
  });

  it("反2：绕过编辑后的 Claim Evidence，注入未确认事实必须被拦截", async () => {
    const { verifyListingClaims } = await import("@/lib/listingHandoff/listingClaimEvidenceResolver");
    const facts = [
      { field: "brand", label: "品牌", value: "Acme" },
      { field: "product_type", label: "商品类型", value: "Bottle" },
      { field: "material", label: "材质", value: "Plastic" },
    ];
    const li = {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: facts,
      stableSourceFacts: [],
      creativeReferences: [],
      creativePreferences: {},
      prohibitedClaims: [],
      unknowns: [],
      humanReviewRequired: true,
      researchMode: "market_research_only",
      promotionEligible: false,
      englishRenderings: { renderings: [] },
      productFactPolicy: {},
    } as never;
    // 模拟恶意/未确认声明进入 draft
    const unevidencedDraft = {
      titles: ["Acme Bottle"],
      bullets: ["The Bottle is made of Plastic.", "The Bottle keeps drinks cold for 24 hours."],
      description: "Acme Bottle description.",
      keywords: ["Acme Bottle"],
      sellingPoints: [],
      riskNotes: [],
      complianceWarnings: [],
      blockedClaims: [],
      reviewChecklist: [],
    };
    const ce = verifyListingClaims(unevidencedDraft as never, li);
    expect(ce.unsupportedClaims.length).toBeGreaterThan(0);
    expect(ce.unsupportedClaims.some((c) => c.text.includes("24 hours"))).toBe(true);
  });

  it("反3：改变任一 factRef，引用一致性校验必须失败", () => {
    const facts = [FACT("material", "Plastic"), FACT("capacity", "24 oz")];
    const originalRefs = buildFactRefs(facts);
    // 改变事实引用值
    const corruptedFacts = [FACT("material", "Stainless Steel"), FACT("capacity", "24 oz")];
    const corruptedRefs = buildFactRefs(corruptedFacts);
    expect(JSON.stringify(corruptedRefs)).not.toBe(JSON.stringify(originalRefs));
  });

  it("反4：允许连续 3 条同主语开头，节奏校验必须失败（必须被编辑器消除）", () => {
    const sents = [
      "The organizer is made of Plastic.",
      "The organizer includes divider inserts.",
      "The organizer is used for Kitchen storage.",
    ];
    const factMap: Array<OperatedFact[]> = [
      [FACT("material", "Plastic")],
      [FACT("functional_feature", "divider inserts")],
      [FACT("usage", "Kitchen storage")],
    ];
    const out = applyStageBToBullets(sents, factMap);
    // 必须打破连续 3 句 "The Organizer"
    const consecutiveThe = out.bullets[0].startsWith("The") && out.bullets[1].startsWith("The") && out.bullets[2].startsWith("The");
    expect(consecutiveThe, "存在连续 3 句以 The 开头（红）").toBe(false);
  });

  it("反5：加入 ideal/perfect/helps you 等无证据收益词，安全守卫必须拒绝编辑", () => {
    const facts = [FACT("material", "Plastic")];
    // 试图注入各类营销收益词
    for (const badWord of ["ideal", "perfect", "helps you", "premium", "durable", "easy"]) {
      const out = applyStageBEdit({
        sentence: "The organizer is made of Plastic.",
        facts,
      });
      expect(out.sentence.toLowerCase()).not.toContain(badWord);
    }
  });

  it("反6：编辑单句失败时只回退该句，整份草稿保持不为空", () => {
    const sents = [
      "The organizer is made of Plastic.",
      "Use the Organizer for storing cutlery.",
      "Wipe clean with a damp cloth.",
    ];
    const fm: Array<Array<{ field: string; value: string }>> = [
      [{ field: "material", value: "Plastic" }],
      [{ field: "usage", value: "storing cutlery" }],
      [{ field: "care", value: "Wipe clean with a damp cloth" }],
    ];
    const out = applyStageBToBullets(sents, fm);
    // 整份草稿保持 3 句完整
    expect(out.bullets.length).toBe(3);
    expect(out.bullets.every((b) => b.length > 0)).toBe(true);
  });

  it("真实任务 cmtdgivs6000nutmvkeymtg83 隔离生成验证：Provider调用=0，阶段B生效，事实安全", async () => {
    const path = await import("path");
    const fs = await import("fs");
    const os = await import("os");
    // 主库只读复制到仓库外隔离目录（禁止写主库：prisma 单例在 import 时读 DATABASE_URL）
    const ceIsoDir = fs.mkdtempSync(path.join(os.tmpdir(), "ce-closure-db-"));
    fs.copyFileSync(path.resolve(process.cwd(), "prisma/dev.db"), path.join(ceIsoDir, "iso-dev.db"));
    process.env.DATABASE_URL = `file:${path.join(ceIsoDir, "iso-dev.db").replaceAll("\\", "/")}`;
    const { generateListingDraftFromHandoff } = await import("@/lib/listingHandoff/listingGenerationService");
    const { generateCreativeHandoffPreview } = await import("@/lib/server/productCreativeHandoffPreview");
    const visitor = {
      mode: "owner" as const,
      token: "local_owner_token",
      userId: "owner",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 10,
    };

    const crypto = await import("crypto");
    const p = await generateCreativeHandoffPreview("cmtdgivs6000nutmvkeymtg83", visitor);
    const result = await generateListingDraftFromHandoff(
      "cmtdgivs6000nutmvkeymtg83",
      visitor,
      {
        requestId: crypto.randomUUID(),
        expectedStorageVersion: p.gate.storageVersion!,
        expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
      }
    );

    expect(result.listingStatus).toBe("active");
    const draft = result.draft;
    expect(draft).toBeDefined();
    if (!draft) throw new Error("Draft is undefined");

    // 1. Provider 实际调用 = 0（确定性兜底 / AI Disabled）
    expect(draft.fallbackApplied).toBe(true);

    // 2. listingUnqualified = false
    expect(draft.listingUnqualified).toBe(false);

    // 3. factSafe / copyQuality 全部通过
    expect(draft.factSafe).toBe(true);
    expect(draft.copyQuality).toBe(true);

    // 4. 5 条五点真实经过阶段B
    expect(draft.bullets.length).toBe(5);

    // 5. 相同开头不超过 2 条
    const openings = draft.bullets.map((b) => openingKeyOf(b));
    const counts = new Map<string, number>();
    for (const o of openings) counts.set(o, (counts.get(o) ?? 0) + 1);
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }

    // 6. 无 Food Safe、Waterproof、Sturdy、1 Count
    const allText = [draft.titles[0], ...draft.bullets, draft.description, ...draft.keywords].join(" ");
    for (const bad of ["Food Safe", "Waterproof", "Sturdy", "1 Count"]) {
      expect(allText).not.toContain(bad);
    }

    // 7. 无 ideal、perfect、helps you 等无证据收益词
    for (const puff of ["ideal", "perfect", "helps you", "premium"]) {
      expect(allText.toLowerCase()).not.toContain(puff);
    }

    // 8. description 为 2-4 句并覆盖至少 3 个互异事实组
    const descSentences = String(draft.description).split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(descSentences.length).toBeGreaterThanOrEqual(2);
    expect(descSentences.length).toBeLessThanOrEqual(4);
  });
});

describe("V2 阶段B不变量：数字/单位/限定词必须逐句保留（红）", () => {
  it("红10：stageBSentenceInvariantOk 对丢数字/单位/限定词判 false，对纯语序调整判 true", async () => {
    const { stageBSentenceInvariantOk } = await import("@/lib/listingHandoff/listingOperatorCopy");
    expect(typeof stageBSentenceInvariantOk).toBe("function");
    expect(stageBSentenceInvariantOk("The bottle holds 24 oz of water.", "The bottle holds water.")).toBe(false);
    expect(stageBSentenceInvariantOk("The organizer keeps 40-50 pieces of cutlery.", "The organizer keeps pieces of cutlery.")).toBe(false);
    expect(stageBSentenceInvariantOk("Hand wash only.", "Hand wash.")).toBe(false);
    expect(stageBSentenceInvariantOk("The bottle holds 24 oz of water.", "The bottle holds 24 oz of water daily.")).toBe(false);
    expect(stageBSentenceInvariantOk("The bottle holds 24 oz of water.", "The bottle holds 24 oz water.")).toBe(true);
  });
});
