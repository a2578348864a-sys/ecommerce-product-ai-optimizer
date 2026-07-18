import { describe, expect, it } from "vitest";
import { renderStage15EffectivenessHumanEvaluationForm } from "./generate-stage15-effectiveness-human-evaluation";

describe("Stage 1.5 human evaluation Markdown form", () => {
  it("renders blinded evidence and empty answer fields without source identifiers", () => {
    const form = renderStage15EffectivenessHumanEvaluationForm({
      items: [{
        evaluationItemId: "evaluation-abc",
        evidence: {
          title: { value: "Storage box", missingReason: null },
          variantText: { value: null, missingReason: "variant_not_visible" },
          dimensionsAndWeight: { value: [], missingReason: "dimensions_or_weight_not_visible" },
          materialAndConstruction: { value: [], missingReason: "material_or_construction_not_visible" },
          assemblyUsageAndRiskFacts: { value: [], missingReason: "assembly_usage_or_capacity_not_visible" },
          featureBullets: { value: ["Foldable"], missingReason: null },
          reviewSnippets: { value: [], missingReason: "counter_evidence_not_visible" },
        },
      }],
    });

    expect(form).toContain("evaluation-abc");
    expect(form).toContain("Storage box");
    expect(form).toContain("Foldable");
    expect(form).toContain("dimensions\\_or\\_weight\\_not\\_visible");
    expect(form).toContain("worthFurtherInvestigation:");
    expect(form).toContain("evidenceSufficient:");
    expect(form).toContain("confidence:");
    for (const forbidden of ["pilotItemId", "expectedAsin", "observedAsin", "sourceUrlHash", "safePath", "stage1Rank", "groupAssignment", "lockedHuman"]) {
      expect(form).not.toContain(forbidden);
    }
  });
});
