import { verifyListingClaims } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { ListingV5Context, ListingV5Strategy, ListingV5ValidationResult, ListingV5WriterDraft } from "./types";

const words = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const sentenceCount = (value: string) => value.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length;
const normalize = (value: string) => words(value).join(" ");
const overlap = (candidate: string, reference: string) => {
  const a = words(candidate);
  const b = words(reference);
  for (let i = 0; i <= a.length - 12; i += 1) {
    const phrase = a.slice(i, i + 12).join(" ");
    if (normalize(reference).includes(phrase)) return phrase;
  }
  return null;
};

export function validateListingV5Draft(context: ListingV5Context, strategy: ListingV5Strategy, draft: ListingV5WriterDraft): ListingV5ValidationResult {
  const allowed = new Set(context.confirmedFacts.map((fact) => fact.id));
  const titleIssues: string[] = [];
  if (!draft.title.text.trim()) titleIssues.push("title_empty");
  if (draft.title.factIds.some((id) => !allowed.has(id))) titleIssues.push("title_fact_id_not_allowed");
  const bulletResults = draft.bullets.map((bullet, index) => {
    const issues: string[] = [];
    if (!bullet.text.trim()) issues.push("empty_bullet");
    if (bullet.factIds.length === 0) issues.push("missing_confirmed_fact_anchor");
    if (bullet.factIds.some((id) => !allowed.has(id))) issues.push("bullet_fact_id_not_allowed");
    if (index > 0 && strategy.bulletAngles[index - 1]?.shopperValue === strategy.bulletAngles[index]?.shopperValue) issues.push("repeated_shopper_value");
    if (/\b(?:brand|material|color|quantity|product type)\s*:/i.test(bullet.text)) issues.push("field_label_stacking");
    return { valid: issues.length === 0, factIds: bullet.factIds, strategyRole: bullet.strategyRole, issues };
  });
  const descriptionIssues: string[] = [];
  if (!draft.description.text.trim()) descriptionIssues.push("description_empty");
  const sentences = sentenceCount(draft.description.text);
  if (sentences < 2 || sentences > 4) descriptionIssues.push("description_should_be_2_to_4_sentences");
  if (normalize(draft.description.text) === normalize(draft.title.text)) descriptionIssues.push("description_repeats_title");
  const generationInput: ListingGenerationInput = {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: context.handoffRevision, researchRevision: context.researchRevision },
    productFacts: context.confirmedFacts.map((fact) => ({ field: fact.id, label: fact.label, value: fact.value })),
    stableSourceFacts: [], creativeReferences: [], creativePreferences: {}, prohibitedClaims: context.prohibitedClaims,
    unknowns: context.unknowns, humanReviewRequired: true, researchMode: "market_research_only", promotionEligible: false,
  };
  const evidence = verifyListingClaims({
    source: "real_ai_draft", version: 1, generatedAt: new Date(0).toISOString(), model: "listing-v5-validator",
    humanReviewRequired: true, titles: [draft.title.text], bullets: draft.bullets.map((item) => item.text), description: draft.description.text,
    keywords: [], sellingPoints: [], riskNotes: [], complianceWarnings: [], blockedClaims: [], reviewChecklist: [],
  }, generationInput);
  const competitorOverlap = context.references.competitors.flatMap((ref) => {
    const hit = overlap([draft.title.text, ...draft.bullets.map((item) => item.text), draft.description.text].join(" "), ref.text);
    return hit ? [hit] : [];
  });
  // Existing Claim Evidence remains the authority for hard claims. V5 permits
  // only bounded connective shopper language when the same segment contains an
  // exact confirmed value; unknown/performance/certification/prohibited reasons
  // remain blocking and are never softened.
  // A fact anchor cannot vouch for every additional assertion in its sentence.
  // Keep the existing resolver's safe connective-language allowance for
  // bounded Feature -> Benefit prose, but reject unclassified segments that
  // contain a recognizable hard/performance/care assertion even when a fact
  // value is also present (for example, "Steel ... dishwasher safe").
  const allowedValues = context.confirmedFacts.map((fact) => fact.value.toLowerCase()).filter(Boolean);
  const unsupportedHardLanguage = /\b(?:dishwasher\s+safe|food\s+safe|leakproof|spillproof|durable|long[- ]lasting|keeps?|stays?|lasts?|certified|bpa[- ]?free|fda|safe\s+for|resists?|prevents?)\b/i;
  const unsupportedClaims = evidence.unsupportedClaims
    .filter((item) => item.reason !== "unclassified_factual_claim"
      || unsupportedHardLanguage.test(item.text)
      || !allowedValues.some((value) => item.text.toLowerCase().includes(value)))
    .map((item) => item.text).slice(0, 10);
  const prohibitedClaims = evidence.prohibitedClaims.slice(0, 10);
  const keywordStuffing = strategy.keywordIntent.primary.length + strategy.keywordIntent.secondary.length > 0
    && words([draft.title.text, ...draft.bullets.map((item) => item.text)].join(" ")).filter((word) => strategy.keywordIntent.primary.some((term) => normalize(term).includes(word))).length > 8;
  const repetitive = new Set(draft.bullets.map((item) => normalize(item.text))).size !== draft.bullets.length;
  const mechanicalTemplate = draft.bullets.filter((item) => /^(?:with|this|the)\s/i.test(item.text)).length >= 4;
  const hardIssues = unsupportedClaims.length + prohibitedClaims.length + competitorOverlap.length;
  const structuralIssues = titleIssues.length + bulletResults.filter((item) => !item.valid).length + descriptionIssues.length;
  const status = hardIssues > 0 ? "BLOCK" : structuralIssues > 0 || repetitive || keywordStuffing || mechanicalTemplate ? "REPAIRABLE" : "PASS";
  return {
    version: "listing-v5.validation.v1", status,
    title: { valid: titleIssues.length === 0, issues: titleIssues }, bullets: bulletResults,
    description: { valid: descriptionIssues.length === 0, issues: descriptionIssues },
    claims: { allHaveEvidence: unsupportedClaims.length === 0 && prohibitedClaims.length === 0, unsupportedClaims, prohibitedClaims, competitorOverlap },
    quality: { repetitive, keywordStuffing, mechanicalTemplate },
    repair: { allowed: status === "REPAIRABLE", reason: status === "REPAIRABLE" ? "仅允许一次结构化修复" : null },
  };
}
