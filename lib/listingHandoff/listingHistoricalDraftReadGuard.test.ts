import { describe, expect, it } from "vitest";
import { revalidateHistoricalDraftRead, draftSafeSummary } from "@/lib/listingHandoff/listingGenerationService";

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
      "The HydroJug Tumbler is made of stainless steel.",
      "For care, rinse the parts and wipe dry.",
      "The Tumbler features a straw lid for one-handed drinking.",
    ],
    description: "The HydroJug Tumbler is made of stainless steel. It features a straw lid for one-handed drinking.",
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
