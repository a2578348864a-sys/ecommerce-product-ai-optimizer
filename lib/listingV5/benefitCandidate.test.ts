import { describe, expect, it } from "vitest";

/**
 * Listing V5.8 Phase 2 — evidence-derived benefit candidates.
 *
 * The contract these tests lock:
 *   1. the candidate set is derived from OBSERVED research themes, so a product
 *      whose reviews talk about durability, size, cleaning or value produces
 *      concepts the previous four-sentence English vocabulary could never express;
 *   2. a candidate always names the evidence behind it, and only ever names ids
 *      that resolve against the frozen context — a fabricated id can never appear;
 *   3. a candidate is reference-only framing: it carries no fact id, is marked
 *      not-a-product-fact, and never copies the reference text into the strategy;
 *   4. no citable evidence means no candidates and the previous behaviour is kept,
 *      so nothing is invented to fill a gap;
 *   5. the Phase 1 ranking still decides the order.
 */

import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import type { ListingV5BenefitPriority, ListingV5Context } from "./types";

/** Same accessor the Phase 1 suite uses, so the audit assertions stay identical. */
function entriesOf(strategy: ReturnType<typeof buildListingV5Strategy>, field: ListingV5BenefitPriority["field"]) {
  return (strategy.benefitPriorityBasis?.entries ?? []).filter((entry) => entry.field === field);
}

const GENERATION_INPUT = {
  schema: "listing-generation-input.v1" as const,
  source: { handoffRevision: 1, researchRevision: 1 },
  productFacts: [],
  stableSourceFacts: [],
  creativeReferences: [],
  creativePreferences: {},
  prohibitedClaims: [],
  unknowns: [],
  humanReviewRequired: true as const,
  researchMode: "market_research_only" as const,
  promotionEligible: false,
};

type VocInput = { insightId: string; theme: string; summary: string; reviewCount: number; strength: string; sourceType?: string };
type KeywordInput = { keyword: string; reportType: string; rowNumber: number };
type CompetitorInput = { asin: string; note: string };

function context(input: { voc?: VocInput[]; keywords?: KeywordInput[]; competitors?: CompetitorInput[] } = {}): ListingV5Context {
  const vocInsights = input.voc ?? [];
  const keywordCandidates = input.keywords ?? [];
  const competitiveContext = input.competitors ?? [];
  return buildListingV5Context({
    taskId: "task-benefit-candidate",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Kitchen Organizer",
    generationInput: GENERATION_INPUT,
    creativeContext: {
      schema: "creative-context.v1",
      version: 1,
      generatedAt: "",
      source: { researchRevision: 1, candidateId: "candidate-1" },
      confirmedFacts: [],
      confirmableFactCandidates: [],
      vocInsights: vocInsights.map((item) => ({
        ...item,
        evidenceRefs: [],
        coverage: 0.2,
        sourceType: item.sourceType ?? "voc_theme",
        provenance: { evidenceRef: `ev:${item.insightId}`, sourceType: item.sourceType ?? "voc_theme", observedAt: "" },
      })),
      keywordCandidates: keywordCandidates.map((item) => ({
        ...item,
        evidenceRef: `ev:kw:${item.rowNumber}`,
        observedAt: "",
        provenance: { evidenceRef: `ev:kw:${item.rowNumber}`, sourceType: "keyword_evidence", observedAt: "" },
      })),
      competitiveContext: competitiveContext.map((item) => ({
        ...item,
        addedAt: "",
        relation: "direct",
        evidenceRef: `ev:${item.asin}`,
        provenance: { evidenceRef: `ev:${item.asin}`, sourceType: "competitor_evidence", observedAt: "" },
      })),
      sourcingContext: [],
      aiReferences: [],
      missingConflicts: [],
      counts: {
        confirmedFacts: 0,
        confirmableCandidates: 0,
        vocInsights: vocInsights.length,
        keywordCandidates: keywordCandidates.length,
        competitiveInsights: competitiveContext.length,
        sourcingEntries: 0,
        aiReferences: 0,
        missingConflicts: 0,
      },
    },
    confirmedFacts: [{ factId: "fact-material", field: "material", label: "Material", value: "stainless steel" }],
  } as never);
}

/** Real VOC themes observed in the local task store (Simplified Chinese, as the VOC contract requires). */
const REAL_THEMES: VocInput[] = [
  { insightId: "theme-look", theme: "美观且实用", summary: "评论称产品美观且实用，并提到优雅的厨房装饰，外观和功能均受好评。", reviewCount: 7, strength: "recurring" },
  { insightId: "theme-leak", theme: "防漏性能好", summary: "有评论明确表示不漏水，防漏功能得到肯定。", reviewCount: 4, strength: "recurring" },
  { insightId: "theme-value", theme: "性价比高", summary: "有评论称其为真正的便宜货，暗示价格合理或物超所值。", reviewCount: 3, strength: "weak" },
  { insightId: "theme-stable", theme: "稳定性和重量感", summary: "多位用户提到产品具有重型稳定性，暗示重量和稳固性受到好评。", reviewCount: 2, strength: "weak" },
  { insightId: "theme-size", theme: "尺寸合适且质量好", summary: "多位用户反馈产品尺寸完美贴合，质量优良。", reviewCount: 5, strength: "recurring" },
];

describe("Phase 2 — candidates are derived from the evidence", () => {
  it("derives product-relevant concepts from real Chinese VOC themes", () => {
    const strategy = buildListingV5Strategy(context({ voc: REAL_THEMES }));
    const concepts = (strategy.benefitCandidates?.candidates ?? []).map((candidate) => candidate.concept);
    expect(strategy.benefitCandidates?.source).toBe("evidence");
    // Concepts the previous four-sentence vocabulary could never express.
    expect(concepts).toContain("leak_resistance");
    expect(concepts).toContain("durability");
    expect(concepts).toContain("size_fit");
    expect(concepts).toContain("value_for_money");
    expect(concepts).toContain("appearance");
    // Not limited to the four legacy needs.
    expect(new Set(concepts).size).toBeGreaterThan(4);
  });

  it("no longer confines the need vocabulary to the four legacy English sentences", () => {
    const legacy = new Set([
      "keep everyday spaces organized",
      "make everyday sipping convenient",
      "keep routines simple to manage",
      "feel confident carrying the product",
    ]);
    const strategy = buildListingV5Strategy(context({ voc: REAL_THEMES }));
    const painPoints = strategy.painPoints;
    expect(painPoints.length).toBeGreaterThan(0);
    expect(painPoints.some((need) => !legacy.has(need))).toBe(true);
  });

  it("still keeps the legacy wording for the concepts the old table covered", () => {
    const strategy = buildListingV5Strategy(context({
      voc: [{ insightId: "theme-org", theme: "整理效果好", summary: "用户称赞产品能有效整理抽屉，保持物品有序。", reviewCount: 6, strength: "recurring" }],
    }));
    expect(strategy.painPoints).toEqual(["keep everyday spaces organized"]);
  });
});

describe("Phase 2 — a candidate always names real evidence", () => {
  it("only ever cites ids that resolve against the frozen context", () => {
    const value = context({ voc: REAL_THEMES, keywords: [{ keyword: "leaking organizer", reportType: "search", rowNumber: 1 }] });
    const known = new Set([
      ...value.references.voc,
      ...value.references.keywords,
      ...value.references.competitors,
    ].map((reference) => reference.evidenceId));
    const strategy = buildListingV5Strategy(value);
    const candidates = strategy.benefitCandidates?.candidates ?? [];
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.evidenceIds.length).toBeGreaterThan(0);
      for (const id of candidate.evidenceIds) expect(known.has(id)).toBe(true);
      expect(candidate.candidateId).toContain("benefit:");
    }
  });

  it("never emits a candidate for a theme that cannot be cited", () => {
    // No upstream insightId → the reference carries no identity → nothing to cite,
    // even though the theme itself is about a concept we understand.
    const value = context({
      voc: [{ insightId: "", theme: "厨房收纳升级", summary: "用户认为这是出色的厨房收纳升级。", reviewCount: 5, strength: "recurring" }],
    });
    const strategy = buildListingV5Strategy(value);
    expect(strategy.benefitCandidates?.source).toBe("none");
    expect(strategy.benefitCandidates?.candidates).toEqual([]);
    // Previous behaviour is preserved rather than replaced by an uncited need:
    // the isolated legacy vocabulary still matches, and it is reported as unbacked.
    expect(strategy.painPoints).toEqual(["keep everyday spaces organized"]);
    expect(entriesOf(strategy, "painPoints").every((entry) => entry.basis === "no_reference")).toBe(true);
  });

  it("keeps a competitor gap as a candidate only when our own fact can answer it", () => {
    const comparable = context({
      voc: [{ insightId: "theme-leak", theme: "防漏性能好", summary: "有评论明确表示不漏水。", reviewCount: 3, strength: "weak" }],
      competitors: [{ asin: "B0RIVAL0001", note: "leaking lid in stainless steel" }],
    });
    const [entry] = buildListingV5Strategy(comparable).benefitCandidates?.candidates ?? [];
    expect(entry?.evidenceIds).toContain("competitor:B0RIVAL0001");
  });
});

describe("Phase 2 — candidate framing stays reference-only", () => {
  it("carries no fact id and is explicitly marked not-a-product-fact", () => {
    const strategy = buildListingV5Strategy(context({ voc: REAL_THEMES }));
    for (const candidate of strategy.benefitCandidates?.candidates ?? []) {
      expect(candidate.notProductFact).toBe(true);
      expect(candidate.marker).toBe("UNTRUSTED_REFERENCE_DATA");
      expect(candidate).not.toHaveProperty("factId");
      expect(candidate).not.toHaveProperty("factIds");
    }
  });

  it("never copies reference wording into the strategy", () => {
    const strategy = buildListingV5Strategy(context({ voc: REAL_THEMES }));
    const payload = JSON.stringify({
      painPoints: strategy.painPoints,
      purchaseMotivations: strategy.purchaseMotivations,
      useCases: strategy.useCases,
      benefitCandidates: strategy.benefitCandidates,
    });
    // The reference summaries are Simplified Chinese; none of it may reach the copy.
    expect(payload).not.toMatch(/[\u4e00-\u9fff]/);
    expect(payload).not.toContain("不漏水");
  });

  it("does not change Evidence Binding: a deterministic template stays a suggestion", () => {
    const strategy = buildListingV5Strategy(context({ voc: REAL_THEMES }));
    expect(strategy.evidenceBindings?.source).toBe("deterministic");
    expect(strategy.evidenceBindings?.bound).toBe(0);
    expect(strategy.evidenceBindings?.conclusions.every((item) => item.status === "ai_suggestion")).toBe(true);
  });
});

describe("Phase 2 — ordering and determinism", () => {
  it("orders candidates by the Phase 1 evidence score", () => {
    const strategy = buildListingV5Strategy(context({
      voc: [
        { insightId: "theme-isolated", theme: "性价比高", summary: "一条评论提到价格便宜。", reviewCount: 1, strength: "isolated" },
        { insightId: "theme-recurring", theme: "防漏性能好", summary: "多条评论表示不漏水。", reviewCount: 12, strength: "recurring" },
      ],
    }));
    const candidates = strategy.benefitCandidates?.candidates ?? [];
    expect(candidates[0]?.concept).toBe("leak_resistance");
    expect(candidates[0]?.strength).toBe("recurring");
    expect(candidates[0]!.score).toBeGreaterThan(candidates[1]!.score);
  });

  it("marks a theme raised by a VOC conflict as buyer_conflict", () => {
    const strategy = buildListingV5Strategy(context({
      voc: [{ insightId: "theme-color", theme: "冲突：颜色准确性", summary: "部分用户对颜色满意，但一条评论指出颜色与图片不符。", reviewCount: 3, strength: "weak", sourceType: "voc_conflict" }],
    }));
    const [candidate] = strategy.benefitCandidates?.candidates ?? [];
    expect(candidate?.concept).toBe("color_accuracy");
    expect(candidate?.kind).toBe("buyer_conflict");
  });

  it("is deterministic and never mutates the frozen context", () => {
    const value = context({ voc: REAL_THEMES });
    const before = JSON.stringify(value);
    expect(JSON.stringify(buildListingV5Strategy(value))).toBe(JSON.stringify(buildListingV5Strategy(value)));
    expect(JSON.stringify(value)).toBe(before);
  });

  it("keeps the previous behaviour when there is no VOC at all", () => {
    const strategy = buildListingV5Strategy(context({ keywords: [{ keyword: "kitchen organizer", reportType: "search", rowNumber: 1 }] }));
    expect(strategy.benefitCandidates?.source).toBe("none");
    expect(strategy.benefitCandidates?.candidates).toEqual([]);
    expect(strategy.painPoints).toEqual([]);
  });
});
