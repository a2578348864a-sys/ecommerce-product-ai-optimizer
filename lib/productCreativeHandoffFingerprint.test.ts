import { describe, expect, it } from "vitest";
import vectors from "@/lib/fixtures/product-creative-handoff-golden-vectors.json";
import {
  calculateHandoffFingerprint,
  type ProductCreativeHandoffCandidate,
} from "@/lib/productCreativeHandoff";

function goldenCandidate(): ProductCreativeHandoffCandidate {
  return structuredClone(vectors.vectors[0].candidate) as ProductCreativeHandoffCandidate;
}

describe("product creative handoff canonical fingerprint", () => {
  it("matches the frozen golden vector", () => {
    expect(calculateHandoffFingerprint(goldenCandidate())).toBe(vectors.vectors[0].expectedFingerprint);
  });

  it("normalizes Unicode NFC before hashing", () => {
    const composed = goldenCandidate();
    const decomposed = goldenCandidate();
    composed.productIdentity.displayName = "Caf\u00e9 organizer";
    decomposed.productIdentity.displayName = "Cafe\u0301 organizer";

    expect(calculateHandoffFingerprint(decomposed)).toBe(calculateHandoffFingerprint(composed));
  });

  it("ignores JSON object insertion order", () => {
    const base = goldenCandidate();
    const reordered = {
      humanReviewRequired: base.humanReviewRequired,
      visualReferences: base.visualReferences,
      creativePreferences: base.creativePreferences,
      prohibitedClaims: base.prohibitedClaims,
      issues: base.issues,
      aiCreativeReferences: base.aiCreativeReferences,
      stableSourceFacts: base.stableSourceFacts,
      confirmedFacts: base.confirmedFacts,
      productIdentity: {
        identityConfirmedAt: base.productIdentity.identityConfirmedAt,
        marketplace: base.productIdentity.marketplace,
        displayName: base.productIdentity.displayName,
      },
      sourceResearch: {
        candidateSourceFingerprint: base.sourceResearch.candidateSourceFingerprint,
        decisionStatus: base.sourceResearch.decisionStatus,
        workflowStatus: base.sourceResearch.workflowStatus,
        researchHash: base.sourceResearch.researchHash,
        researchRevision: base.sourceResearch.researchRevision,
        candidateId: base.sourceResearch.candidateId,
        recordSchema: base.sourceResearch.recordSchema,
      },
    } satisfies ProductCreativeHandoffCandidate;

    expect(calculateHandoffFingerprint(reordered)).toBe(calculateHandoffFingerprint(base));
  });

  it("sorts semantic sets while preserving their meaning", () => {
    const first = goldenCandidate();
    first.confirmedFacts.push({
      ...structuredClone(first.confirmedFacts[0]),
      factId: "33333333-3333-4333-8333-333333333333",
      field: "color",
      label: "Color",
      value: ["blue", "green"],
      usageScopes: ["image", "listing"],
      sourceRef: {
        ...structuredClone(first.confirmedFacts[0].sourceRef),
        sourceField: "color",
        confirmationReference: "manual-review:color:v1",
      },
    });
    const second = structuredClone(first);
    second.confirmedFacts.reverse();
    second.confirmedFacts[0].usageScopes.reverse();
    second.confirmedFacts[0].value = [...second.confirmedFacts[0].value as string[]].reverse();

    expect(calculateHandoffFingerprint(second)).toBe(calculateHandoffFingerprint(first));
  });

  it("changes when a fact value, usage scope, or prohibited claim changes", () => {
    const base = goldenCandidate();
    const changedValue = goldenCandidate();
    changedValue.confirmedFacts[0].value = "Different material";
    const changedScope = goldenCandidate();
    changedScope.confirmedFacts[0].usageScopes = ["listing"];
    const changedClaim = goldenCandidate();
    changedClaim.prohibitedClaims[0].summary = "Do not state size or dimensions.";

    const fingerprint = calculateHandoffFingerprint(base);
    expect(calculateHandoffFingerprint(changedValue)).not.toBe(fingerprint);
    expect(calculateHandoffFingerprint(changedScope)).not.toBe(fingerprint);
    expect(calculateHandoffFingerprint(changedClaim)).not.toBe(fingerprint);
  });
});
