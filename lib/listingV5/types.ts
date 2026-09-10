import type { ListingV5ExecutionTrace } from "./trace";

export const LISTING_V5_CONTEXT_VERSION = "listing-v5.context.v1" as const;
export const LISTING_V5_STRATEGY_VERSION = "listing-v5.strategy.v1" as const;
export const LISTING_V5_WRITER_VERSION = "listing-v5.writer-draft.v1" as const;
export const LISTING_V5_VALIDATION_VERSION = "listing-v5.validation.v3" as const;
export const LISTING_V5_STRATEGY_PROMPT_VERSION = "listing-v5-strategy.v4" as const;
export const LISTING_V5_WRITER_PROMPT_VERSION = "listing-v5-writer.v2" as const;
export const LISTING_V5_REPAIR_PROMPT_VERSION = "listing-v5-repair.v2" as const;

export type ListingV5Reference = {
  text: string;
  sourceType: "VOC" | "keyword" | "competitor" | "sourcing";
  marker: "UNTRUSTED_REFERENCE_DATA";
  notProductFact: true;
};

export type ListingV5Fact = {
  id: string;
  canonicalField: string;
  label: string;
  value: string;
  sourceRefs: string[];
};

export type ListingV5Context = {
  version: typeof LISTING_V5_CONTEXT_VERSION;
  taskId: string;
  researchRevision: number;
  handoffRevision: number;
  contextFingerprint: string;
  marketplace: string;
  productIdentity: string;
  confirmedFacts: ListingV5Fact[];
  prohibitedClaims: string[];
  unknowns: string[];
  references: {
    voc: ListingV5Reference[];
    keywords: ListingV5Reference[];
    competitors: ListingV5Reference[];
    sourcing: ListingV5Reference[];
  };
  manualDirection: string | null;
};

export type ListingV5BulletRole = "core_outcome" | "pain_relief" | "use_scenario" | "ease_of_use" | "proof_or_fit";

export type ListingV5Strategy = {
  version: typeof LISTING_V5_STRATEGY_VERSION;
  referenceOnly: true;
  researchRevision: number;
  targetAudience: string[];
  purchaseMotivations: string[];
  painPoints: string[];
  useCases: string[];
  primaryAngle: string;
  secondaryAngles: string[];
  tone: string[];
  keywordIntent: { primary: string[]; secondary: string[]; backendOnly: string[] };
  bulletAngles: Array<{ role: ListingV5BulletRole; shopperValue: string }>;
  avoidClaims: string[];
};

export type ListingV5WriterBullet = {
  text: string;
  factIds: string[];
  strategyRole: ListingV5BulletRole;
};

export type ListingV5WriterDraft = {
  version: typeof LISTING_V5_WRITER_VERSION;
  title: { text: string; factIds: string[] };
  bullets: ListingV5WriterBullet[];
  description: { text: string; factIds: string[] };
  backendSearchTerms: string[];
  humanReviewRequired: true;
};

export type ListingV5ValidationResult = {
  version: typeof LISTING_V5_VALIDATION_VERSION;
  status: "PASS" | "REPAIRABLE" | "BLOCK";
  title: { valid: boolean; issues: string[] };
  bullets: Array<{ valid: boolean; factIds: string[]; strategyRole: ListingV5BulletRole; issues: string[] }>;
  description: { valid: boolean; issues: string[] };
  claims: { allHaveEvidence: boolean; unsupportedClaims: string[]; prohibitedClaims: string[]; competitorOverlap: string[] };
  quality: { repetitive: boolean; keywordStuffing: boolean; mechanicalTemplate: boolean };
  /** `targets` lists the bounded text fields one repair pass may rewrite. */
  repair: { allowed: boolean; reason: string | null; targets: string[] };
};

export type ListingV5Snapshot = {
  version: "listing-v5.snapshot.v1";
  taskId: string;
  researchRevision: number;
  handoffRevision: number;
  contextFingerprint: string;
  strategy: ListingV5Strategy | null;
  listing: ListingV5WriterDraft | null;
  validation: ListingV5ValidationResult;
  strategyPromptVersion: typeof LISTING_V5_STRATEGY_PROMPT_VERSION;
  writerPromptVersion: typeof LISTING_V5_WRITER_PROMPT_VERSION;
  validatorVersion: typeof LISTING_V5_VALIDATION_VERSION;
  repairApplied: boolean;
  repairPromptVersion: typeof LISTING_V5_REPAIR_PROMPT_VERSION;
  provider: { strategyAttempted: boolean; writerAttempted: boolean; repairAttempted: boolean; fallbackUsed: boolean };
  model: string;
  generatedAt: string;
  humanReviewRequired: true;
  /** Development / test only AI execution trace. Never emitted in production. */
  trace?: ListingV5ExecutionTrace;
};
