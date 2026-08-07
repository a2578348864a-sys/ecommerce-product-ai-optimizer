import { describe, expect, it } from "vitest";
import {
  buildConfirmableCandidates,
  confirmSelectedProductFacts,
  type ConfirmableFactCandidate,
} from "@/lib/productCreativeHandoffConfirmation";
import type { ProductCreativeHandoffStableSourceFact } from "@/lib/productCreativeHandoff";

const NOW = "2026-08-08T00:00:00.000Z";
const ACTOR = { mode: "owner" as const, subjectFingerprint: "owner-fingerprint" };

function stableFact(overrides: Partial<ProductCreativeHandoffStableSourceFact> = {}): ProductCreativeHandoffStableSourceFact {
  return {
    factId: `stable-${overrides.field ?? "brand"}-fact-id`,
    field: overrides.field ?? "brand",
    label: overrides.label ?? "品牌",
    value: overrides.value ?? "Owala",
    evidenceTier: "source_snapshot",
    usageScopes: ["internal"],
    sourceRef: {
      sourceKind: "candidate_snapshot",
      sourceField: overrides.field ?? "brand",
      candidateSnapshotFingerprint: "a".repeat(64),
      capturedAt: NOW,
    },
    stabilityRule: "human_confirmation_required_for_claim",
    factCategory: overrides.factCategory,
  };
}

describe("V2.1.2 确认逻辑：factCategory 决定 usageScopes", () => {
  it("product_fact 可确认进 Listing（internal + listing）", () => {
    const brand = stableFact({ field: "brand", label: "品牌", value: "Owala", factCategory: "product_fact" });
    const candidates = buildConfirmableCandidates([brand]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].allowedUsageScopes).toEqual(["internal", "listing"]);

    const result = confirmSelectedProductFacts({
      stableSourceFacts: [brand],
      confirmableCandidates: candidates,
      selectedKeys: [candidates[0].selectionKey],
      actor: ACTOR,
      confirmedAt: NOW,
      confirmationReference: "ref-1",
      candidateId: "cand-1",
    });
    expect(result.confirmedFacts).toHaveLength(1);
    expect(result.confirmedFacts[0].usageScopes).toContain("listing");
  });

  it("market_signal（price_usd）确认后仅 internal，不含 listing", () => {
    const price = stableFact({ field: "price_usd", label: "参考价格 (USD)", value: 23.99, factCategory: "market_signal" });
    const candidates = buildConfirmableCandidates([price]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].allowedUsageScopes).toEqual(["internal"]);

    const result = confirmSelectedProductFacts({
      stableSourceFacts: [price],
      confirmableCandidates: candidates,
      selectedKeys: [candidates[0].selectionKey],
      actor: ACTOR,
      confirmedAt: NOW,
      confirmationReference: "ref-2",
      candidateId: "cand-1",
    });
    expect(result.confirmedFacts).toHaveLength(1);
    expect(result.confirmedFacts[0].usageScopes).not.toContain("listing");
    expect(result.confirmedFacts[0].usageScopes).toContain("internal");
  });

  it("market_signal（rating/review_count/category）确认后仅 internal", () => {
    for (const field of ["rating", "review_count", "category"]) {
      const fact = stableFact({ field, label: field, value: field === "category" ? "Sports" : 4.5, factCategory: "market_signal" });
      const candidates = buildConfirmableCandidates([fact]);
      expect(candidates[0].allowedUsageScopes).toEqual(["internal"]);
    }
  });

  it("无 factCategory 的旧事实保守处理：不自动获得 listing 权限", () => {
    const legacy = stableFact({ field: "brand", label: "品牌", value: "Owala", factCategory: undefined });
    const candidates = buildConfirmableCandidates([legacy]);
    expect(candidates).toHaveLength(1);
    // 旧数据无分类 → 默认 internal + listing（兼容既有确认流程），但 Listing 输入层仍有硬排除
    expect(candidates[0].allowedUsageScopes).toEqual(["internal", "listing"]);
  });
});

// ── Listing 输入过滤（listingGenerationInput 层硬排除）──
import {
  buildListingInputFromCreativeHandoff,
} from "@/lib/listingHandoff/listingGenerationInput";
import type { ProductCreativeHandoffVersion } from "@/lib/productCreativeHandoff";

function confirmedFact(field: string, label: string, value: string | number, scopes: Array<"listing" | "image" | "internal">) {
  return {
    factId: `confirmed-${field}`,
    field,
    label,
    value,
    evidenceTier: "human_confirmed" as const,
    usageScopes: scopes,
    sourceRef: {
      sourceKind: "user_confirmation" as const,
      sourceField: field,
      confirmedBy: ACTOR,
      confirmedAt: NOW,
      confirmationReference: `ref-${field}`,
    },
    confirmedAt: NOW,
    confirmedBy: ACTOR,
  };
}

function buildVersion(confirmedFacts: ReturnType<typeof confirmedFact>[]): ProductCreativeHandoffVersion {
  return {
    revision: 1,
    createdAt: NOW,
    createdBy: ACTOR,
    sourceResearch: {
      recordSchema: "product-research-record.v1",
      candidateId: "cand-1",
      researchRevision: 1,
      researchHash: "b".repeat(64),
      workflowStatus: "completed",
      decisionStatus: "creative_ready",
      candidateSourceFingerprint: "c".repeat(64),
    },
    productIdentity: { displayName: "Owala FreeSip", identityConfirmedAt: NOW },
    confirmedFacts: confirmedFacts as never,
    stableSourceFacts: [],
    aiCreativeReferences: [],
    issues: [],
    prohibitedClaims: [],
    creativePreferences: {},
    visualReferences: [],
    humanReviewRequired: true,
  } as never;
}

describe("V2.1.2 Listing 输入过滤：市场信号不进入 Listing facts", () => {
  function buildHandoff(facts: ReturnType<typeof confirmedFact>[]) {
    return {
      schema: "product-creative-handoff.v1",
      handoffId: "handoff-1",
      taskId: "task-1",
      candidateId: "cand-1",
      currentRevision: 1,
      controlState: "active" as const,
      createdAt: NOW,
      createdBy: ACTOR,
      researchMode: "market_research_only" as const,
      promotionEligible: false,
      versions: [buildVersion(facts)],
    } as never;
  }

  it("price_usd 即使被确认也不进入 Listing facts", () => {
    const handoff = buildHandoff([
      confirmedFact("brand", "品牌", "Owala", ["internal", "listing"]),
      confirmedFact("price_usd", "参考价格 (USD)", 23.99, ["internal", "listing"]),
    ]);
    const result = buildListingInputFromCreativeHandoff(handoff as never, 1);
    if (!result.ok) throw new Error(`input should build: ${result.code}`);
    const fields = result.input.productFacts.map((f) => f.field);
    expect(fields).toContain("brand");
    expect(fields).not.toContain("price_usd");
  });

  it("rating 不进入 Listing facts", () => {
    const handoff = buildHandoff([
      confirmedFact("brand", "品牌", "Owala", ["internal", "listing"]),
      confirmedFact("rating", "评分", 4.7, ["internal", "listing"]),
    ]);
    const result = buildListingInputFromCreativeHandoff(handoff as never, 1);
    if (!result.ok) throw new Error(`input should build: ${result.code}`);
    const fields = result.input.productFacts.map((f) => f.field);
    expect(fields).not.toContain("rating");
  });

  it("review_count 不进入 Listing facts", () => {
    const handoff = buildHandoff([
      confirmedFact("brand", "品牌", "Owala", ["internal", "listing"]),
      confirmedFact("review_count", "评论数", 132610, ["internal", "listing"]),
    ]);
    const result = buildListingInputFromCreativeHandoff(handoff as never, 1);
    if (!result.ok) throw new Error(`input should build: ${result.code}`);
    const fields = result.input.productFacts.map((f) => f.field);
    expect(fields).not.toContain("review_count");
  });

  it("category 不作为 Bullet 来源（不进 Listing facts）", () => {
    const handoff = buildHandoff([
      confirmedFact("brand", "品牌", "Owala", ["internal", "listing"]),
      confirmedFact("category", "类目", "Sports", ["internal", "listing"]),
    ]);
    const result = buildListingInputFromCreativeHandoff(handoff as never, 1);
    if (!result.ok) throw new Error(`input should build: ${result.code}`);
    const fields = result.input.productFacts.map((f) => f.field);
    expect(fields).not.toContain("category");
  });

  it("product_fact（brand）可以进入 Listing facts", () => {
    const handoff = buildHandoff([
      confirmedFact("brand", "品牌", "Owala", ["internal", "listing"]),
    ]);
    const result = buildListingInputFromCreativeHandoff(handoff as never, 1);
    if (!result.ok) throw new Error(`input should build: ${result.code}`);
    const fields = result.input.productFacts.map((f) => f.field);
    expect(fields).toContain("brand");
    expect(result.input.productFacts[0].value).toBe("Owala");
  });

  it("无任何 product_fact 时返回 listing_input_empty（不伪造内容）", () => {
    const handoff = buildHandoff([
      confirmedFact("price_usd", "参考价格 (USD)", 23.99, ["internal", "listing"]),
    ]);
    const result = buildListingInputFromCreativeHandoff(handoff as never, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("listing_input_empty");
  });
});
