/**
 * V3 Final PHASE 1 — Canonical Fact Mapping Adapter 单测
 * 覆盖：唯一映射表 / scope 分配（internal vs product）/ 未知字段 fail-closed / factId 确定性 / 溯源标记。
 */
import { describe, expect, it } from "vitest";
import { mapResearchConfirmedToHandoff, RESEARCH_TO_LISTING_FIELD_MAP } from "@/lib/canonicalFactMapping";
import type { ConfirmedFactCandidate } from "@/lib/factCandidates";

const actor = { mode: "owner" as const, subjectFingerprint: "a".repeat(16) };

function confirmed(items: Array<Partial<ConfirmedFactCandidate> & { field: string; value: string | number }>): ConfirmedFactCandidate[] {
  return items.map((item) => ({
    candidateId: `amazon_product_info:${item.field}`,
    label: item.field,
    sourceKind: "amazon_product_info",
    sourceRef: `browserEvidence.snapshots[0].productInfo.${item.field}`,
    humanConfirmationRequired: true,
    confirmedAt: "2026-08-19T00:00:00.000Z",
    confirmedBy: "owner:v1",
    ...item,
    field: item.field,
    value: item.value,
  }));
}

describe("canonicalFactMapping（唯一 Canonical Adapter）", () => {
  it("映射表覆盖 research→consumer 字段（price→price_usd、reviews→review_count）", () => {
    expect(RESEARCH_TO_LISTING_FIELD_MAP.price).toBe("price_usd");
    expect(RESEARCH_TO_LISTING_FIELD_MAP.reviews).toBe("review_count");
    expect(RESEARCH_TO_LISTING_FIELD_MAP.material).toBe("material");
    expect(RESEARCH_TO_LISTING_FIELD_MAP.dimensions).toBe("dimensions");
  });

  it("market 信号字段（category/price/rating/reviews/bsr）→ 仅 internal scope（不进 Listing 声明）", () => {
    const { facts } = mapResearchConfirmedToHandoff({
      confirmed: confirmed([
        { field: "price", value: 19.99 },
        { field: "rating", value: 4.7 },
        { field: "category", value: "Kitchen & Dining" },
      ]),
      actor,
      candidateId: "cand-1",
      confirmedAt: "2026-08-19T00:00:00.000Z",
    });
    expect(facts).toHaveLength(3);
    for (const fact of facts) expect(fact.usageScopes).toEqual(["internal"]);
    expect(facts.find((f) => f.field === "price_usd")?.value).toBe(19.99);
  });

  it("Product 事实（material/dimensions/weight/care 等）→ internal+listing+image（经 Human Confirm 后可消费）", () => {
    const { facts } = mapResearchConfirmedToHandoff({
      confirmed: confirmed([
        { field: "material", value: "Stainless Steel" },
        { field: "dimensions", value: "2.7\"W x 6.9\"H" },
        { field: "care", value: "Top Rack Dishwasher Safe" },
      ]),
      actor,
      candidateId: "cand-1",
      confirmedAt: "2026-08-19T00:00:00.000Z",
    });
    expect(facts).toHaveLength(3);
    for (const fact of facts) {
      expect(fact.usageScopes).toEqual(["internal", "listing", "image"]);
      expect(fact.evidenceTier).toBe("human_confirmed");
      expect(fact.sourceRef.sourceKind).toBe("user_confirmation");
      expect(fact.sourceRef.confirmationReference).toBe("fact-candidates:cand-1");
    }
  });

  it("未知字段 fail-closed（跳过，不静默进入 Listing）", () => {
    const { facts, skipped } = mapResearchConfirmedToHandoff({
      confirmed: confirmed([
        { field: "material", value: "Wood" },
        { field: "some_unknown_field", value: "x" },
      ]),
      actor,
      candidateId: "cand-1",
      confirmedAt: "2026-08-19T00:00:00.000Z",
    });
    expect(facts).toHaveLength(1);
    expect(skipped).toEqual([{ field: "some_unknown_field", reason: "unknown_field_fail_closed" }]);
  });

  it("factId 确定性：同 candidate/field/value/confirmedAt → 同 factId（幂等基础）", () => {
    const input = {
      confirmed: confirmed([{ field: "material", value: "Wood" }]),
      actor,
      candidateId: "cand-1",
      confirmedAt: "2026-08-19T00:00:00.000Z",
    };
    const a = mapResearchConfirmedToHandoff(input).facts[0];
    const b = mapResearchConfirmedToHandoff(input).facts[0];
    expect(a.factId).toBe(b.factId);
    expect(a.factId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("不同 value → 不同 factId（内容变化可区分）", () => {
    const base = {
      actor,
      candidateId: "cand-1",
      confirmedAt: "2026-08-19T00:00:00.000Z",
    };
    const a = mapResearchConfirmedToHandoff({ ...base, confirmed: confirmed([{ field: "material", value: "Wood" }]) }).facts[0];
    const b = mapResearchConfirmedToHandoff({ ...base, confirmed: confirmed([{ field: "material", value: "Plastic" }]) }).facts[0];
    expect(a.factId).not.toBe(b.factId);
  });
});
