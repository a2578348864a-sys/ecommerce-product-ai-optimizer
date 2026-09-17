import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * backendSearchTerms 安全边界回归。
 *
 * 2026-09 最终审计发现：`conversionRewrite.ts` 已经从 rewrite 路径挡掉了硬词，
 * 但 Writer 归一化（provider 返回）与确定性 fallback 两条路径都没有挡——
 * 而这是 Validator **唯一不检查**、却会直接下发到客户端的字段。
 * 本测试锁定：任何 draft 生产路径都必须经过同一条边界。
 */

const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

import { filterListingV5BackendSearchTerms } from "./backendTermSafety";
import { generateListingV5Draft } from "./generation";
import type { ListingV5Context, ListingV5Strategy, ListingV5WriterDraft } from "./types";

function context(): ListingV5Context {
  return {
    version: "listing-v5.context.v1",
    taskId: "task-backend-terms",
    researchRevision: 1,
    handoffRevision: 1,
    contextFingerprint: "fp",
    marketplace: "Amazon US",
    productIdentity: "Water Bottle",
    confirmedFacts: [
      { id: "fact-1", canonicalField: "material", label: "Material", value: "stainless steel", sourceRefs: [] },
    ],
    prohibitedClaims: [],
    unknowns: [],
    references: { voc: [], keywords: [], competitors: [], sourcing: [] },
    manualDirection: null,
  } as unknown as ListingV5Context;
}

function strategy(backendOnly: string[]): ListingV5Strategy {
  return {
    version: "listing-v5.strategy.v1",
    referenceOnly: true,
    researchRevision: 1,
    targetAudience: ["shoppers"],
    purchaseMotivations: ["clear value"],
    painPoints: [],
    useCases: ["everyday use"],
    primaryAngle: "Make the bottle easier to understand",
    secondaryAngles: [],
    tone: ["clear"],
    keywordIntent: { primary: ["bottle"], secondary: [], backendOnly },
    bulletAngles: [{ role: "core_outcome", shopperValue: "understand the main product value" }],
    avoidClaims: [],
  } as unknown as ListingV5Strategy;
}

function draftWith(backendSearchTerms: string[]): ListingV5WriterDraft {
  return {
    version: "listing-v5.writer-draft.v1",
    title: { text: "Bottle", factIds: ["fact-1"] },
    bullets: [{ text: "Stainless steel fits everyday routines.", factIds: ["fact-1"], strategyRole: "core_outcome" }],
    description: { text: "A bottle for daily use.", factIds: ["fact-1"] },
    backendSearchTerms,
    humanReviewRequired: true,
  } as unknown as ListingV5WriterDraft;
}

describe("filterListingV5BackendSearchTerms（既有硬词边界）", () => {
  it("drops terms carrying a hard or escalation token", () => {
    const result = filterListingV5BackendSearchTerms(draftWith([
      "bottle",
      "leakproof bottle",
      "insulated tumbler",
      "heavy-duty rack",
      "bpa free cup",
      "kitchen organizer",
    ]));
    expect(result.backendSearchTerms).toEqual(["bottle", "kitchen organizer"]);
  });

  it("keeps order, drops empties, and caps the field at 12 terms", () => {
    // Note: "safe" is itself a hard token in claimVocabulary, so the filler terms
    // must avoid every entry of the shared table.
    const many = Array.from({ length: 15 }, (_, index) => `kitchen organizer ${index}`);
    const result = filterListingV5BackendSearchTerms(draftWith(["", ...many]));
    expect(result.backendSearchTerms).toHaveLength(12);
    expect(result.backendSearchTerms![0]).toBe("kitchen organizer 0");
    expect(result.backendSearchTerms![11]).toBe("kitchen organizer 11");
  });

  it("does not touch any other draft field", () => {
    const draft = draftWith(["leakproof bottle"]);
    const result = filterListingV5BackendSearchTerms(draft);
    expect(result.title).toEqual(draft.title);
    expect(result.bullets).toEqual(draft.bullets);
    expect(result.description).toEqual(draft.description);
    expect(result.humanReviewRequired).toBe(true);
  });
});

describe("generateListingV5Draft 两条路径都经过该边界", () => {
  beforeEach(() => {
    callAiJson.mockReset();
  });

  it("确定性 fallback（未启用 Provider）不会把 keywordIntent.backendOnly 的硬词下发", async () => {
    const result = await generateListingV5Draft(
      context(),
      strategy(["bottle", "leakproof bottle", "insulated tumbler", "kitchen organizer"]),
      { useProvider: false },
    );

    expect(callAiJson).not.toHaveBeenCalled();
    expect(result.providerAttempted).toBe(false);
    expect(result.draft!.backendSearchTerms).toEqual(["bottle", "kitchen organizer"]);
  });

  it("Writer 归一化不会让 Provider 返回的关键词绕过边界", async () => {
    callAiJson.mockResolvedValue({
      ok: true,
      providerCallStarted: true,
      data: {
        title: { text: "Stainless Steel Water Bottle", factIds: ["fact-1"] },
        bullets: [
          { text: "A clear material detail for everyday use.", factIds: ["fact-1"], strategyRole: "core_outcome" },
          { text: "Keeps the choice easy to compare.", factIds: ["fact-1"], strategyRole: "pain_relief" },
          { text: "Suits daily routines where clarity helps.", factIds: ["fact-1"], strategyRole: "use_scenario" },
        ],
        description: { text: "A bottle that presents confirmed details clearly.", factIds: ["fact-1"] },
        backendSearchTerms: ["bottle", "leakproof bottle", "insulated tumbler", "kitchen organizer"],
      },
    });

    const result = await generateListingV5Draft(context(), strategy([]), { useProvider: true });

    expect(callAiJson).toHaveBeenCalledTimes(1);
    expect(result.providerSucceeded).toBe(true);
    expect(result.draft!.backendSearchTerms).toEqual(["bottle", "kitchen organizer"]);
  });
});
