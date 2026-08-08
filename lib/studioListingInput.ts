export const STUDIO_TARGET_MARKETS = ["US", "UK", "DE", "CA"] as const;
export const STUDIO_OUTPUT_LANGUAGES = ["en", "de"] as const;
export const STUDIO_LISTING_TONES = ["professional", "conversion", "concise", "brand"] as const;
export const STUDIO_LISTING_OBJECTIVES = ["balanced", "seo", "conversion", "brand"] as const;

export type StudioTargetMarket = (typeof STUDIO_TARGET_MARKETS)[number];
export type StudioOutputLanguage = (typeof STUDIO_OUTPUT_LANGUAGES)[number];
export type StudioListingTone = (typeof STUDIO_LISTING_TONES)[number];
export type StudioListingObjective = (typeof STUDIO_LISTING_OBJECTIVES)[number];

export type StudioListingPreferences = {
  targetMarket: StudioTargetMarket;
  outputLanguage: StudioOutputLanguage;
  tone: StudioListingTone;
  listingObjective: StudioListingObjective;
  coreFunction: string;
  targetAudience: string;
  problemSolved: string;
  differentiators: string[];
  primaryKeywords: string[];
  secondaryKeywords: string[];
  competitorKeywords: string[];
  confirmedFacts: string[];
  unverifiedFacts: string[];
  prohibitedClaims: string[];
  additionalRequirements?: string;
};

export type StudioListingInput = {
  briefVersion: "studio-creative-brief.v1";
  factsConfirmed: true;
  humanReviewRequired: true;
  additionalRequirements: string;
  productName: string;
  description: string;
  category: string;
  sellingPoints: string[];
  riskLevel: string;
  mode: "mock" | "real";
  confirmRealAi: boolean;
  idempotencyKey: string;
  preferences: StudioListingPreferences;
};

type StudioListingInputErrorCode =
  | "invalid_studio_input"
  | "invalid_mode"
  | "missing_product_name"
  | "unsupported_request_field"
  | "invalid_studio_brief"
  | "studio_brief_confirmation_required";

export type StudioListingInputResult =
  | { ok: true; data: StudioListingInput }
  | { ok: false; error: { code: StudioListingInputErrorCode; message: string } };

export const STUDIO_LISTING_ALLOWED_FIELDS = new Set([
  "briefVersion",
  "factsConfirmed",
  "humanReviewRequired",
  "additionalRequirements",
  "productName",
  "description",
  "category",
  "sellingPoints",
  "riskLevel",
  "mode",
  "confirmRealAi",
  "idempotencyKey",
  "accessToken",
  "accessPassword",
  "targetMarket",
  "outputLanguage",
  "tone",
  "coreFunction",
  "listingObjective",
  "targetAudience",
  "problemSolved",
  "differentiators",
  "primaryKeywords",
  "secondaryKeywords",
  "competitorKeywords",
  "confirmedFacts",
  "unverifiedFacts",
  "prohibitedClaims",
]);

function fail(code: StudioListingInputErrorCode, message: string): StudioListingInputResult {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
  fallback = "",
): { ok: true; value: string } | { ok: false; message: string } {
  const value = input[key];
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "string") return { ok: false, message: `${key} must be a string.` };
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    return { ok: false, message: `${key} must not exceed ${maxLength} characters.` };
  }
  return { ok: true, value: normalized };
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readStringList(
  input: Record<string, unknown>,
  key: string,
  options: { maxItems: number; maxItemLength: number; allowDelimitedString?: boolean },
): { ok: true; value: string[] } | { ok: false; message: string } {
  const value = input[key];
  if (value === undefined) return { ok: true, value: [] };

  let values: unknown[];
  if (options.allowDelimitedString && typeof value === "string") {
    values = value.split(/\r?\n|[,;，；]/);
  } else if (Array.isArray(value)) {
    values = value;
  } else {
    return { ok: false, message: `${key} must be an array of strings.` };
  }

  if (values.length > options.maxItems) {
    return { ok: false, message: `${key} must not contain more than ${options.maxItems} items.` };
  }

  const normalized: string[] = [];
  for (const item of values) {
    if (typeof item !== "string") return { ok: false, message: `${key} must contain only strings.` };
    const text = item.trim();
    if (!text) continue;
    if (text.length > options.maxItemLength) {
      return { ok: false, message: `${key} items must not exceed ${options.maxItemLength} characters.` };
    }
    normalized.push(text);
  }
  return { ok: true, value: unique(normalized) };
}

function readEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): { ok: true; value: T } | { ok: false; message: string } {
  const value = input[key];
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return { ok: false, message: `${key} contains an unsupported value.` };
  }
  return { ok: true, value: value as T };
}

export function parseStudioListingInput(value: unknown): StudioListingInputResult {
  if (!isRecord(value)) return fail("invalid_studio_input", "Request body must be a JSON object.");

  if (Object.keys(value).some((key) => !STUDIO_LISTING_ALLOWED_FIELDS.has(key))) {
    return fail("unsupported_request_field", "Request contains an unsupported field.");
  }

  if (value.briefVersion !== "studio-creative-brief.v1" || value.humanReviewRequired !== true) {
    return fail("invalid_studio_brief", "创作资料合同无效，请刷新页面后重新确认。");
  }
  if (value.factsConfirmed !== true) {
    return fail(
      "studio_brief_confirmation_required",
      "请确认商品事实由你提供或确认，生成结果仅作为待人工复核的草稿。",
    );
  }

  if (value.mode !== undefined && value.mode !== "mock" && value.mode !== "real") {
    return fail("invalid_mode", "Generation mode is invalid.");
  }
  if (value.confirmRealAi !== undefined && typeof value.confirmRealAi !== "boolean") {
    return fail("invalid_studio_input", "confirmRealAi must be a boolean.");
  }

  const productName = readText(value, "productName", 200);
  const description = readText(value, "description", 1_000);
  const category = readText(value, "category", 200);
  const riskLevel = readText(value, "riskLevel", 80, "medium");
  const idempotencyKey = readText(value, "idempotencyKey", 100);
  const coreFunction = readText(value, "coreFunction", 600);
  const targetAudience = readText(value, "targetAudience", 400);
  const problemSolved = readText(value, "problemSolved", 600);
  const additionalRequirements = readText(value, "additionalRequirements", 1_000);
  const targetMarket = readEnum(value, "targetMarket", STUDIO_TARGET_MARKETS, "US");
  const outputLanguage = readEnum(value, "outputLanguage", STUDIO_OUTPUT_LANGUAGES, "en");
  const tone = readEnum(value, "tone", STUDIO_LISTING_TONES, "professional");
  const listingObjective = readEnum(value, "listingObjective", STUDIO_LISTING_OBJECTIVES, "balanced");
  const sellingPoints = readStringList(value, "sellingPoints", {
    maxItems: 5,
    maxItemLength: 200,
    allowDelimitedString: true,
  });
  const differentiators = readStringList(value, "differentiators", {
    maxItems: 6,
    maxItemLength: 200,
  });
  const primaryKeywords = readStringList(value, "primaryKeywords", {
    maxItems: 3,
    maxItemLength: 80,
  });
  const secondaryKeywords = readStringList(value, "secondaryKeywords", {
    maxItems: 12,
    maxItemLength: 80,
  });
  const competitorKeywords = readStringList(value, "competitorKeywords", {
    maxItems: 12,
    maxItemLength: 80,
  });
  const confirmedFacts = readStringList(value, "confirmedFacts", {
    maxItems: 12,
    maxItemLength: 300,
  });
  const unverifiedFacts = readStringList(value, "unverifiedFacts", {
    maxItems: 12,
    maxItemLength: 300,
  });
  const prohibitedClaims = readStringList(value, "prohibitedClaims", {
    maxItems: 12,
    maxItemLength: 200,
  });

  const fields = [
    productName,
    description,
    category,
    riskLevel,
    idempotencyKey,
    coreFunction,
    targetAudience,
    problemSolved,
    targetMarket,
    outputLanguage,
    tone,
    sellingPoints,
    differentiators,
    primaryKeywords,
    listingObjective,
    secondaryKeywords,
    competitorKeywords,
    confirmedFacts,
    unverifiedFacts,
    prohibitedClaims,
    additionalRequirements,
  ];
  const invalid = fields.find((field) => !field.ok);
  if (invalid && !invalid.ok) return fail("invalid_studio_input", invalid.message);
  if (!productName.ok || !productName.value) return fail("missing_product_name", "Please enter a product name.");
  if (
    !description.ok
    || !category.ok
    || !riskLevel.ok
    || !idempotencyKey.ok
    || !coreFunction.ok
    || !targetAudience.ok
    || !problemSolved.ok
    || !targetMarket.ok
    || !outputLanguage.ok
    || !tone.ok
    || !sellingPoints.ok
    || !differentiators.ok
    || !primaryKeywords.ok
    || !secondaryKeywords.ok
    || !listingObjective.ok
    || !competitorKeywords.ok
    || !confirmedFacts.ok
    || !unverifiedFacts.ok
    || !prohibitedClaims.ok
    || !additionalRequirements.ok
  ) {
    return fail("invalid_studio_input", "Request body contains invalid Studio input.");
  }

  return {
    ok: true,
    data: {
      briefVersion: "studio-creative-brief.v1",
      factsConfirmed: true,
      humanReviewRequired: true,
      additionalRequirements: additionalRequirements.value,
      productName: productName.value,
      description: description.value,
      category: category.value,
      sellingPoints: sellingPoints.value,
      riskLevel: riskLevel.value,
      mode: value.mode === "real" ? "real" : "mock",
      confirmRealAi: value.confirmRealAi === true,
      idempotencyKey: idempotencyKey.value,
      preferences: {
        targetMarket: targetMarket.value,
        outputLanguage: outputLanguage.value,
        tone: tone.value,
        coreFunction: coreFunction.value,
        targetAudience: targetAudience.value,
        problemSolved: problemSolved.value,
        differentiators: differentiators.value,
        primaryKeywords: primaryKeywords.value,
        listingObjective: listingObjective.value,
        secondaryKeywords: secondaryKeywords.value,
        competitorKeywords: competitorKeywords.value,
        confirmedFacts: confirmedFacts.value,
        unverifiedFacts: unverifiedFacts.value,
        prohibitedClaims: prohibitedClaims.value,
        additionalRequirements: additionalRequirements.value,
      },
    },
  };
}
