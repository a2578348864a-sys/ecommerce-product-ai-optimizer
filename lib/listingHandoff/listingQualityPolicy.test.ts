import { describe, expect, it } from "vitest";
import { evaluateListingQualityPolicy } from "./listingQualityPolicy";

const facts = [
  { field: "brand", label: "Brand", value: "Acme" },
  { field: "product_type", label: "Product type", value: "Organizer" },
  { field: "material", label: "Material", value: "Ceramic" },
  { field: "quantity_or_pack_size", label: "Quantity", value: "2 Count" },
  { field: "usage", label: "Usage", value: "Kitchen counter" },
];

describe("Listing Quality Policy", () => {
  it("detects repeated title attributes without changing the title", () => {
    const report = evaluateListingQualityPolicy({ title: "Acme Acme Ceramic Organizer, Ceramic", bullets: [], description: "", facts });
    expect(report.issues.some((item) => item.code === "title_repeated_attribute")).toBe(true);
    expect(report.titleScore).toBeLessThan(100);
  });

  it("flags a bullet that has a feature but no buyer benefit", () => {
    const report = evaluateListingQualityPolicy({ title: "Acme Ceramic Organizer", bullets: ["The organizer comes in a 2 Count."], description: "An organizer for kitchen counter storage.", facts });
    expect(report.issues.some((item) => item.code === "bullet_missing_benefit")).toBe(true);
    expect(report.suggestions.some((item) => item.code === "bullet_benefit_suggestion" && facts.some((fact) => fact.value === item.factValue))).toBe(true);
  });

  it("flags an unknown compliance claim while leaving the content unchanged", () => {
    const report = evaluateListingQualityPolicy({ title: "Acme Waterproof Organizer", bullets: ["The ceramic organizer helps keep kitchen tools organized."], description: "An organizer for kitchen counter storage.", facts });
    expect(report.issues.some((item) => item.code === "unsupported_compliance_risk")).toBe(true);
    expect(report.complianceScore).toBeLessThan(100);
  });

  it("reports a missing description scenario", () => {
    const report = evaluateListingQualityPolicy({ title: "Acme Ceramic Organizer", bullets: ["Ceramic construction helps organize tools on the counter."], description: "A ceramic organizer with a 2 Count.", facts });
    expect(report.missingSections).toContain("scenario");
    expect(report.descriptionScore).toBeLessThan(100);
  });

  it("does not flag a supported risk word when the confirmed fact explicitly supports it", () => {
    const supportedFacts = [...facts, { field: "construction", label: "Construction", value: "Durable ceramic" }];
    const report = evaluateListingQualityPolicy({ title: "Acme Durable Organizer", bullets: ["Durable ceramic helps organize kitchen tools on the counter."], description: "A durable ceramic organizer for kitchen counter storage.", facts: supportedFacts });
    expect(report.issues.some((item) => item.code === "unsupported_compliance_risk")).toBe(false);
  });

  it("returns no errors for a normal fact-grounded listing", () => {
    const report = evaluateListingQualityPolicy({
      title: "Acme Ceramic Organizer, 2 Count",
      bullets: [
        "Ceramic construction helps keep kitchen tools organized on the counter.",
        "Includes a 2 Count to separate everyday tools for quick access.",
      ],
      description: "This organizer is a ceramic product for kitchen counter storage. The 2 Count helps separate everyday tools and keep the workspace organized.",
      facts,
    });
    expect(report.issues).toEqual([]);
    expect(report.complianceScore).toBe(100);
    expect(report.overallScore).toBeGreaterThanOrEqual(90);
  });
});
