/**
 * Case D - synthetic golden fixture: Adjustable LED Desk Lamp.
 *
 * SYNTHETIC_GOLDEN_FIXTURE = YES
 * REAL_AI = YES
 *
 * This is fixed benchmark input, not a database task. The confirmed facts below
 * are the ONLY factual authority for Case D, exactly as in production: the
 * writer may not invent any fact outside them. Deliberately excluded so the
 * model cannot coast on easy performance claims: UL certification, FDA, any
 * medical or eye-safety wording, flicker-free, lifetime hours, energy-saving
 * percentages, waterproof, premium-material adjectives.
 */
import { buildListingV5Context, type ListingV5ContextInput } from "@/lib/listingV5/context";

export const CASE_D_ID = "listing-v5-desk-lamp-golden";

export const DESK_LAMP_CONFIRMED_FACTS = [
  { factId: "type-1", field: "product_type", label: "Product type", value: "LED desk lamp" },
  { factId: "color-1", field: "color_or_variant", label: "Color", value: "Black" },
  { factId: "power-1", field: "power_source", label: "Power source", value: "USB-C powered" },
  { factId: "levels-1", field: "brightness_levels", label: "Brightness levels", value: "5 brightness levels" },
  { factId: "temps-1", field: "color_temperatures", label: "Color temperatures", value: "3 color temperatures" },
  { factId: "controls-1", field: "controls", label: "Controls", value: "Touch controls" },
  { factId: "arm-1", field: "adjustability", label: "Adjustability", value: "Adjustable lamp arm" },
  { factId: "included-1", field: "included_components", label: "Included components", value: "Lamp and USB-C cable" },
  { factId: "base-1", field: "base_type", label: "Base", value: "Weighted base" },
  { factId: "dims-1", field: "dimensions", label: "Dimensions", value: '15.7" H x 7.1" W folded, 22.4" H extended' },
] as const;

/** Consumer-need wording only. These describe shoppers, never the product. */
export const DESK_LAMP_VOC = [
  "My desk is small and a big lamp takes over the whole corner.",
  "I read at night and need to dim the light so it does not glare.",
  "I want to change the brightness without hunting for a switch.",
  "The lamp needs to sit still and not slide when I bump the desk.",
  "I need to aim the light at my keyboard in the evening.",
  "Simple controls matter more to me than a lot of features.",
  "I move between reading and office work at the same desk.",
  "I want a light that works with the USB-C cable I already use.",
] as const;

export const DESK_LAMP_KEYWORDS = [
  "led desk lamp",
  "desk lamp",
  "office desk lamp",
  "reading lamp",
  "adjustable desk lamp",
  "touch control desk lamp",
  "usb c desk lamp",
  "black desk lamp",
  "dimmable desk lamp",
  "desk light for home office",
] as const;

/** Short market patterns only - never a competitor listing, never a product fact. */
export const DESK_LAMP_COMPETITORS = [
  { asin: "B0FIXTURE01", note: "Market angle: positions the lamp as a small-footprint option for crowded desks." },
  { asin: "B0FIXTURE02", note: "Market angle: leads with adjustable positioning for reading and keyboard work." },
  { asin: "B0FIXTURE03", note: "Common shopper concern: whether touch controls are easy to find in the dark." },
  { asin: "B0FIXTURE04", note: "Common shopper concern: whether the base stays put on a lightweight desk." },
  { asin: "B0FIXTURE05", note: "Market wording pattern: contrasts warm and cool lighting for evening versus daytime work." },
] as const;

export function buildDeskLampFixtureInput(): ListingV5ContextInput {
  return {
    taskId: CASE_D_ID,
    researchRevision: 1,
    handoffRevision: 1,
    marketplace: "Amazon US",
    productIdentity: "Adjustable LED Desk Lamp",
    generationInput: {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [],
      stableSourceFacts: [],
      creativeReferences: [],
      creativePreferences: {},
      prohibitedClaims: [],
      unknowns: [],
      humanReviewRequired: true,
      researchMode: "market_research_only",
      promotionEligible: false,
    },
    creativeContext: {
      schema: "creative-context.v1",
      version: 1,
      generatedAt: "",
      source: { researchRevision: 1, candidateId: CASE_D_ID },
      confirmedFacts: [],
      confirmableFactCandidates: [],
      vocInsights: DESK_LAMP_VOC.map((summary, index) => ({
        insightId: `voc-${index + 1}`,
        theme: "desk use",
        summary,
        evidenceRefs: [],
        reviewCount: 5 + index,
        coverage: 1,
        strength: "recurring" as const,
        sourceType: "voc_theme",
        provenance: { evidenceRef: `ev:voc-${index + 1}`, sourceType: "voc", observedAt: "" },
      })),
      keywordCandidates: DESK_LAMP_KEYWORDS.map((keyword, index) => ({
        keyword,
        reportType: "search",
        rowNumber: index + 1,
        evidenceRef: `ev:kw-${index + 1}`,
        observedAt: "",
        provenance: { evidenceRef: `ev:kw-${index + 1}`, sourceType: "keyword", observedAt: "" },
      })),
      competitiveContext: DESK_LAMP_COMPETITORS.map((item) => ({
        asin: item.asin,
        note: item.note,
        addedAt: "",
        evidenceRef: `ev:comp-${item.asin}`,
        provenance: { evidenceRef: `ev:comp-${item.asin}`, sourceType: "competitor", observedAt: "" },
      })),
      sourcingContext: [],
      aiReferences: [],
      missingConflicts: [],
      counts: {
        confirmedFacts: 0,
        confirmableCandidates: 0,
        vocInsights: DESK_LAMP_VOC.length,
        keywordCandidates: DESK_LAMP_KEYWORDS.length,
        competitiveInsights: DESK_LAMP_COMPETITORS.length,
        sourcingEntries: 0,
        aiReferences: 0,
        missingConflicts: 0,
      },
    },
    confirmedFacts: DESK_LAMP_CONFIRMED_FACTS.map((fact) => ({ ...fact })),
  };
}

export function buildDeskLampContext() {
  return buildListingV5Context(buildDeskLampFixtureInput());
}

/** Bounded, secret-free evidence summary for the benchmark log. */
export function deskLampEvidenceCounts(context: ReturnType<typeof buildDeskLampContext>) {
  return {
    confirmedFacts: context.confirmedFacts.length,
    voc: context.references.voc.length,
    keywords: context.references.keywords.length,
    competitors: context.references.competitors.length,
    sourcing: context.references.sourcing.length,
  };
}
