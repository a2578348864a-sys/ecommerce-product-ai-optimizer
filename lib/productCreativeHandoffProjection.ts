import {
  calculateHandoffFingerprint,
  ProductCreativeHandoffError,
  type ProductCreativeHandoffAiReference,
  type ProductCreativeHandoffCandidate,
  type ProductCreativeHandoffConfirmedFact,
  type ProductCreativeHandoffCreativePreferences,
  type ProductCreativeHandoffIssue,
  type ProductCreativeHandoffProductIdentity,
  type ProductCreativeHandoffProhibitedClaim,
  type ProductCreativeHandoffSourceResearch,
  type ProductCreativeHandoffStableSourceFact,
  type ProductCreativeHandoffVisualReference,
} from "@/lib/productCreativeHandoff";

export type ProductCreativeHandoffDeterministicCheck = {
  checkId: string;
  passed: boolean;
  blocksHandoff: boolean;
  summary: string;
};

export type ProductCreativeHandoffProjectionEvidence =
  | { evidenceTier: "source_snapshot"; fact: ProductCreativeHandoffStableSourceFact }
  | { evidenceTier: "deterministic_check"; checkId: string; passed: boolean; blocksHandoff: boolean; summary: string }
  | { evidenceTier: "human_confirmed"; fact: ProductCreativeHandoffConfirmedFact }
  | { evidenceTier: "ai_hypothesis"; reference: ProductCreativeHandoffAiReference }
  | { evidenceTier: "unknown_or_conflict"; issue: ProductCreativeHandoffIssue };

export type ProductCreativeHandoffProjectionInput = {
  sourceResearch: ProductCreativeHandoffSourceResearch;
  productIdentity: ProductCreativeHandoffProductIdentity;
  evidence: ProductCreativeHandoffProjectionEvidence[];
  prohibitedClaims: ProductCreativeHandoffProhibitedClaim[];
  creativePreferences: ProductCreativeHandoffCreativePreferences;
  visualReferences: ProductCreativeHandoffVisualReference[];
};

export type ProductCreativeHandoffProjectionResult = {
  eligible: boolean;
  candidate: ProductCreativeHandoffCandidate | null;
  deterministicChecks: ProductCreativeHandoffDeterministicCheck[];
  blockingCodes: string[];
};

export class ProductCreativeHandoffProjectionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProductCreativeHandoffProjectionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function normalizeNfcDeep(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(normalizeNfcDeep);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeNfcDeep(item)]));
  }
  return value;
}

function assertEvidenceShape(value: unknown): asserts value is ProductCreativeHandoffProjectionEvidence {
  if (!isRecord(value) || typeof value.evidenceTier !== "string") {
    throw new ProductCreativeHandoffProjectionError("invalid_evidence_item", "evidence item is invalid");
  }
  const exactKeys: Record<string, readonly string[]> = {
    source_snapshot: ["evidenceTier", "fact"],
    deterministic_check: ["evidenceTier", "checkId", "passed", "blocksHandoff", "summary"],
    human_confirmed: ["evidenceTier", "fact"],
    ai_hypothesis: ["evidenceTier", "reference"],
    unknown_or_conflict: ["evidenceTier", "issue"],
  };
  const expected = exactKeys[value.evidenceTier];
  if (!expected) {
    throw new ProductCreativeHandoffProjectionError("invalid_evidence_tier", "evidence tier is not supported");
  }
  if (!hasExactKeys(value, expected)) {
    throw new ProductCreativeHandoffProjectionError("unknown_evidence_field", "evidence item contains an unknown field");
  }
  if (value.evidenceTier === "deterministic_check") {
    if (typeof value.checkId !== "string"
      || !value.checkId
      || value.checkId !== value.checkId.trim()
      || value.checkId.length > 120
      || typeof value.passed !== "boolean"
      || typeof value.blocksHandoff !== "boolean"
      || typeof value.summary !== "string"
      || !value.summary.trim()
      || value.summary.length > 500) {
      throw new ProductCreativeHandoffProjectionError("invalid_deterministic_check", "deterministic check is invalid");
    }
  }
}

export function projectProductCreativeHandoffCandidate(
  input: ProductCreativeHandoffProjectionInput,
): ProductCreativeHandoffProjectionResult {
  if (!isRecord(input) || !hasExactKeys(input, [
    "sourceResearch",
    "productIdentity",
    "evidence",
    "prohibitedClaims",
    "creativePreferences",
    "visualReferences",
  ]) || !Array.isArray(input.evidence)) {
    throw new ProductCreativeHandoffProjectionError("invalid_projection_input", "projection input is invalid");
  }

  const normalized = normalizeNfcDeep(input) as ProductCreativeHandoffProjectionInput;
  const confirmedFacts: ProductCreativeHandoffConfirmedFact[] = [];
  const stableSourceFacts: ProductCreativeHandoffStableSourceFact[] = [];
  const aiCreativeReferences: ProductCreativeHandoffAiReference[] = [];
  const issues: ProductCreativeHandoffIssue[] = [];
  const deterministicChecks: ProductCreativeHandoffDeterministicCheck[] = [];
  const blockingCodes: string[] = [];

  for (const evidence of normalized.evidence) {
    assertEvidenceShape(evidence);
    if (evidence.evidenceTier === "source_snapshot") {
      stableSourceFacts.push(evidence.fact);
    } else if (evidence.evidenceTier === "deterministic_check") {
      const check = {
        checkId: evidence.checkId,
        passed: evidence.passed,
        blocksHandoff: evidence.blocksHandoff,
        summary: evidence.summary,
      };
      deterministicChecks.push(check);
      if (!check.passed && check.blocksHandoff) {
        blockingCodes.push(`deterministic_check_failed:${check.checkId}`);
      }
    } else if (evidence.evidenceTier === "human_confirmed") {
      confirmedFacts.push(evidence.fact);
    } else if (evidence.evidenceTier === "ai_hypothesis") {
      aiCreativeReferences.push(evidence.reference);
    } else {
      issues.push(evidence.issue);
    }
  }

  const candidate: ProductCreativeHandoffCandidate = {
    sourceResearch: normalized.sourceResearch,
    productIdentity: normalized.productIdentity,
    confirmedFacts,
    stableSourceFacts,
    aiCreativeReferences,
    issues,
    prohibitedClaims: normalized.prohibitedClaims,
    creativePreferences: normalized.creativePreferences,
    visualReferences: normalized.visualReferences,
    humanReviewRequired: true,
  };

  try {
    calculateHandoffFingerprint(candidate);
  } catch (error) {
    if (error instanceof ProductCreativeHandoffError) {
      throw new ProductCreativeHandoffProjectionError("invalid_projected_candidate", error.code);
    }
    throw error;
  }

  return {
    eligible: blockingCodes.length === 0,
    candidate: blockingCodes.length === 0 ? candidate : null,
    deterministicChecks,
    blockingCodes,
  };
}
