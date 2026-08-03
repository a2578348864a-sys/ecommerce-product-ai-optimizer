import { createHash } from "node:crypto";

export const PRODUCT_CREATIVE_HANDOFF_SCHEMA = "product-creative-handoff.v1" as const;
export const PRODUCT_CREATIVE_HANDOFF_NAMESPACE = "creativeHandoff" as const;
export const PRODUCT_CREATIVE_HANDOFF_MAX_VERSIONS = 10;
export const PRODUCT_CREATIVE_HANDOFF_MAX_UTF8_BYTES = 96 * 1024;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT_FINGERPRINT_PATTERN = /^[a-f0-9]{16}$/;
const MAX_IDENTITY_LENGTH = 120;

export type ProductCreativeHandoffUsageScope = "listing" | "image" | "internal";

export type ProductCreativeHandoffInternalActor = {
  mode: "owner" | "visitor";
  subjectFingerprint: string;
};

export type ProductCreativeHandoffSnapshotSourceReference = {
  sourceKind: "candidate_snapshot" | "seller_sprite_snapshot" | "research_result";
  sourceField: string;
  sourceSnapshotFingerprint: string;
  capturedAt?: string;
};

export type ProductCreativeHandoffUserConfirmationReference = {
  sourceKind: "user_confirmation";
  sourceField: string;
  confirmedBy: ProductCreativeHandoffInternalActor;
  confirmedAt: string;
  confirmationReference: string;
};

export type ProductCreativeHandoffSourceReference =
  | ProductCreativeHandoffSnapshotSourceReference
  | ProductCreativeHandoffUserConfirmationReference;

export type ProductCreativeHandoffFactValue = string | number | boolean | string[];

export type ProductCreativeHandoffConfirmedFact = {
  factId: string;
  field: string;
  label: string;
  value: ProductCreativeHandoffFactValue;
  evidenceTier: "human_confirmed";
  usageScopes: ProductCreativeHandoffUsageScope[];
  sourceRef: ProductCreativeHandoffUserConfirmationReference;
  confirmedAt: string;
  confirmedBy: ProductCreativeHandoffInternalActor;
};

export type ProductCreativeHandoffStableSourceFact = {
  factId: string;
  field: string;
  label: string;
  value: ProductCreativeHandoffFactValue;
  evidenceTier: "source_snapshot";
  usageScopes: ["internal"];
  sourceRef: ProductCreativeHandoffSnapshotSourceReference;
  stabilityRule: "identity_only" | "routing_only" | "human_confirmation_required_for_claim";
};

export type ProductCreativeHandoffAiReference = {
  referenceId: string;
  field: string;
  summary: string;
  evidenceTier: "ai_hypothesis";
  allowedUse: "tone" | "layout" | "composition" | "non_factual_angle";
  prohibitedUses: Array<
    | "title_fact"
    | "bullet_fact"
    | "parameter"
    | "certification"
    | "performance_claim"
    | "image_text"
    | "packaging"
    | "logo"
  >;
};

export type ProductCreativeHandoffIssue = {
  issueId: string;
  field: string;
  kind: "missing" | "conflict";
  summary: string;
  sourceSummaries?: string[];
  risk: "low" | "medium" | "high" | "blocking";
  blocks: Array<
    | "listing_title"
    | "listing_bullets"
    | "listing_description"
    | "search_terms"
    | "image_product_depiction"
    | "image_text"
    | "packaging"
    | "logo"
    | "certification"
    | "performance_claim"
  >;
  recommendedAction: string;
};

export type ProductCreativeHandoffProhibitedClaim = {
  claimId: string;
  category:
    | "unconfirmed_material"
    | "unconfirmed_dimension"
    | "unconfirmed_performance"
    | "unconfirmed_certification"
    | "brand_authorization"
    | "health_safety_environment"
    | "competitor_trademark"
    | "absolute_claim"
    | "invented_accessory"
    | "invented_packaging"
    | "other";
  summary: string;
  appliesTo: Array<"listing" | "image" | "both">;
  source: "system_rule" | "research_issue" | "user_restriction";
};

export type ProductCreativeHandoffCreativePreferences = {
  evidenceTier: "creative_preference";
  targetMarket?: string;
  language?: string;
  tone?: string;
  targetAudiencePreference?: string;
  imageStyle?: string;
  backgroundPreference?: string;
  compositionPreference?: string;
};

export type ProductCreativeHandoffVisualReference = {
  assetFingerprint: string;
  sourceTier: "source_snapshot" | "human_confirmed";
  identityBound: true;
  humanApprovedForReference: true;
  approvedAt: string;
};

export type ProductCreativeHandoffSourceResearch = {
  recordSchema: "product-research-record.v1";
  candidateId: string;
  researchRevision: number;
  researchHash: string;
  workflowStatus: "completed";
  decisionStatus: "creative_ready";
  candidateSourceFingerprint: string;
};

export type ProductCreativeHandoffProductIdentity = {
  displayName: string;
  marketplace?: string;
  identityConfirmedAt: string;
};

export type ProductCreativeHandoffCandidate = {
  sourceResearch: ProductCreativeHandoffSourceResearch;
  productIdentity: ProductCreativeHandoffProductIdentity;
  confirmedFacts: ProductCreativeHandoffConfirmedFact[];
  stableSourceFacts: ProductCreativeHandoffStableSourceFact[];
  aiCreativeReferences: ProductCreativeHandoffAiReference[];
  issues: ProductCreativeHandoffIssue[];
  prohibitedClaims: ProductCreativeHandoffProhibitedClaim[];
  creativePreferences: ProductCreativeHandoffCreativePreferences;
  visualReferences: ProductCreativeHandoffVisualReference[];
  humanReviewRequired: true;
};

export type ProductCreativeHandoffVersion = ProductCreativeHandoffCandidate & {
  revision: number;
  createdAt: string;
  createdBy: ProductCreativeHandoffInternalActor;
  confirmation: {
    confirmed: true;
    confirmedAt: string;
    confirmedBy: ProductCreativeHandoffInternalActor;
  };
  handoffFingerprint: string;
};

export type ProductCreativeHandoffV1 = {
  schema: typeof PRODUCT_CREATIVE_HANDOFF_SCHEMA;
  handoffId: string;
  taskId: string;
  candidateId: string;
  currentRevision: number;
  controlState: "active" | "revoked";
  revokedAt?: string;
  revokeReasonCode?: "explicit_user_revoke" | "decision_changed" | "identity_invalid" | "verification_invalid";
  createdAt: string;
  createdBy: ProductCreativeHandoffInternalActor;
  researchMode: "market_research_only";
  promotionEligible: false;
  versions: ProductCreativeHandoffVersion[];
};

export class ProductCreativeHandoffError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProductCreativeHandoffError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function isNfcTrimmedText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === "string"
    && value === value.normalize("NFC")
    && value === value.trim()
    && (allowEmpty || value.length > 0)
    && value.length <= maxLength;
}

function isBoundedIdentity(value: unknown): value is string {
  return isNfcTrimmedText(value, MAX_IDENTITY_LENGTH);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isSafeIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function parseActor(value: unknown): ProductCreativeHandoffInternalActor | null {
  if (!isRecord(value) || !hasExactKeys(value, ["mode", "subjectFingerprint"])) return null;
  if ((value.mode !== "owner" && value.mode !== "visitor")
    || typeof value.subjectFingerprint !== "string"
    || !SUBJECT_FINGERPRINT_PATTERN.test(value.subjectFingerprint)) return null;
  return { mode: value.mode, subjectFingerprint: value.subjectFingerprint };
}

function parseUniqueEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  minimum: number,
  maximum: number,
): T[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return null;
  if (!value.every((item): item is T => typeof item === "string" && allowed.includes(item as T))) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value];
}

function parseStringArray(value: unknown, maximumItems: number, maximumLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  if (!value.every((item) => isNfcTrimmedText(item, maximumLength))) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value] as string[];
}

function parseFactValue(value: unknown): ProductCreativeHandoffFactValue | null {
  if (typeof value === "string") return isNfcTrimmedText(value, 1_000) ? value : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return parseStringArray(value, 20, 300);
}

function parseSnapshotSourceReference(value: unknown): ProductCreativeHandoffSnapshotSourceReference | null {
  if (!isRecord(value) || !hasExactKeys(
    value,
    ["sourceKind", "sourceField", "sourceSnapshotFingerprint"],
    ["capturedAt"],
  )) return null;
  if (value.sourceKind !== "candidate_snapshot"
    && value.sourceKind !== "seller_sprite_snapshot"
    && value.sourceKind !== "research_result") return null;
  if (!isNfcTrimmedText(value.sourceField, 160) || !isHash(value.sourceSnapshotFingerprint)) return null;
  if (value.capturedAt !== undefined && !isIsoDate(value.capturedAt)) return null;
  return {
    sourceKind: value.sourceKind,
    sourceField: value.sourceField,
    sourceSnapshotFingerprint: value.sourceSnapshotFingerprint,
    ...(value.capturedAt ? { capturedAt: value.capturedAt } : {}),
  };
}

function parseUserConfirmationReference(value: unknown): ProductCreativeHandoffUserConfirmationReference | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "sourceKind",
    "sourceField",
    "confirmedBy",
    "confirmedAt",
    "confirmationReference",
  ])) return null;
  if (value.sourceKind !== "user_confirmation"
    || !isNfcTrimmedText(value.sourceField, 160)
    || !isIsoDate(value.confirmedAt)
    || !isNfcTrimmedText(value.confirmationReference, 240)) return null;
  const confirmedBy = parseActor(value.confirmedBy);
  if (!confirmedBy) return null;
  return {
    sourceKind: "user_confirmation",
    sourceField: value.sourceField,
    confirmedBy,
    confirmedAt: value.confirmedAt,
    confirmationReference: value.confirmationReference,
  };
}

function parseConfirmedFact(value: unknown): ProductCreativeHandoffConfirmedFact | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "factId", "field", "label", "value", "evidenceTier", "usageScopes", "sourceRef", "confirmedAt", "confirmedBy",
  ])) return null;
  if (!isUuid(value.factId)
    || !isNfcTrimmedText(value.field, 120)
    || !isNfcTrimmedText(value.label, 120)
    || value.evidenceTier !== "human_confirmed"
    || !isIsoDate(value.confirmedAt)) return null;
  const factValue = parseFactValue(value.value);
  const usageScopes = parseUniqueEnumArray(value.usageScopes, ["listing", "image", "internal"] as const, 1, 3);
  const sourceRef = parseUserConfirmationReference(value.sourceRef);
  const confirmedBy = parseActor(value.confirmedBy);
  if (factValue === null || !usageScopes || !sourceRef || !confirmedBy) return null;
  if (sourceRef.confirmedAt !== value.confirmedAt || canonicalJson(sourceRef.confirmedBy) !== canonicalJson(confirmedBy)) return null;
  return {
    factId: value.factId.toLowerCase(),
    field: value.field,
    label: value.label,
    value: factValue,
    evidenceTier: "human_confirmed",
    usageScopes,
    sourceRef,
    confirmedAt: value.confirmedAt,
    confirmedBy,
  };
}

function parseStableSourceFact(value: unknown): ProductCreativeHandoffStableSourceFact | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "factId", "field", "label", "value", "evidenceTier", "usageScopes", "sourceRef", "stabilityRule",
  ])) return null;
  if (!isUuid(value.factId)
    || !isNfcTrimmedText(value.field, 120)
    || !isNfcTrimmedText(value.label, 120)
    || value.evidenceTier !== "source_snapshot"
    || (value.stabilityRule !== "identity_only"
      && value.stabilityRule !== "routing_only"
      && value.stabilityRule !== "human_confirmation_required_for_claim")) return null;
  const factValue = parseFactValue(value.value);
  const scopes = parseUniqueEnumArray(value.usageScopes, ["internal"] as const, 1, 1);
  const sourceRef = parseSnapshotSourceReference(value.sourceRef);
  if (factValue === null || !scopes || !sourceRef) return null;
  return {
    factId: value.factId.toLowerCase(),
    field: value.field,
    label: value.label,
    value: factValue,
    evidenceTier: "source_snapshot",
    usageScopes: ["internal"],
    sourceRef,
    stabilityRule: value.stabilityRule,
  };
}

const REQUIRED_AI_PROHIBITED_USES = [
  "title_fact",
  "bullet_fact",
  "parameter",
  "certification",
  "performance_claim",
  "image_text",
] as const;

function parseAiReference(value: unknown): ProductCreativeHandoffAiReference | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "referenceId", "field", "summary", "evidenceTier", "allowedUse", "prohibitedUses",
  ])) return null;
  if (!isUuid(value.referenceId)
    || !isNfcTrimmedText(value.field, 120)
    || !isNfcTrimmedText(value.summary, 500)
    || value.evidenceTier !== "ai_hypothesis"
    || (value.allowedUse !== "tone"
      && value.allowedUse !== "layout"
      && value.allowedUse !== "composition"
      && value.allowedUse !== "non_factual_angle")) return null;
  const prohibitedUses = parseUniqueEnumArray(value.prohibitedUses, [
    ...REQUIRED_AI_PROHIBITED_USES,
    "packaging",
    "logo",
  ] as const, REQUIRED_AI_PROHIBITED_USES.length, 8);
  if (!prohibitedUses || !REQUIRED_AI_PROHIBITED_USES.every((item) => prohibitedUses.includes(item))) return null;
  return {
    referenceId: value.referenceId.toLowerCase(),
    field: value.field,
    summary: value.summary,
    evidenceTier: "ai_hypothesis",
    allowedUse: value.allowedUse,
    prohibitedUses,
  };
}

function parseIssue(value: unknown): ProductCreativeHandoffIssue | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "issueId", "field", "kind", "summary", "risk", "blocks", "recommendedAction",
  ], ["sourceSummaries"])) return null;
  if (!isUuid(value.issueId)
    || !isNfcTrimmedText(value.field, 120)
    || (value.kind !== "missing" && value.kind !== "conflict")
    || !isNfcTrimmedText(value.summary, 500)
    || (value.risk !== "low" && value.risk !== "medium" && value.risk !== "high" && value.risk !== "blocking")
    || !isNfcTrimmedText(value.recommendedAction, 500)) return null;
  const blocks = parseUniqueEnumArray(value.blocks, [
    "listing_title", "listing_bullets", "listing_description", "search_terms", "image_product_depiction",
    "image_text", "packaging", "logo", "certification", "performance_claim",
  ] as const, 1, 10);
  const sourceSummaries = value.sourceSummaries === undefined ? undefined : parseStringArray(value.sourceSummaries, 5, 240);
  if (!blocks || sourceSummaries === null) return null;
  return {
    issueId: value.issueId.toLowerCase(),
    field: value.field,
    kind: value.kind,
    summary: value.summary,
    ...(sourceSummaries ? { sourceSummaries } : {}),
    risk: value.risk,
    blocks,
    recommendedAction: value.recommendedAction,
  };
}

function parseProhibitedClaim(value: unknown): ProductCreativeHandoffProhibitedClaim | null {
  if (!isRecord(value) || !hasExactKeys(value, ["claimId", "category", "summary", "appliesTo", "source"])) return null;
  const categories = [
    "unconfirmed_material", "unconfirmed_dimension", "unconfirmed_performance", "unconfirmed_certification",
    "brand_authorization", "health_safety_environment", "competitor_trademark", "absolute_claim",
    "invented_accessory", "invented_packaging", "other",
  ] as const;
  if (!isUuid(value.claimId)
    || !categories.includes(value.category as typeof categories[number])
    || !isNfcTrimmedText(value.summary, 500)
    || (value.source !== "system_rule" && value.source !== "research_issue" && value.source !== "user_restriction")) return null;
  const appliesTo = parseUniqueEnumArray(value.appliesTo, ["listing", "image", "both"] as const, 1, 3);
  if (!appliesTo) return null;
  return {
    claimId: value.claimId.toLowerCase(),
    category: value.category as ProductCreativeHandoffProhibitedClaim["category"],
    summary: value.summary,
    appliesTo,
    source: value.source,
  };
}

function parseCreativePreferences(value: unknown): ProductCreativeHandoffCreativePreferences | null {
  if (!isRecord(value) || !hasExactKeys(value, ["evidenceTier"], [
    "targetMarket", "language", "tone", "targetAudiencePreference", "imageStyle", "backgroundPreference", "compositionPreference",
  ])) return null;
  if (value.evidenceTier !== "creative_preference") return null;
  const limits: Record<string, number> = {
    targetMarket: 32,
    language: 32,
    tone: 80,
    targetAudiencePreference: 300,
    imageStyle: 120,
    backgroundPreference: 300,
    compositionPreference: 300,
  };
  for (const [key, limit] of Object.entries(limits)) {
    if (value[key] !== undefined && !isNfcTrimmedText(value[key], limit)) return null;
  }
  return { ...(value as ProductCreativeHandoffCreativePreferences) };
}

function parseVisualReference(value: unknown): ProductCreativeHandoffVisualReference | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "assetFingerprint", "sourceTier", "identityBound", "humanApprovedForReference", "approvedAt",
  ])) return null;
  if (!isHash(value.assetFingerprint)
    || (value.sourceTier !== "source_snapshot" && value.sourceTier !== "human_confirmed")
    || value.identityBound !== true
    || value.humanApprovedForReference !== true
    || !isIsoDate(value.approvedAt)) return null;
  return {
    assetFingerprint: value.assetFingerprint,
    sourceTier: value.sourceTier,
    identityBound: true,
    humanApprovedForReference: true,
    approvedAt: value.approvedAt,
  };
}

function parseSourceResearch(value: unknown): ProductCreativeHandoffSourceResearch | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "recordSchema", "candidateId", "researchRevision", "researchHash", "workflowStatus", "decisionStatus", "candidateSourceFingerprint",
  ])) return null;
  if (value.recordSchema !== "product-research-record.v1"
    || !isBoundedIdentity(value.candidateId)
    || !isSafeIntegerBetween(value.researchRevision, 1, 1_000_000)
    || !isHash(value.researchHash)
    || value.workflowStatus !== "completed"
    || value.decisionStatus !== "creative_ready"
    || !isHash(value.candidateSourceFingerprint)) return null;
  return {
    recordSchema: "product-research-record.v1",
    candidateId: value.candidateId,
    researchRevision: value.researchRevision,
    researchHash: value.researchHash,
    workflowStatus: "completed",
    decisionStatus: "creative_ready",
    candidateSourceFingerprint: value.candidateSourceFingerprint,
  };
}

function parseProductIdentity(value: unknown): ProductCreativeHandoffProductIdentity | null {
  if (!isRecord(value) || !hasExactKeys(value, ["displayName", "identityConfirmedAt"], ["marketplace"])) return null;
  if (!isNfcTrimmedText(value.displayName, 200)
    || !isIsoDate(value.identityConfirmedAt)
    || (value.marketplace !== undefined && !isNfcTrimmedText(value.marketplace, 32))) return null;
  return {
    displayName: value.displayName,
    ...(value.marketplace ? { marketplace: value.marketplace } : {}),
    identityConfirmedAt: value.identityConfirmedAt,
  };
}

function parseCandidate(value: unknown): ProductCreativeHandoffCandidate | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "sourceResearch", "productIdentity", "confirmedFacts", "stableSourceFacts", "aiCreativeReferences",
    "issues", "prohibitedClaims", "creativePreferences", "visualReferences", "humanReviewRequired",
  ])) return null;
  if (value.humanReviewRequired !== true
    || !Array.isArray(value.confirmedFacts) || value.confirmedFacts.length < 1 || value.confirmedFacts.length > 50
    || !Array.isArray(value.stableSourceFacts) || value.stableSourceFacts.length > 20
    || !Array.isArray(value.aiCreativeReferences) || value.aiCreativeReferences.length > 20
    || !Array.isArray(value.issues) || value.issues.length > 30
    || !Array.isArray(value.prohibitedClaims) || value.prohibitedClaims.length < 1 || value.prohibitedClaims.length > 50
    || !Array.isArray(value.visualReferences) || value.visualReferences.length > 5) return null;
  const sourceResearch = parseSourceResearch(value.sourceResearch);
  const productIdentity = parseProductIdentity(value.productIdentity);
  const confirmedFacts = value.confirmedFacts.map(parseConfirmedFact);
  const stableSourceFacts = value.stableSourceFacts.map(parseStableSourceFact);
  const aiCreativeReferences = value.aiCreativeReferences.map(parseAiReference);
  const issues = value.issues.map(parseIssue);
  const prohibitedClaims = value.prohibitedClaims.map(parseProhibitedClaim);
  const creativePreferences = parseCreativePreferences(value.creativePreferences);
  const visualReferences = value.visualReferences.map(parseVisualReference);
  if (!sourceResearch || !productIdentity || !creativePreferences
    || confirmedFacts.some((item) => !item)
    || stableSourceFacts.some((item) => !item)
    || aiCreativeReferences.some((item) => !item)
    || issues.some((item) => !item)
    || prohibitedClaims.some((item) => !item)
    || visualReferences.some((item) => !item)) return null;
  const parsedConfirmed = confirmedFacts as ProductCreativeHandoffConfirmedFact[];
  const parsedStable = stableSourceFacts as ProductCreativeHandoffStableSourceFact[];
  const parsedAiReferences = aiCreativeReferences as ProductCreativeHandoffAiReference[];
  const parsedIssues = issues as ProductCreativeHandoffIssue[];
  const parsedClaims = prohibitedClaims as ProductCreativeHandoffProhibitedClaim[];
  const parsedVisualReferences = visualReferences as ProductCreativeHandoffVisualReference[];
  if (new Set(parsedConfirmed.map((item) => item.factId)).size !== parsedConfirmed.length) return null;
  if (new Set(parsedConfirmed.map((item) => item.field)).size !== parsedConfirmed.length) return null;
  if (new Set(parsedStable.map((item) => item.factId)).size !== parsedStable.length) return null;
  if (new Set(parsedAiReferences.map((item) => item.referenceId)).size !== parsedAiReferences.length) return null;
  if (new Set(parsedIssues.map((item) => item.issueId)).size !== parsedIssues.length) return null;
  if (new Set(parsedClaims.map((item) => item.claimId)).size !== parsedClaims.length) return null;
  if (new Set(parsedVisualReferences.map((item) => item.assetFingerprint)).size !== parsedVisualReferences.length) return null;
  return {
    sourceResearch,
    productIdentity,
    confirmedFacts: parsedConfirmed,
    stableSourceFacts: parsedStable,
    aiCreativeReferences: parsedAiReferences,
    issues: parsedIssues,
    prohibitedClaims: parsedClaims,
    creativePreferences,
    visualReferences: parsedVisualReferences,
    humanReviewRequired: true,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(typeof value === "string" ? value.normalize("NFC") : value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ProductCreativeHandoffError("non_finite_canonical_value", "canonical input contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new ProductCreativeHandoffError("unsupported_canonical_value", "canonical input contains an unsupported value");
}

function sortCanonical<T>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const leftJson = canonicalJson(left);
    const rightJson = canonicalJson(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
}

function sortByKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    const leftJson = canonicalJson(left);
    const rightJson = canonicalJson(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
}

function fingerprintContent(candidate: ProductCreativeHandoffCandidate): unknown {
  return {
    sourceResearch: candidate.sourceResearch,
    productIdentity: candidate.productIdentity,
    confirmedFacts: sortByKey(candidate.confirmedFacts.map((fact) => ({
      ...fact,
      value: Array.isArray(fact.value) ? sortCanonical(fact.value) : fact.value,
      usageScopes: sortCanonical(fact.usageScopes),
    })), (fact) => fact.factId),
    stableSourceFacts: sortByKey(candidate.stableSourceFacts.map((fact) => ({
      ...fact,
      value: Array.isArray(fact.value) ? sortCanonical(fact.value) : fact.value,
      usageScopes: sortCanonical(fact.usageScopes),
    })), (fact) => fact.factId),
    aiCreativeReferences: sortByKey(candidate.aiCreativeReferences.map((reference) => ({
      ...reference,
      prohibitedUses: sortCanonical(reference.prohibitedUses),
    })), (reference) => reference.referenceId),
    issues: sortByKey(candidate.issues.map((issue) => ({
      ...issue,
      blocks: sortCanonical(issue.blocks),
      ...(issue.sourceSummaries ? { sourceSummaries: sortCanonical(issue.sourceSummaries) } : {}),
    })), (issue) => issue.issueId),
    prohibitedClaims: sortByKey(candidate.prohibitedClaims.map((claim) => ({
      ...claim,
      appliesTo: sortCanonical(claim.appliesTo),
    })), (claim) => claim.claimId),
    creativePreferences: candidate.creativePreferences,
    visualReferences: sortByKey(candidate.visualReferences, (reference) => reference.assetFingerprint),
    humanReviewRequired: candidate.humanReviewRequired,
  };
}

function normalizeNfcDeep(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(normalizeNfcDeep);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeNfcDeep(item)]));
  }
  return value;
}

export function calculateHandoffFingerprint(candidate: ProductCreativeHandoffCandidate): string {
  const parsed = parseCandidate(normalizeNfcDeep(candidate));
  if (!parsed) throw new ProductCreativeHandoffError("invalid_handoff_candidate", "handoff candidate is invalid");
  return createHash("sha256").update(canonicalJson(fingerprintContent(parsed)), "utf8").digest("hex");
}

function parseVersion(value: unknown): ProductCreativeHandoffVersion | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "revision", "createdAt", "createdBy", "sourceResearch", "productIdentity", "confirmedFacts", "stableSourceFacts",
    "aiCreativeReferences", "issues", "prohibitedClaims", "creativePreferences", "visualReferences", "confirmation",
    "humanReviewRequired", "handoffFingerprint",
  ])) return null;
  if (!isSafeIntegerBetween(value.revision, 1, PRODUCT_CREATIVE_HANDOFF_MAX_VERSIONS)
    || !isIsoDate(value.createdAt)
    || !isHash(value.handoffFingerprint)) return null;
  const createdBy = parseActor(value.createdBy);
  const candidate = parseCandidate({
    sourceResearch: value.sourceResearch,
    productIdentity: value.productIdentity,
    confirmedFacts: value.confirmedFacts,
    stableSourceFacts: value.stableSourceFacts,
    aiCreativeReferences: value.aiCreativeReferences,
    issues: value.issues,
    prohibitedClaims: value.prohibitedClaims,
    creativePreferences: value.creativePreferences,
    visualReferences: value.visualReferences,
    humanReviewRequired: value.humanReviewRequired,
  });
  if (!createdBy || !candidate) return null;
  if (!isRecord(value.confirmation) || !hasExactKeys(value.confirmation, ["confirmed", "confirmedAt", "confirmedBy"])) return null;
  const confirmedBy = parseActor(value.confirmation.confirmedBy);
  if (value.confirmation.confirmed !== true || !isIsoDate(value.confirmation.confirmedAt) || !confirmedBy) return null;
  if (value.handoffFingerprint !== calculateHandoffFingerprint(candidate)) return null;
  return {
    revision: value.revision,
    createdAt: value.createdAt,
    createdBy,
    ...candidate,
    confirmation: {
      confirmed: true,
      confirmedAt: value.confirmation.confirmedAt,
      confirmedBy,
    },
    handoffFingerprint: value.handoffFingerprint,
  };
}

function handoffByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function parseProductCreativeHandoff(value: unknown): ProductCreativeHandoffV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schema", "handoffId", "taskId", "candidateId", "currentRevision", "controlState", "createdAt", "createdBy",
    "researchMode", "promotionEligible", "versions",
  ], ["revokedAt", "revokeReasonCode"])) return null;
  if (value.schema !== PRODUCT_CREATIVE_HANDOFF_SCHEMA
    || !isUuid(value.handoffId)
    || !isBoundedIdentity(value.taskId)
    || !isBoundedIdentity(value.candidateId)
    || !isSafeIntegerBetween(value.currentRevision, 1, PRODUCT_CREATIVE_HANDOFF_MAX_VERSIONS)
    || (value.controlState !== "active" && value.controlState !== "revoked")
    || !isIsoDate(value.createdAt)
    || value.researchMode !== "market_research_only"
    || value.promotionEligible !== false
    || !Array.isArray(value.versions)
    || value.versions.length < 1
    || value.versions.length > PRODUCT_CREATIVE_HANDOFF_MAX_VERSIONS
    || handoffByteLength(value) > PRODUCT_CREATIVE_HANDOFF_MAX_UTF8_BYTES) return null;
  const createdBy = parseActor(value.createdBy);
  const versions = value.versions.map(parseVersion);
  if (!createdBy || versions.some((version) => !version)) return null;
  const parsedVersions = versions as ProductCreativeHandoffVersion[];
  if (value.currentRevision !== parsedVersions.length
    || parsedVersions.some((version, index) => version.revision !== index + 1)
    || parsedVersions.at(-1)?.revision !== value.currentRevision
    || parsedVersions.some((version) => version.sourceResearch.candidateId !== value.candidateId)) return null;
  if (value.controlState === "active" && (value.revokedAt !== undefined || value.revokeReasonCode !== undefined)) return null;
  if (value.controlState === "revoked") {
    if (!isIsoDate(value.revokedAt)
      || (value.revokeReasonCode !== "explicit_user_revoke"
        && value.revokeReasonCode !== "decision_changed"
        && value.revokeReasonCode !== "identity_invalid"
        && value.revokeReasonCode !== "verification_invalid")) return null;
  }
  const revokedAt = value.controlState === "revoked" ? value.revokedAt as string : undefined;
  const revokeReasonCode = value.controlState === "revoked"
    ? value.revokeReasonCode as NonNullable<ProductCreativeHandoffV1["revokeReasonCode"]>
    : undefined;
  return {
    schema: PRODUCT_CREATIVE_HANDOFF_SCHEMA,
    handoffId: value.handoffId.toLowerCase(),
    taskId: value.taskId,
    candidateId: value.candidateId,
    currentRevision: value.currentRevision,
    controlState: value.controlState,
    ...(revokedAt ? { revokedAt } : {}),
    ...(revokeReasonCode ? { revokeReasonCode } : {}),
    createdAt: value.createdAt,
    createdBy,
    researchMode: "market_research_only",
    promotionEligible: false,
    versions: parsedVersions,
  };
}

export function createProductCreativeHandoff(input: {
  handoffId: string;
  taskId: string;
  candidateId: string;
  createdAt: string;
  createdBy: ProductCreativeHandoffInternalActor;
  candidate: ProductCreativeHandoffCandidate;
}): ProductCreativeHandoffV1 {
  for (const fact of input.candidate.confirmedFacts ?? []) {
    if (fact.sourceRef?.sourceKind !== "user_confirmation") {
      throw new ProductCreativeHandoffError("confirmed_fact_requires_user_confirmation", "confirmed facts require user-confirmation provenance");
    }
  }
  for (const reference of input.candidate.visualReferences ?? []) {
    if (reference.humanApprovedForReference !== true) {
      throw new ProductCreativeHandoffError("visual_reference_not_approved", "visual references must be explicitly approved");
    }
  }
  const candidate = parseCandidate(input.candidate);
  if (!candidate) throw new ProductCreativeHandoffError("invalid_handoff_candidate", "handoff candidate is invalid");
  if (!isUuid(input.handoffId)
    || !isBoundedIdentity(input.taskId)
    || !isBoundedIdentity(input.candidateId)
    || !isIsoDate(input.createdAt)) {
    throw new ProductCreativeHandoffError("invalid_handoff_identity", "handoff identity is invalid");
  }
  const createdBy = parseActor(input.createdBy);
  if (!createdBy) throw new ProductCreativeHandoffError("invalid_handoff_actor", "handoff actor is invalid");
  if (candidate.sourceResearch.candidateId !== input.candidateId) {
    throw new ProductCreativeHandoffError("candidate_identity_mismatch", "candidate binding does not match the source research");
  }
  const version: ProductCreativeHandoffVersion = {
    revision: 1,
    createdAt: input.createdAt,
    createdBy,
    ...candidate,
    confirmation: {
      confirmed: true,
      confirmedAt: input.createdAt,
      confirmedBy: createdBy,
    },
    handoffFingerprint: calculateHandoffFingerprint(candidate),
  };
  const handoff: ProductCreativeHandoffV1 = {
    schema: PRODUCT_CREATIVE_HANDOFF_SCHEMA,
    handoffId: input.handoffId.toLowerCase(),
    taskId: input.taskId,
    candidateId: input.candidateId,
    currentRevision: 1,
    controlState: "active",
    createdAt: input.createdAt,
    createdBy,
    researchMode: "market_research_only",
    promotionEligible: false,
    versions: [version],
  };
  if (handoffByteLength(handoff) > PRODUCT_CREATIVE_HANDOFF_MAX_UTF8_BYTES) {
    throw new ProductCreativeHandoffError("handoff_too_large", "handoff exceeds 96 KiB");
  }
  const parsed = parseProductCreativeHandoff(handoff);
  if (!parsed) throw new ProductCreativeHandoffError("invalid_handoff", "constructed handoff failed validation");
  return parsed;
}

export function appendProductCreativeHandoffVersion(input: {
  handoff: ProductCreativeHandoffV1;
  candidate: ProductCreativeHandoffCandidate;
  createdAt: string;
  createdBy: ProductCreativeHandoffInternalActor;
}): ProductCreativeHandoffV1 {
  const current = parseProductCreativeHandoff(input.handoff);
  if (!current) throw new ProductCreativeHandoffError("invalid_handoff", "current handoff is invalid");
  if (current.controlState !== "active") {
    throw new ProductCreativeHandoffError("handoff_revoked", "a revoked handoff cannot receive a new version");
  }
  if (current.currentRevision >= PRODUCT_CREATIVE_HANDOFF_MAX_VERSIONS) {
    throw new ProductCreativeHandoffError("handoff_version_limit_reached", "handoff version limit reached");
  }
  const candidate = parseCandidate(input.candidate);
  if (!candidate) throw new ProductCreativeHandoffError("invalid_handoff_candidate", "handoff candidate is invalid");
  if (candidate.sourceResearch.candidateId !== current.candidateId) {
    throw new ProductCreativeHandoffError("candidate_identity_mismatch", "candidate binding does not match the handoff");
  }
  if (!isIsoDate(input.createdAt)) {
    throw new ProductCreativeHandoffError("invalid_handoff_time", "handoff version time is invalid");
  }
  const createdBy = parseActor(input.createdBy);
  if (!createdBy) throw new ProductCreativeHandoffError("invalid_handoff_actor", "handoff actor is invalid");
  const revision = current.currentRevision + 1;
  const version: ProductCreativeHandoffVersion = {
    revision,
    createdAt: input.createdAt,
    createdBy,
    ...candidate,
    confirmation: {
      confirmed: true,
      confirmedAt: input.createdAt,
      confirmedBy: createdBy,
    },
    handoffFingerprint: calculateHandoffFingerprint(candidate),
  };
  const next: ProductCreativeHandoffV1 = {
    ...current,
    currentRevision: revision,
    versions: [...current.versions, version],
  };
  if (handoffByteLength(next) > PRODUCT_CREATIVE_HANDOFF_MAX_UTF8_BYTES) {
    throw new ProductCreativeHandoffError("handoff_too_large", "handoff exceeds 96 KiB");
  }
  const parsed = parseProductCreativeHandoff(next);
  if (!parsed || !validateProductCreativeHandoffTransition(current, parsed)) {
    throw new ProductCreativeHandoffError("invalid_handoff_transition", "handoff version transition is invalid");
  }
  return parsed;
}

export function validateProductCreativeHandoffTransition(
  previousValue: unknown,
  nextValue: unknown,
): boolean {
  const previous = parseProductCreativeHandoff(previousValue);
  const next = parseProductCreativeHandoff(nextValue);
  if (!previous || !next) return false;
  if (previous.controlState !== "active" || next.controlState !== "active") return false;
  if (next.currentRevision !== previous.currentRevision + 1
    || next.versions.length !== previous.versions.length + 1
    || previous.handoffId !== next.handoffId
    || previous.taskId !== next.taskId
    || previous.candidateId !== next.candidateId
    || previous.createdAt !== next.createdAt
    || canonicalJson(previous.createdBy) !== canonicalJson(next.createdBy)
    || previous.researchMode !== next.researchMode
    || previous.promotionEligible !== next.promotionEligible) return false;
  return previous.versions.every((version, index) => canonicalJson(version) === canonicalJson(next.versions[index]));
}

export function revokeProductCreativeHandoff(
  handoffValue: unknown,
  input: {
    revokedAt: string;
    reasonCode: NonNullable<ProductCreativeHandoffV1["revokeReasonCode"]>;
  },
): ProductCreativeHandoffV1 {
  const current = parseProductCreativeHandoff(handoffValue);
  if (!current) throw new ProductCreativeHandoffError("invalid_handoff", "current handoff is invalid");
  if (current.controlState !== "active") {
    throw new ProductCreativeHandoffError("handoff_already_revoked", "handoff is already revoked");
  }
  if (!isIsoDate(input.revokedAt)
    || !["explicit_user_revoke", "decision_changed", "identity_invalid", "verification_invalid"].includes(input.reasonCode)) {
    throw new ProductCreativeHandoffError("invalid_revoke_request", "handoff revoke request is invalid");
  }
  const revoked: ProductCreativeHandoffV1 = {
    ...current,
    controlState: "revoked",
    revokedAt: input.revokedAt,
    revokeReasonCode: input.reasonCode,
  };
  const parsed = parseProductCreativeHandoff(revoked);
  if (!parsed) throw new ProductCreativeHandoffError("invalid_handoff", "revoked handoff failed validation");
  return parsed;
}
