import { describe, it, expect } from "vitest";
import {
  evidenceSufficient,
  dataInsufficient,
  conflictObvious,
  getCandidateProfileFixture,
  type FixtureEvidenceItem,
} from "@/lib/v4/adapters/fixtures/candidateProfiles";
import { VOC_MIN_SAMPLE } from "@/lib/v4/adapters/voc";

describe("candidate profile fixtures (evidence-schema aligned)", () => {
  it("every evidence item carries kind/sourceType/typedValue/unit/currency/sampleSize/confidenceDimensions/contentHash", () => {
    for (const profile of [evidenceSufficient, dataInsufficient, conflictObvious]) {
      expect(profile.evidenceItems.length).toBeGreaterThan(0);
      for (const item of profile.evidenceItems) {
        const ev = item as FixtureEvidenceItem;
        expect(["source_fact", "platform_metadata", "estimate", "signal", "unknown", "conflict"]).toContain(ev.kind);
        expect(["xlsx", "amazon", "keyword_provider", "review", "supplier", "calculation", "policy"]).toContain(ev.sourceType);
        expect(ev.typedValue).toBeTruthy();
        expect(ev.typedValue.unit === null || typeof ev.typedValue.unit === "string").toBe(true);
        expect(ev.typedValue.currency === null || /^[A-Z]{3}$/.test(ev.typedValue.currency ?? "")).toBe(true);
        expect(ev.sampleSize === null || typeof ev.sampleSize === "number").toBe(true);
        expect(ev.confidenceDimensions === null || typeof ev.confidenceDimensions === "object").toBe(true);
        expect(ev.contentHash).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it("A (evidence sufficient) → now / high / no conflicts", () => {
    expect(evidenceSufficient.priorityBand).toBe("now");
    expect(evidenceSufficient.confidence).toBe("high");
    expect(evidenceSufficient.conflicts).toEqual([]);
    // 关键字段覆盖：价格/销量/关键词/VOC 均有证据
    expect(evidenceSufficient.evidenceItems.some((e) => e.field === "price")).toBe(true);
    expect(evidenceSufficient.evidenceItems.some((e) => e.field === "estimatedMonthlySales")).toBe(true);
    expect(evidenceSufficient.voc.reviews.length).toBe(12);
  });

  it("B (data insufficient) → later/hold / low confidence / missing price & low sample", () => {
    expect(["later", "hold"]).toContain(dataInsufficient.priorityBand);
    expect(dataInsufficient.confidence).toBe("low");
    expect(dataInsufficient.conflicts).toEqual([]);
    // 缺失 price 之外的关键信号（estimatedMonthlySales/reviews/categoryBsr 缺失）
    expect(dataInsufficient.sellersprite.candidates[0].missingSignals).toContain("estimatedMonthlySales");
    expect(dataInsufficient.voc.reviews.length).toBeLessThan(VOC_MIN_SAMPLE);
    expect(dataInsufficient.evidenceItems.some((e) => e.field === "estimatedMonthlySales")).toBe(false);
  });

  it("C (conflict obvious) → needs_review / conflicts non-empty (dual values not auto-normalized)", () => {
    expect(conflictObvious.priorityBand).toBe("needs_review");
    expect(conflictObvious.confidence).toBe("low");
    expect(conflictObvious.conflicts.length).toBeGreaterThanOrEqual(4);
    // 双值并列：keyword exact(third-party)/estimate、rating、price、VOC
    expect(conflictObvious.conflicts.some((c) => c.field === "keyword.monthlySearches")).toBe(true);
    expect(conflictObvious.conflicts.some((c) => c.field === "rating")).toBe(true);
    expect(conflictObvious.conflicts.some((c) => c.field === "price")).toBe(true);
    expect(conflictObvious.conflicts.some((c) => c.field === "voc.cold_retention")).toBe(true);
    expect(conflictObvious.evidenceItems.some((e) => e.kind === "conflict")).toBe(true);
  });

  it("getCandidateProfileFixture returns the same record for each profile", () => {
    expect(getCandidateProfileFixture("evidence_sufficient")).toBe(evidenceSufficient);
    expect(getCandidateProfileFixture("data_insufficient")).toBe(dataInsufficient);
    expect(getCandidateProfileFixture("conflict_obvious")).toBe(conflictObvious);
  });
});
