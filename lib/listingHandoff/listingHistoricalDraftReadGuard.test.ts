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
      "The Tumbler features a straw lid for everyday use.",
      "For easy cleaning with this Tumbler, dishwasher safe parts.",
      "The Tumbler available with stainless steel for practical use.",
    ],
    description: "The HydroJug Tumbler with stainless steel construction for daily use.",
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
