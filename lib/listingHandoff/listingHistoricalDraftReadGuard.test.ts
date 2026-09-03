import { describe, expect, it } from "vitest";
import {
  draftSafeSummary,
  projectHistoricalKeywordsForRead,
  revalidateHistoricalDraftRead,
  type HistoricalKeywordReadContext,
} from "@/lib/listingHandoff/listingGenerationService";

/** 构建一个历史旧坏快照（无 factSafe/copyQuality, bullets 含坏句） */
function badSnapshot() {
  return {
    draftKind: "structured_listing_draft",
    humanReviewRequired: true,
    generatedAt: "2026-08-26T00:00:00.000Z",
    source: "deterministic_composition_v1",
    version: 1,
    composerVersion: "listing-composer-v1",
    generationPolicyVersion: "listing-generation-policy-v1",
    polishApplied: false,
    polishModel: null,
    titles: ["HydroJug CUPPNK Tumbler water bottle 40oz Stainless Steel Pink"],
    bullets: [
      "The Leak Proof, Water Bottle option fits the everyday use of this Tumbler.",
      "Easy cleaning matches the Dishwasher Safe option for this Tumbler.",
      "Available construction with the 40oz of this Tumbler.",
      "The Tumbler pairs with the Tumbler for everyday use.",
    ],
    description: "A Tumbler for daily use.",
    keywords: ["HydroJug", "Tumbler"],
    backendSearchTerms: ["water bottle"],
    sellingPoints: ["A Tumbler"],
    providerAttempted: true,
    providerSucceeded: true,
    fallbackApplied: true,
    fallbackReason: "AI 文案未匹配卖点策略。",
    fallbackReasonCode: "listing_output_invalid",
    qualityIssues: ["AI 最终草稿未通过 Claim Evidence"],
    usedFactIds: ["functional_feature", "care", "material"],
    // 无 factSafe / copyQuality —— 历史快照
  };
}

/** 新格式合格快照（factSafe=true 且 Copy Quality 正文干净） */
function goodSnapshot() {
  return {
    draftKind: "structured_listing_draft",
    humanReviewRequired: true,
    generatedAt: "2026-08-26T00:00:00.000Z",
    source: "deterministic_composition_v1",
    version: 1,
    composerVersion: "listing-composer-v1",
    generationPolicyVersion: "listing-generation-policy-v1",
    polishApplied: false,
    polishModel: null,
    titles: ["HydroJug 40oz Tumbler"],
    bullets: [
      // 迁移说明：原三条是「旧宽松合同」下的成功夹具，与本轮必须拒绝的病句同形——
      //   "… features a straw lid for everyday use."                 → template_tail（for everyday use 填充尾）
      //   "For easy cleaning with this Tumbler, dishwasher safe parts." → sentence_fragment（前置状语 + 名词短语，无谓语）
      //   "The Tumbler available with stainless steel for practical use." → sentence_fragment + template_tail
      // 意图保持不变：仍是一份「新格式、factSafe=true、copyQuality=true、3 条合格五点、1 段合格描述」的
      // 历史快照，只把句子换成真正合格的自然英文（材质 / 护理祈使 / 功能 + 真实谓语）。
      "The HydroJug tumbler is made of stainless steel.",
      "For care, rinse the parts and wipe dry.",
      "The tumbler features a straw lid for one-handed drinking.",
    ],
    description: "The HydroJug tumbler is made of stainless steel. It features a straw lid for one-handed drinking.",
    keywords: ["HydroJug", "Tumbler"],
    backendSearchTerms: ["water bottle"],
    sellingPoints: ["A Tumbler"],
    providerAttempted: true,
    providerSucceeded: true,
    fallbackApplied: false,
    factSafe: true,
    copyQuality: true,
    listingsUnqualified: false,
  };
}

describe("HistoricalDraftReadGuard 红测：历史坏快照按当前门禁重新判定", () => {
  it("红1：历史坏快照缺 factSafe/copyQuality → listingUnqualified=true, factSafe=false, copyQuality=false, 正式字段清空", () => {
    const verdict = revalidateHistoricalDraftRead(badSnapshot() as Record<string, unknown>);
    expect(verdict.factSafe).toBe(false);
    expect(verdict.copyQuality).toBe(false);
    expect(verdict.listingUnqualified).toBe(true);
    const summary = draftSafeSummary(badSnapshot());
    expect(summary?.listingUnqualified).toBe(true);
    expect(summary?.factSafe).toBe(false);
    expect(summary?.copyQuality).toBe(false);
    expect(summary?.bullets).toEqual([]);
    expect(summary?.titles).toEqual([]);
    expect(summary?.description).toBe("");
    expect(summary?.keywords).toEqual([]);
    expect(summary?.backendSearchTerms).toEqual([]);
  });

  it("红2：历史快照伪造 factSafe=true/copyQuality=true 但 bullets 含 option fits/pairs with → 当前 Copy Quality 拒绝", () => {
    const forged = { ...badSnapshot(), factSafe: true, copyQuality: true };
    const verdict = revalidateHistoricalDraftRead(forged as Record<string, unknown>);
    expect(verdict.copyQuality).toBe(false);
    expect(verdict.listingUnqualified).toBe(true);
  });

  it("红3：新格式合格快照 → listingUnqualified=false, factSafe=true, copyQuality=true, 正式字段保留", () => {
    const verdict = revalidateHistoricalDraftRead(goodSnapshot() as Record<string, unknown>);
    expect(verdict.factSafe).toBe(true);
    expect(verdict.copyQuality).toBe(true);
    expect(verdict.listingUnqualified).toBe(false);
    const summary = draftSafeSummary(goodSnapshot());
    expect(summary?.listingUnqualified).toBe(false);
    expect(summary?.factSafe).toBe(true);
    expect(summary?.copyQuality).toBe(true);
    expect((summary?.bullets ?? []).length).toBe(3);
    expect(summary?.titles?.[0]).toBe("HydroJug 40oz Tumbler");
  });

  it("红4：不合格快照 → 原坏句只进 rejectedListingSentences, ≤5 条, 有界, 中文原因, 无内部 id/hash", () => {
    const summary = draftSafeSummary(badSnapshot());
    const rej = summary?.rejectedListingSentences ?? [];
    expect(rej.length).toBeGreaterThan(0);
    expect(rej.length).toBeLessThanOrEqual(5);
    for (const r of rej) {
      expect(r.text.length).toBeLessThanOrEqual(500);
      expect(/[\u4e00-\u9fff]/.test(r.reason)).toBe(true);
    }
    const dump = JSON.stringify(summary);
    expect(dump).not.toContain("runId");
    expect(dump).not.toContain("inputEvidenceHash");
    expect(dump).not.toContain("usedFactIds");
  });

  it("红5：读取守卫纯函数不得修改传入对象（前后深比较一致）", () => {
    const snap = badSnapshot();
    const snapshotBefore = JSON.stringify(snap);
    revalidateHistoricalDraftRead(snap as Record<string, unknown>);
    draftSafeSummary(snap);
    expect(JSON.stringify(snap)).toBe(snapshotBefore);
  });
});

describe("历史 Organizer 坏句必须按当前规则重新拒绝", () => {
  it("红：持久化旧 pass 标记不能洗白错误套壳句", () => {
    const verdict = revalidateHistoricalDraftRead({
      factSafe: true,
      copyQuality: true,
      titles: ["ukeetap UTO001 Organizer Plastic Silver"],
      bullets: [
        "The Organizer has a capacity of Can hold about 40-50 pieces of common cutlery.",
        "The Organizer opens through its After placing in the drawer, expand to the sides.",
        "The Organizer is suitable for use at For storing knives and forks in a kitchen drawer.",
        "For care, Wipe with a damp cloth; if necessary, clean with warm water.",
      ],
      description: "The Organizer is made of plastic. It stores cutlery.",
    });
    expect(verdict.listingUnqualified).toBe(true);
    expect(verdict.copyQuality).toBe(false);
  });
});

describe("Listing natural editor v1 历史坏稿重判", () => {
  it("红：旧标记 pass 的 Organizer 字段套模板快照必须按当前规则拒绝", () => {
    const verdict = revalidateHistoricalDraftRead({
      factSafe: true,
      copyQuality: true,
      listingUnqualified: false,
      titles: ["ukeetap UTO001 Organizer kitchen Plastic Silver"],
      bullets: [
        "The Organizer includes Expandable compartment design, multi-slot structure, molded in one piece from plastic.",
        "After placing in the drawer, expand or contract to the sides according to the drawer width.",
        "For care, Wipe with a damp cloth; clean with warm water and mild detergent if necessary.",
      ],
      description: "The UTO001 Organizer is an ukeetap product.",
    } as Record<string, unknown>);
    expect(verdict.copyQuality).toBe(false);
    expect(verdict.listingUnqualified).toBe(true);
  });
});

describe("HISTORICAL_KEYWORD_READ_GUARD：历史草稿关键词按当前 Brief+Policy 投影（红→绿）", () => {
  const DIRTY_KEYWORDS = [
    "drawer organizer",
    "kitchen drawer organizer",
    "Plastic Organizer",
    "Holds approximately 40-50 pieces of cutlery Organizer",
  ];
  const DIRTY_BACKEND = ["drawer organizer", "plastic organizer caddy", "Holds about 40-50 Organizer"];
  const BODY_BULLETS = [
    "The organizer is built with an expandable multi-compartment design.",
    "It stores about 40 to 50 pieces of cutlery.",
    "This drawer organizer expands to the drawer width.",
    "It is suitable for daily kitchen storage.",
    "For care, wipe with a damp cloth.",
  ];
  const BODY_TITLE = "ukeetap UTO001 Drawer Organizer Plastic Silver";
  const BODY_DESC = "The ukeetap UTO001 is a plastic organizer. It fits most medium kitchen drawers. The organizer weighs 0.81 kg.";
  const BRIEF = {
    primaryKeyword: "drawer organizer",
    supportingKeywords: ["kitchen drawer organizer"],
    backendSearchTerms: ["drawer organizer"],
  };
  const POLICY: HistoricalKeywordReadContext = {
    brief: BRIEF,
    policyInput: { ownBrand: "ukeetap", knownBrands: [] },
  };

  function dirtySnapshot(overrides: Record<string, unknown> = {}) {
    return {
      draftKind: "structured_listing_draft",
      humanReviewRequired: true,
      generatedAt: "2026-08-26T00:00:00.000Z",
      source: "deterministic_composition_v1",
      version: 1,
      composerVersion: "listing-composer-v1",
      generationPolicyVersion: "listing-generation-policy-v1",
      polishApplied: false,
      polishModel: null,
      titles: [BODY_TITLE],
      bullets: [...BODY_BULLETS],
      description: BODY_DESC,
      keywords: [...DIRTY_KEYWORDS],
      backendSearchTerms: [...DIRTY_BACKEND],
      usedKeywordTrace: ["Plastic Organizer", "silverware organizer"],
      searchOnlyKeywordTrace: ["kitchen drawer organizer"],
      sellingPoints: ["x"],
      providerAttempted: false,
      providerSucceeded: false,
      fallbackApplied: false,
      factSafe: true,
      copyQuality: true,
      listingUnqualified: false,
      ...overrides,
    };
  }

  it("红1：历史旧pass草稿 keywords 仍泄漏 2 条 Brief 外垃圾词 → 投影只保留当前 Brief 词", () => {
    const summary = draftSafeSummary(dirtySnapshot(), POLICY);
    expect(summary?.keywords).toEqual(["drawer organizer", "kitchen drawer organizer"]);
    for (const bad of ["Plastic Organizer", "Holds approximately 40-50 pieces of cutlery Organizer"]) {
      expect(summary?.keywords).not.toContain(bad);
    }
  });

  it("红2：大小写/多空格归一去重，保序保留首次出现", () => {
    const raw = dirtySnapshot({
      keywords: ["  Drawer   Organizer ", "kitchen drawer organizer", "kitchen   drawer organizer", "Drawer Organizer"],
    });
    const proj = projectHistoricalKeywordsForRead(raw, POLICY);
    expect(proj.keywords).toEqual(["Drawer Organizer", "kitchen drawer organizer"]);
  });

  it("红3：backendSearchTerms 必须是当前 Brief backend 集合子集", () => {
    const raw = dirtySnapshot({ backendSearchTerms: ["drawer organizer", "plastic organizer caddy", "Holds about 40-50 Organizer"] });
    const proj = projectHistoricalKeywordsForRead(raw, POLICY);
    expect(proj.backendSearchTerms).toEqual(["drawer organizer"]);
  });

  it("红4：无有效 Brief → 历史 keywords/backend 全部为空", () => {
    const summary = draftSafeSummary(dirtySnapshot(), { brief: null, policyInput: POLICY.policyInput });
    expect(summary?.keywords).toEqual([]);
    expect(summary?.backendSearchTerms).toEqual([]);
  });

  it("红5：used/searchOnly trace 由正文+投影字段重算，不信任旧 trace，且互斥", () => {
    const raw = dirtySnapshot(); // 旧 trace 故意污染
    const summary = draftSafeSummary(raw, POLICY);
    const used = summary?.usedKeywordTrace ?? [];
    const searchOnly = summary?.searchOnlyKeywordTrace ?? [];
    expect(used).toContain("drawer organizer");
    expect(used).not.toContain("Plastic Organizer");
    expect(searchOnly).toContain("kitchen drawer organizer");
    const overlap = used.filter((item) => searchOnly.includes(item));
    expect(overlap).toEqual([]);
  });

  it("红6：只因关键词被过滤 → 合格正文保留、listingUnqualified=false", () => {
    const summary = draftSafeSummary(dirtySnapshot(), POLICY);
    expect(summary?.listingUnqualified).toBe(false);
    expect(summary?.bullets).toEqual([...BODY_BULLETS]);
    expect(summary?.description).toBe(BODY_DESC);
    expect(summary?.titles).toEqual([BODY_TITLE]);
  });

  it("红7：警告有界且不含脏词原文/内部 hash", () => {
    const summary = draftSafeSummary(dirtySnapshot(), POLICY);
    const notice = summary?.historicalKeywordFilteredNotice;
    expect(notice).toBeTruthy();
    expect(notice?.length ?? 0).toBeLessThan(200);
    expect(notice).toContain("已按当前规则过滤");
    const dump = JSON.stringify(summary);
    expect(dump).not.toContain("Plastic Organizer");
    expect(dump).not.toContain("Holds approximately");
    expect(dump).not.toContain("resultJsonHash");
    expect(/[0-9a-f]{64}/.test(dump)).toBe(false);
  });

  it("红8：GET 投影纯函数不得修改输入对象（深比较）", () => {
    const snap = dirtySnapshot();
    const before = JSON.stringify(snap);
    draftSafeSummary(snap, POLICY);
    projectHistoricalKeywordsForRead(snap, POLICY);
    expect(JSON.stringify(snap)).toBe(before);
  });

  it("红9：干净草稿（全部为 Brief 词）不产生过滤提示", () => {
    const clean = dirtySnapshot({ keywords: ["drawer organizer", "kitchen drawer organizer"], backendSearchTerms: ["drawer organizer"] });
    const summary = draftSafeSummary(clean, POLICY);
    expect(summary?.keywords).toEqual(["drawer organizer", "kitchen drawer organizer"]);
    expect(summary?.historicalKeywordFilteredNotice).toBeUndefined();
  });
});

describe("V2 历史旧pass稿按新合同重判：异常大写+机械拼接+重复主语必须不合格（红）", () => {
  it("红11：R3 时代旧稿（The Organizer 大写 + and is molded + 重复主语）→ 读取重判不合格，正式字段清空", () => {
    const legacy = {
      draftKind: "structured_listing_draft",
      humanReviewRequired: true,
      generatedAt: "2026-09-03T06:00:00.000Z",
      source: "deterministic_composition_v1",
      version: 1,
      composerVersion: "listing-composer-v1",
      generationPolicyVersion: "listing-generation-policy-v1",
      polishApplied: false,
      polishModel: null,
      titles: ["ukeetap UTO001 Expandable Cutlery Drawer Organizer, Plastic, Silver"],
      bullets: [
        "The Organizer has an expandable compartment design with multiple slots and is molded in one piece from plastic.",
        "The Organizer holds approximately 40-50 pieces of cutlery.",
        "After placing the organizer in the drawer, expand or contract it according to the drawer width.",
        "The Organizer stores knives, forks, spoons, and other cutlery in a kitchen drawer.",
        "Wipe with a damp cloth; if necessary, clean with warm water and mild detergent.",
      ],
      description: "The ukeetap UTO001 is a plastic organizer. It fits most medium and large kitchen drawers and adjusts to the available drawer space. The organizer measures 16.5 x 21 x 1.77 inches and weighs 0.81 kg.",
      keywords: ["drawer organizer"],
      backendSearchTerms: [],
      sellingPoints: ["x"],
      providerAttempted: false,
      providerSucceeded: false,
      fallbackApplied: false,
      factSafe: true,
      copyQuality: true,
      listingUnqualified: false,
    };
    const summary = draftSafeSummary(legacy);
    expect(summary, "旧稿应被读取重判拦截").not.toBeNull();
    expect(summary?.listingUnqualified, "异常大写/机械拼接/重复主语旧稿仍被判合格").toBe(true);
    expect(summary?.bullets, "不合格旧稿不得展示正式五点").toEqual([]);
    expect(summary?.titles, "不合格旧稿不得展示正式标题").toEqual([]);
    expect(summary?.description, "不合格旧稿不得展示正式描述").toBe("");
  });
});

describe("单件自身旧稿历史重判（第十版）", () => {
  it("旧标记 pass 的单件自身 B5 旧稿读取时判不合格", () => {
    const snapshot = {
      draftKind: "structured_listing_draft",
      humanReviewRequired: true,
      generatedAt: "2026-09-03T10:23:20.589Z",
      source: "deterministic_composition_v1",
      version: 1,
      composerVersion: "listing-composer-v1",
      generationPolicyVersion: "listing-generation-policy-v1",
      polishApplied: false,
      polishModel: null,
      titles: ["ukeetap UTO001 Expandable Silverware Organizer, Plastic, Silver"],
      bullets: [
        "Molded in one piece from plastic, the organizer has an expandable compartment design with multiple slots.",
        "The organizer holds approximately 40-50 pieces of cutlery.",
        "After placing the organizer in the drawer, expand or contract it according to the drawer width.",
        "The organizer stores knives, forks, spoons, and other cutlery in a kitchen drawer.",
        "The included component is 1 expandable silverware organizer.",
      ],
      description: "The ukeetap UTO001 is a plastic organizer. It has an expandable compartment design with multiple slots. The organizer fits most medium and large kitchen drawers and adjusts to the available drawer space. It measures 16.5\"D x 21\"W x 1.77\"H and weighs 0.81 kg.",
      keywords: [],
      factSafe: true,
      copyQuality: true,
      listingUnqualified: false,
      draftKindSafe: undefined,
    };
    const verdict = revalidateHistoricalDraftRead(snapshot);
    expect(verdict.listingUnqualified).toBe(true);
  });

  it("旧标记 pass 但含五类假通过病句（如 opens through its ... mechanism / suitable for use at daily）的旧稿读取时判不合格", () => {
    const badSnapshotWithPassFlags = {
      draftKind: "structured_listing_draft",
      humanReviewRequired: true,
      generatedAt: "2026-09-03T10:23:20.589Z",
      source: "deterministic_composition_v1",
      version: 1,
      composerVersion: "listing-composer-v1",
      generationPolicyVersion: "listing-generation-policy-v1",
      polishApplied: false,
      polishModel: null,
      titles: ["Owala FreeSip Water Bottle, 24 oz, Stainless Steel, Very, Very Dark"],
      bullets: [
        "The water bottle is made of stainless steel.",
        "The water bottle measures 3.24\"W x 10.68\"H.",
        "It opens through its push-button open with built-in straw for upright sipping mechanism.",
        "This water bottle is suitable for use at daily hydration at home or office.",
        "A FreeSip spout with built-in straw and push-button lid is included with the water bottle.",
      ],
      description: "The Owala FreeSip is a stainless steel water bottle. It has double-wall vacuum insulation. The water bottle fits cup holder-friendly base. It measures 3.24\"W x 10.68\"H and weighs 13.6 oz.",
      keywords: [],
      factSafe: true,
      copyQuality: true,
      listingUnqualified: false,
    };
    const verdict = revalidateHistoricalDraftRead(badSnapshotWithPassFlags as Record<string, unknown>);
    expect(verdict.copyQuality).toBe(false);
    expect(verdict.listingUnqualified).toBe(true);

    const summary = draftSafeSummary(badSnapshotWithPassFlags);
    expect(summary?.listingUnqualified).toBe(true);
    expect(summary?.bullets).toEqual([]);
    expect(summary?.description).toBe("");
  });
});