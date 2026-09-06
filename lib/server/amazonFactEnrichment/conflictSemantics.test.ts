import { describe, expect, it } from "vitest";
import type { AmazonFactCandidateV1 } from "./contract";
import { resolveCandidateConflicts } from "./service";

function candidate(field: AmazonFactCandidateV1["field"], value: string, extra: Partial<AmazonFactCandidateV1> = {}): AmazonFactCandidateV1 {
  return { id: `${field}:${value}`, taskId: "t", asin: "B000000000", field, value, status: "direct", sourceType: "bullet", sources: [{ sourceBlockId: "bullet:0", sourceUrl: "https://amazon.com", section: "bullet", label: "bullet", text: value }], evidenceTexts: [value], approximate: false, negative: false, conflict: false, conflictReason: null, reviewRequired: false, createdAt: "2026-01-01T00:00:00.000Z", ...extra };
}

describe("amazon fact conflict semantics", () => {
  it("allows multi-value functional features", () => expect(resolveCandidateConflicts([candidate("functional_feature", "BPA Free"), candidate("functional_feature", "Airtight")]).every((c) => !c.conflict)).toBe(true));
  it("allows multi-value use scenarios", () => expect(resolveCandidateConflicts([candidate("use_scenario", "Kitchen countertop"), candidate("use_scenario", "Coffee bar")]).every((c) => !c.conflict)).toBe(true));
  it("allows multi-value construction and other facts", () => expect(resolveCandidateConflicts([candidate("construction", "Ceramic body"), candidate("construction", "Fluted design"), candidate("other", "2 pcs utensil holder"), candidate("other", "Gift box included")]).every((c) => !c.conflict)).toBe(true));
  it("only conflicts explicit positive and negative compatibility for the same target", () => { const out = resolveCandidateConflicts([candidate("compatibility", "Compatible with Model X"), candidate("compatibility", "Not compatible with Model X", { negative: true })]); expect(out.every((c) => c.conflict && c.reviewRequired && c.status === "conflict")).toBe(true); });
  it("does not conflict different compatible sizes", () => { const out = resolveCandidateConflicts([candidate("compatibility", "Compatible with 42mm"), candidate("compatibility", "Compatible with 44mm")]); expect(out.every((c) => !c.conflict && c.reviewRequired && c.status === "review")).toBe(true); });
  it("downgrades multiple capacities to review instead of conflict", () => { const out = resolveCandidateConflicts([candidate("capacity", "370 ml"), candidate("capacity", "650 ml")]); expect(out.every((c) => !c.conflict && c.reviewRequired && c.status === "review")).toBe(true); });
  it("merges identical field and value candidates", () => { const out = resolveCandidateConflicts([candidate("other", "Two sizes"), candidate("other", "two sizes", { sources: [{ sourceBlockId: "aplus:0", sourceUrl: "https://amazon.com", section: "aplus", label: "aplus", text: "two sizes" }], evidenceTexts: ["two sizes"] })]); expect(out).toHaveLength(1); expect(out[0].sources).toHaveLength(2); });
  it("marks only explicit care and operation contradictions", () => { const care = resolveCandidateConflicts([candidate("care", "Dishwasher safe"), candidate("care", "Hand wash only")]); const operation = resolveCandidateConflicts([candidate("operation", "Assembly required"), candidate("operation", "No assembly required")]); expect(care.every((c) => c.conflict)).toBe(true); expect(operation.every((c) => c.conflict)).toBe(true); });
});
