import { containsListingBannedClaim, filterListingClaims } from "@/lib/listingClaimFilter";
import type { StudioListingPreferences } from "@/lib/studioListingInput";

export type AiListingDraftSource =
  | "mock_ai_draft"
  | "real_ai_draft"
  | "deterministic_composition_v1"
  | "deterministic_composition_with_polish";

/** 内部审计附录：逐句 factRefs（仅内部审计；消费者 DTO 必须剥离） */
export type ListingFactRefsAudit = {
  titles: string[][];
  bullets: string[][];
  description: string[][];
};

export type AiListingPackDraft = {
  source: AiListingDraftSource;
  version: number;
  generatedAt: string;
  model: string;
  composerVersion?: string;
  generationPolicyVersion?: string;
  polishApplied?: boolean;
  polishModel?: string | null;
  humanReviewRequired: true;
  titles: string[];
  bullets: string[];
  description: string;
  keywords: string[];
  /** Quality.1：Amazon Backend Search Terms（≤250 bytes，去重） */
  backendSearchTerms?: string[];
  /** Quality.1：草稿类型（optimized_listing / safe_fact_draft），UI 据此区分展示 */
  draftKind?: "ai_optimized_listing" | "structured_listing_draft" | "safe_fact_draft";
  /** Optional draft-level audit trail; validated server-side before persistence. */
  usedFactIds?: string[];
  sellingPoints: string[];
  riskNotes: string[];
  complianceWarnings: string[];
  blockedClaims: string[];
  reviewChecklist: string[];
  /** 内部审计附录（可选；schema 校验后透传，消费者字段不导出） */
  factRefsAudit?: ListingFactRefsAudit;
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
  studioPreferences?: StudioListingPreferences;
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
  return value === "mock_ai_draft"
    || value === "real_ai_draft"
    || value === "deterministic_composition_v1"
    || value === "deterministic_composition_with_polish";
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

/** 有界 factRefsAudit schema：仅允许 titles/bullets/description 三键，每组句数组有界、引用有界、无未知键。 */
function parseFactRefsAudit(value: unknown): ListingFactRefsAudit | null {
  if (value === undefined) return undefined as unknown as ListingFactRefsAudit | null;
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((k) => k !== "titles" && k !== "bullets" && k !== "description")) return null;
  const out: { titles?: string[][]; bullets?: string[][]; description?: string[][] } = {};
  const BOUNDS: Array<[string, number]> = [["titles", 3], ["bullets", 5], ["description", 5]];
  for (const [key, maxGroups] of BOUNDS) {
    const v = value[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length > maxGroups) return null;
    const groups: string[][] = [];
    for (const g of v) {
      if (!Array.isArray(g) || g.length > 32) return null;
      const refs: string[] = [];
      for (const r of g) {
        if (typeof r !== "string" || r.trim().length === 0 || r.length > 80) return null;
        refs.push(r.trim());
      }
      groups.push(refs);
    }
    (out as Record<string, string[][]>)[key] = groups;
  }
  return out as ListingFactRefsAudit;
}

export function validateAiListingPackDraft(input: unknown): AiListingDraftValidationResult {
  if (!isRecord(input)) return fail("AI Listing draft must be an object.");
  if (!isAiListingDraftSource(input.source)) return fail("AI Listing draft source is invalid.");
  const model = text(input.model);
  if (!model) return fail("AI Listing draft model must not be empty.");
  if (input.source === "mock_ai_draft" && model !== "mock") return fail("Mock AI Listing draft model must be mock.");
  if (input.source === "real_ai_draft" && model === "mock") return fail("Real AI Listing draft model must not be mock.");
  const deterministicSource = input.source === "deterministic_composition_v1"
    || input.source === "deterministic_composition_with_polish";
  const composerVersion = deterministicSource ? text(input.composerVersion) : "";
  const generationPolicyVersion = deterministicSource ? text(input.generationPolicyVersion) : "";
  if (deterministicSource && !composerVersion) return fail("Deterministic Listing draft composerVersion must not be empty.");
  if (deterministicSource && !generationPolicyVersion) return fail("Deterministic Listing draft generationPolicyVersion must not be empty.");
  if (input.source === "deterministic_composition_v1") {
    if (input.polishApplied !== false) return fail("Base deterministic Listing draft must not claim AI polish.");
    if (input.polishModel !== null) return fail("Base deterministic Listing draft polishModel must be null.");
  }
  if (input.source === "deterministic_composition_with_polish") {
    if (input.polishApplied !== true || !text(input.polishModel)) {
      return fail("Polished deterministic Listing draft must identify its polish model.");
    }
  }
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
  // 无 Keyword Brief 时正文仍可生成，但不得凭确认事实自动制造 SEO 关键词。
  const keywords = checkArray("keywords", input.keywords, 0, 12);
  if (!keywords) return fail("AI Listing draft keywords must be an array with at most 12 items.");
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

  // English-only 合同：最终有效草稿（deterministic / real AI）用户可见字段
  // （title/bullets/description/keywords）不得含中文字符或中文标点（。，；：、！？）。
  // 发现中文 → 不标记为有效草稿。
  // mock_ai_draft 为测试替身，不执行此校验。
  if (input.source !== "mock_ai_draft") {
    const HAS_CJK = /[一-鿿㐀-䶿]/;
    const HAS_CJK_PUNCT = /[。，；：、！？]/;
    const cjkFields: string[] = [];
    for (const t of titles) if (HAS_CJK.test(t) || HAS_CJK_PUNCT.test(t)) cjkFields.push("title");
    for (const b of bullets) if (HAS_CJK.test(b) || HAS_CJK_PUNCT.test(b)) cjkFields.push("bullet");
    if (HAS_CJK.test(description) || HAS_CJK_PUNCT.test(description)) cjkFields.push("description");
    for (const k of keywords) if (HAS_CJK.test(k) || HAS_CJK_PUNCT.test(k)) cjkFields.push("keyword");
    if (cjkFields.length > 0) {
      return fail(`AI Listing draft contains non-English characters in user-visible fields: ${[...new Set(cjkFields)].join(",")}`);
    }
  }

  // Quality.1：backendSearchTerms（可选）≤250 bytes；draftKind 合法
  const backendSearchTerms = Array.isArray(input.backendSearchTerms)
    ? input.backendSearchTerms.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 50)
    : undefined;
  if (backendSearchTerms && Buffer.byteLength(backendSearchTerms.join(" "), "utf8") > 250) {
    return fail("AI Listing draft backendSearchTerms must fit within 250 bytes.");
  }
  const draftKind = input.draftKind === undefined
    ? undefined
    : (input.draftKind === "ai_optimized_listing" || input.draftKind === "structured_listing_draft" || input.draftKind === "safe_fact_draft")
      ? input.draftKind
      : null;
  if (draftKind === null) return fail("AI Listing draft draftKind is invalid.");
  const usedFactIds = input.usedFactIds === undefined
    ? undefined
    : checkArray("usedFactIds", input.usedFactIds, 0, 50);
  if (input.usedFactIds !== undefined && !usedFactIds) {
    return fail("AI Listing draft usedFactIds must be an array with at most 50 items.");
  }

  const factRefsAudit = parseFactRefsAudit(input.factRefsAudit);
  if (input.factRefsAudit !== undefined && !factRefsAudit) {
    return fail("AI Listing draft factRefsAudit is invalid or exceeds bounds.");
  }

  const draft: AiListingPackDraft = {
    source: input.source,
    version,
    generatedAt,
    model,
    ...(deterministicSource ? {
      composerVersion,
      generationPolicyVersion,
      polishApplied: input.polishApplied as boolean,
      polishModel: input.polishModel as string | null,
    } : {}),
    humanReviewRequired: true,
    titles,
    bullets,
    description,
    keywords,
    ...(backendSearchTerms ? { backendSearchTerms } : {}),
    ...(draftKind ? { draftKind } : {}),
    ...(usedFactIds ? { usedFactIds } : {}),
    ...(factRefsAudit ? { factRefsAudit } : {}),
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

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildStudioMockDraft(input: MockDraftInput, preferences: StudioListingPreferences): AiListingPackDraft {
  const productName = pickProductName(input);
  const riskLevel = text(input.riskLevel, "manual review required");
  const category = text(input.category, "cross-border product");
  const decisionSummary = text(input.decisionSummary, "Product facts still need manual verification.");
  const basePoints = safeSellingPoints(input);
  const confirmedFacts = stringArray(preferences.confirmedFacts);
  const unverifiedFacts = stringArray(preferences.unverifiedFacts);
  const prohibitedClaims = stringArray(preferences.prohibitedClaims);
  const listingObjective = preferences.listingObjective || "balanced";
  const points = uniqueStrings([
    ...confirmedFacts,
    ...preferences.differentiators,
    preferences.coreFunction,
    ...basePoints,
  ]).slice(0, 6);
  const primaryKeyword = preferences.primaryKeywords[0] || productName;
  const keywords = uniqueStrings([
    ...preferences.primaryKeywords,
    ...preferences.secondaryKeywords,
    productName,
    category,
  ]).slice(0, 12);
  const competitorNote = preferences.competitorKeywords.length
    ? `${preferences.competitorKeywords.length} competitor research term(s) were supplied for leakage checks only and excluded from the draft.`
    : "No competitor research terms were supplied.";
  const confirmedFactText = confirmedFacts.slice(0, 3).join("; ");
  const pendingFactNote = unverifiedFacts.length
    ? `Pending manual confirmation; do not use as product facts: ${unverifiedFacts.join("; ")}.`
    : "No pending fact statements were supplied.";
  const prohibitedNote = prohibitedClaims.length
    ? `${prohibitedClaims.length} operator-prohibited claim(s) must remain excluded from all output.`
    : "No additional operator-prohibited claims were supplied.";

  if (preferences.outputLanguage === "de") {
    const toneLead = {
      professional: "Sachlicher Produktentwurf",
      conversion: "Nutzenorientierter Produktentwurf",
      concise: "Kompakter Produktentwurf",
      brand: "Markenorientierter Produktentwurf",
    }[preferences.tone];
    const objectiveLead = {
      balanced: "Ausgewogene, faktische Struktur",
      seo: "Suchorientierte Struktur ohne Rankingversprechen",
      conversion: "Nutzenorientierte Struktur ohne Conversionversprechen",
      brand: "Markenkonsistente Struktur",
    }[listingObjective];
    const audience = preferences.targetAudience || "die vorgesehene Zielgruppe";
    const problem = preferences.problemSolved || "den beschriebenen Anwendungsbedarf";
    const functionText = preferences.coreFunction || points[0];
    const differences = preferences.differentiators.length
      ? preferences.differentiators.join("; ")
      : points.join("; ");

    return {
      source: "mock_ai_draft",
      version: 1,
      generatedAt: new Date().toISOString(),
      model: "mock",
      humanReviewRequired: true,
      titles: [
        `${primaryKeyword} – ${productName} für den Markt ${preferences.targetMarket}`,
        `${productName} für ${audience}`,
      ],
      bullets: [
        `Kernfunktion: ${functionText}. Bestätigte Angaben: ${confirmedFactText || "keine angegeben"}. Vor Veröffentlichung anhand des Produktmusters prüfen.`,
        `Zielgruppe: ${audience}. Der Entwurf adressiert: ${problem}.`,
        `Unterscheidungsmerkmale: ${differences}. Nur belegbare Produktfakten übernehmen.`,
        `SEO-Hinweis für ${preferences.targetMarket}: ${preferences.secondaryKeywords.join(", ") || "keine zusätzlichen Suchbegriffe angegeben"}. Begriffe natürlich und sachlich verwenden.`,
        `Risikostufe ${riskLevel}: Lieferantendokumente, Schutzrechte und Plattformregeln manuell prüfen.`,
      ],
      description: `${toneLead}. ${objectiveLead} für ${productName} im Markt ${preferences.targetMarket}. ${decisionSummary} Bestätigte Angaben: ${confirmedFactText || "keine angegeben"}. Kernfunktion: ${functionText}. Zielgruppe: ${audience}. Bedarf: ${problem}. Die Angaben sind ein Mock-Produktentwurf und müssen vor Nutzung manuell mit Produktunterlagen und Plattformregeln abgeglichen werden.`,
      keywords,
      sellingPoints: points,
      riskNotes: [
        "Produktdaten, Lieferantendokumente, Schutzrechte und lokale Anforderungen vor Veröffentlichung prüfen.",
        `Aktuelles Risikosignal: ${riskLevel}.`,
        pendingFactNote,
        prohibitedNote,
        competitorNote,
      ],
      complianceWarnings: [],
      blockedClaims: [],
      reviewChecklist: [
        "Manuelle Prüfung vor Veröffentlichung erforderlich.",
        "Material, Maße, Lieferumfang und Kompatibilität mit den Lieferantendokumenten abgleichen.",
        competitorNote,
      ],
    };
  }

  const toneLead = {
    professional: "Professional factual draft",
    conversion: "Benefit-led draft",
    concise: "Concise product draft",
    brand: "Brand-led product draft",
  }[preferences.tone];
  const objectiveLead = {
    balanced: "Balanced factual structure",
    seo: "Search-focused structure without ranking promises",
    conversion: "Benefit-focused structure without conversion promises",
    brand: "Brand-consistent factual structure",
  }[listingObjective];
  const audience = preferences.targetAudience || "the intended customer";
  const problem = preferences.problemSolved || "the stated use need";
  const functionText = preferences.coreFunction || points[0];
  const differences = preferences.differentiators.length
    ? preferences.differentiators.join("; ")
    : points.join("; ");

  return {
    source: "mock_ai_draft",
    version: 1,
    generatedAt: new Date().toISOString(),
    model: "mock",
    humanReviewRequired: true,
    titles: [
      `${primaryKeyword} | ${productName} for ${preferences.targetMarket}`,
      `${productName} for ${audience}`,
    ],
    bullets: [
      `Core function: ${functionText}. Confirmed facts: ${confirmedFactText || "none supplied"}. Verify this statement against the product sample before publishing.`,
      `Designed for ${audience} and the stated need: ${problem}.`,
      `Differentiators for review: ${differences}. Keep only product facts that can be supported.`,
      `SEO context for ${preferences.targetMarket}: ${preferences.secondaryKeywords.join(", ") || "no secondary keywords supplied"}. Use terms naturally and accurately.`,
      `Risk level is ${riskLevel}. Review supplier documents, IP exposure, local requirements and platform rules.`,
    ],
    description: `${toneLead}. ${objectiveLead} for ${productName} in the ${preferences.targetMarket} market. ${decisionSummary} Confirmed facts: ${confirmedFactText || "none supplied"}. Core function: ${functionText}. Intended audience: ${audience}. Use need: ${problem}. This Mock listing draft must be checked manually against product documents and platform rules before use.`,
    keywords,
    sellingPoints: points,
    riskNotes: [
      "Verify product facts, supplier documents, IP exposure and local requirements before publishing.",
      `Current risk signal: ${riskLevel}.`,
      pendingFactNote,
      prohibitedNote,
      competitorNote,
    ],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: [
      "Human review required before publishing.",
      "Confirm material, dimensions, package contents and compatibility with supplier documents.",
      competitorNote,
    ],
  };
}

export function buildMockAiListingDraft(input: MockDraftInput): AiListingPackDraft {
  if (input.studioPreferences) {
    const competitorFiltered = filterListingClaims(
      buildStudioMockDraft(input, input.studioPreferences),
      {
        prohibitedClaims: input.studioPreferences.competitorKeywords,
        customClaimLabel: "Competitor research term",
      },
    ).cleaned;
    return filterListingClaims(competitorFiltered, {
      prohibitedClaims: input.studioPreferences.prohibitedClaims,
    }).cleaned;
  }

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
