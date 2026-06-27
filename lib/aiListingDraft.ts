import { containsListingBannedClaim } from "@/lib/listingClaimFilter";

export type AiListingDraftSource = "mock_ai_draft" | "real_ai_draft";

export type AiListingPackDraft = {
  source: AiListingDraftSource;
  version: number;
  generatedAt: string;
  model: string;
  humanReviewRequired: true;
  titles: string[];
  bullets: string[];
  description: string;
  keywords: string[];
  sellingPoints: string[];
  riskNotes: string[];
  complianceWarnings: string[];
  blockedClaims: string[];
  reviewChecklist: string[];
};

export type AiListingDraftValidationResult =
  | { ok: true; data: AiListingPackDraft }
  | { ok: false; error: { code: "invalid_ai_listing_pack"; message: string } };

type MockDraftInput = {
  taskTitle?: string | null;
  productName?: string | null;
  decisionSummary?: string | null;
  riskLevel?: string | null;
  category?: string | null;
  sellingPoints?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function fail(message: string): AiListingDraftValidationResult {
  return { ok: false, error: { code: "invalid_ai_listing_pack", message } };
}

function isAiListingDraftSource(value: unknown): value is AiListingDraftSource {
  return value === "mock_ai_draft" || value === "real_ai_draft";
}

function checkArray(name: keyof AiListingPackDraft, value: unknown, min: number, max?: number): string[] | null {
  const values = stringArray(value);
  if (!Array.isArray(value)) return null;
  if (values.length < min) return null;
  if (max && values.length > max) return null;
  return values;
}

function visibleDraftText(draft: Pick<AiListingPackDraft, "titles" | "bullets" | "description" | "keywords" | "sellingPoints" | "riskNotes" | "reviewChecklist">) {
  return [
    ...draft.titles,
    ...draft.bullets,
    draft.description,
    ...draft.keywords,
    ...draft.sellingPoints,
    ...draft.riskNotes,
    ...draft.reviewChecklist,
  ].join(" ");
}

export function validateAiListingPackDraft(input: unknown): AiListingDraftValidationResult {
  if (!isRecord(input)) return fail("AI Listing draft must be an object.");
  if (!isAiListingDraftSource(input.source)) return fail("AI Listing draft source must be mock_ai_draft or real_ai_draft.");
  const model = text(input.model);
  if (!model) return fail("AI Listing draft model must not be empty.");
  if (input.source === "mock_ai_draft" && model !== "mock") return fail("Mock AI Listing draft model must be mock.");
  if (input.source === "real_ai_draft" && model === "mock") return fail("Real AI Listing draft model must not be mock.");
  if (input.humanReviewRequired !== true) return fail("AI Listing draft must require human review.");

  const version = typeof input.version === "number" && Number.isInteger(input.version) && input.version > 0
    ? input.version
    : null;
  if (!version) return fail("AI Listing draft version must be a positive integer.");

  const generatedAt = text(input.generatedAt);
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) return fail("AI Listing draft generatedAt must be a valid date string.");

  const titles = checkArray("titles", input.titles, 1, 3);
  if (!titles) return fail("AI Listing draft titles must contain 1-3 items.");
  const bullets = checkArray("bullets", input.bullets, 1, 5);
  if (!bullets) return fail("AI Listing draft bullets must contain 1-5 items.");
  const keywords = checkArray("keywords", input.keywords, 1, 12);
  if (!keywords) return fail("AI Listing draft keywords must contain 1-12 items.");
  const sellingPoints = checkArray("sellingPoints", input.sellingPoints, 1, 6);
  if (!sellingPoints) return fail("AI Listing draft sellingPoints must contain 1-6 items.");
  const riskNotes = checkArray("riskNotes", input.riskNotes, 1);
  if (!riskNotes) return fail("AI Listing draft riskNotes must contain at least 1 item.");
  const complianceWarnings = checkArray("complianceWarnings", input.complianceWarnings, 0);
  if (!complianceWarnings) return fail("AI Listing draft complianceWarnings must be an array.");
  const blockedClaims = checkArray("blockedClaims", input.blockedClaims, 0);
  if (!blockedClaims) return fail("AI Listing draft blockedClaims must be an array.");
  const reviewChecklist = checkArray("reviewChecklist", input.reviewChecklist, 1);
  if (!reviewChecklist) return fail("AI Listing draft reviewChecklist must contain at least 1 item.");

  const description = text(input.description);
  if (!description) return fail("AI Listing draft description must not be empty.");

  const draft: AiListingPackDraft = {
    source: input.source,
    version,
    generatedAt,
    model,
    humanReviewRequired: true,
    titles,
    bullets,
    description,
    keywords,
    sellingPoints,
    riskNotes,
    complianceWarnings,
    blockedClaims,
    reviewChecklist,
  };

  if (containsListingBannedClaim(visibleDraftText(draft))) {
    return fail("AI Listing draft still contains banned listing claims.");
  }

  return { ok: true, data: draft };
}

function pickProductName(input: MockDraftInput) {
  return text(input.productName) || text(input.taskTitle) || "Manual Review Product";
}

function safeSellingPoints(input: MockDraftInput) {
  const points = stringArray(input.sellingPoints).slice(0, 3);
  if (points.length > 0) return points;
  return [
    "Clear use scenario for listing copy",
    "Suitable for small batch validation before scaling",
    "Needs supplier documents before final publishing",
  ];
}

export function buildMockAiListingDraft(input: MockDraftInput): AiListingPackDraft {
  const productName = pickProductName(input);
  const riskLevel = text(input.riskLevel, "manual review required");
  const category = text(input.category, "cross-border product");
  const decisionSummary = text(input.decisionSummary, "Current task needs manual review before listing.");
  const points = safeSellingPoints(input);

  return {
    source: "mock_ai_draft",
    version: 1,
    generatedAt: new Date().toISOString(),
    model: "mock",
    humanReviewRequired: true,
    titles: [
      `${productName} for Practical ${category} Use`,
      `${productName} Listing Draft for Small Batch Validation`,
      `${productName} with Supplier Details Pending Review`,
    ],
    bullets: [
      `${productName} can be positioned around a clear everyday use scenario. Confirm real use cases with samples before publishing.`,
      `Key materials, dimensions, package contents and compatibility must be checked against supplier documents.`,
      `Primary selling angle: ${points[0]}. Keep wording factual and avoid unsupported certification or outcome promises.`,
      `Risk level is ${riskLevel}. Review platform rules, trademark exposure and local compliance before using this copy.`,
      `Use this draft as preparation material only. Final listing text must be approved by a human operator.`,
    ],
    description: `${productName} mock AI listing draft based on the saved task context. ${decisionSummary} This draft does not publish anything and must be reviewed against supplier documents, platform policy, IP risk and cost data before use.`,
    keywords: [
      productName,
      category,
      "listing draft",
      "small batch validation",
      "supplier verification",
      "manual review",
      ...points.slice(0, 3),
    ].slice(0, 12),
    sellingPoints: points,
    riskNotes: [
      "Supplier documents, platform rules, IP risk and local compliance must be reviewed before publishing.",
      `Current risk signal: ${riskLevel}.`,
    ],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: [
      "Human review required before publishing.",
      "Confirm material, size, package contents and compatibility with supplier documents.",
      "Check platform category rules, IP risk, certification needs and local regulations.",
      "Verify cost, shipping, margin and after-sales policy before final listing.",
    ],
  };
}
