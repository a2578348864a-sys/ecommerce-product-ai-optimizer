import { describe, expect, it } from "vitest";
import {
  buildListingClaimEvidenceIndex,
  verifyListingClaims,
  listingClaimsHaveEvidence,
} from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { EvidenceExpressionPack } from "@/lib/listingHandoff/listingEvidenceExpression";

/** Test H：Deutsch 合同——架构不是英文 hardcode */
function deInput(pack: EvidenceExpressionPack): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: [
      { field: "brand", label: "Marke", value: "Hawaiian Tropic" },
      { field: "product_type", label: "Produkttyp", value: "Mineral-Sonnencreme-Pinsel" },
      { field: "capacity", label: "Fassungsvermögen", value: "0.15 Unzen" },
      { field: "functional_feature", label: "Funktion", value: "SPF 30 Breitbandschutz, wasser- und schweißbeständig für bis zu 80 Minuten." },
    ],
    stableSourceFacts: [],
    creativeReferences: [],
    creativePreferences: {},
    prohibitedClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
    evidenceExpressions: pack,
  };
}

const DE_PACK: EvidenceExpressionPack = {
  schema: "listing-evidence-expression.v1",
  targetLanguage: "de",
  generatedAt: null,
  builder: "llm",
  expressions: [
    { factId: "brand", field: "brand", sourceValue: "Hawaiian Tropic", targetLanguage: "de", evidenceKind: "brand", approvedExpressions: ["Hawaiian Tropic"] },
    { factId: "product_type", field: "product_type", sourceValue: "Mineral-Sonnencreme-Pinsel", targetLanguage: "de", evidenceKind: "product_type", approvedExpressions: ["Mineral-Sonnencreme-Pinsel"] },
    { factId: "capacity", field: "capacity", sourceValue: "0.15 Unzen", targetLanguage: "de", evidenceKind: "capacity", approvedExpressions: ["0.15 oz"] },
    { factId: "functional_feature", field: "functional_feature", sourceValue: "SPF 30 Breitbandschutz, wasser- und schweißbeständig für bis zu 80 Minuten.", targetLanguage: "de", evidenceKind: "feature", approvedExpressions: ["SPF 30 Breitbandschutz", "wasser- und schweißbeständig für bis zu 80 Minuten"] },
  ],
};

function makeDraft(titles: string[], bullets: string[], description = ""): Parameters<typeof verifyListingClaims>[0] {
  return {
    source: "real_ai_draft",
    version: 1,
    generatedAt: new Date().toISOString(),
    model: "real-ai-provider",
    composerVersion: "listing-composer-v1",
    generationPolicyVersion: "listing-generation-policy-v1",
    polishApplied: false,
    polishModel: null,
    humanReviewRequired: true,
    titles,
    bullets,
    description,
    keywords: [],
    sellingPoints: bullets.slice(0, 6),
    riskNotes: [],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: [],
  };
}

describe("Listing Evidence Expression Contract — Deutsch", () => {
  it("H1: approved German expressions PASS", () => {
    const input = deInput(DE_PACK);
    const idx = buildListingClaimEvidenceIndex(input);
    expect(idx.some((e) => e.normalizedValue === "0.15 oz")).toBe(true);
    const v = verifyListingClaims(
      makeDraft(
        ["Hawaiian Tropic Mineral-Sonnencreme-Pinsel SPF 30, 0.15 oz"],
        ["SPF 30 Breitbandschutz", "wasser- und schweißbeständig für bis zu 80 Minuten"],
        "",
      ),
      input,
    );
    expect(listingClaimsHaveEvidence(v)).toBe(true);
  });

  it("H2: German overclaim still blocked (wasserfest 100%)", () => {
    const input = deInput(DE_PACK);
    const v = verifyListingClaims(makeDraft([], ["100% wasserfest"], ""), input);
    expect(listingClaimsHaveEvidence(v)).toBe(false);
  });
});
