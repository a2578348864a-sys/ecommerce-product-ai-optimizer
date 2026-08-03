import {
  parseProductCreativeHandoff,
  ProductCreativeHandoffError,
  type ProductCreativeHandoffV1,
} from "@/lib/productCreativeHandoff";

export type ProductCreativeHandoffEffectiveStatus = "active" | "stale" | "revoked";

export type ProductCreativeHandoffStatusReason =
  | "current"
  | "research_revision_changed"
  | "research_basis_changed"
  | "source_snapshot_changed"
  | "handoff_revision_superseded"
  | "decision_needs_information"
  | "decision_abandoned"
  | "identity_invalid"
  | "verification_invalid"
  | "workflow_incomplete"
  | "explicit_user_revoke"
  | "decision_changed";

export type ProductCreativeHandoffCurrentResearch = {
  candidateId: string;
  researchRevision: number;
  researchHash: string;
  candidateSourceFingerprint: string;
  verificationValid: boolean;
  workflowStatus: "completed" | "partial_failed";
  decisionStatus: "creative_ready" | "needs_information" | "abandoned";
};

export type ProductCreativeHandoffStatusResult = {
  status: ProductCreativeHandoffEffectiveStatus;
  reasonCode: ProductCreativeHandoffStatusReason;
  generationAllowed: boolean;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/;

function assertCurrentResearch(value: ProductCreativeHandoffCurrentResearch): void {
  if (!value
    || typeof value.candidateId !== "string"
    || !value.candidateId
    || value.candidateId !== value.candidateId.trim()
    || value.candidateId.length > 120
    || !Number.isSafeInteger(value.researchRevision)
    || value.researchRevision < 1
    || value.researchRevision > 1_000_000
    || !HASH_PATTERN.test(value.researchHash)
    || !HASH_PATTERN.test(value.candidateSourceFingerprint)
    || typeof value.verificationValid !== "boolean"
    || (value.workflowStatus !== "completed" && value.workflowStatus !== "partial_failed")
    || (value.decisionStatus !== "creative_ready"
      && value.decisionStatus !== "needs_information"
      && value.decisionStatus !== "abandoned")) {
    throw new ProductCreativeHandoffError("invalid_current_research", "current research state is invalid");
  }
}

function revoked(reasonCode: ProductCreativeHandoffStatusReason): ProductCreativeHandoffStatusResult {
  return { status: "revoked", reasonCode, generationAllowed: false };
}

function stale(reasonCode: ProductCreativeHandoffStatusReason): ProductCreativeHandoffStatusResult {
  return { status: "stale", reasonCode, generationAllowed: false };
}

function storedRevokeReason(handoff: ProductCreativeHandoffV1): ProductCreativeHandoffStatusReason {
  if (handoff.revokeReasonCode === "identity_invalid") return "identity_invalid";
  if (handoff.revokeReasonCode === "verification_invalid") return "verification_invalid";
  if (handoff.revokeReasonCode === "decision_changed") return "decision_changed";
  return "explicit_user_revoke";
}

export function evaluateHandoffStatus(input: {
  handoff: unknown;
  currentResearch: ProductCreativeHandoffCurrentResearch;
  versionRevision?: number;
}): ProductCreativeHandoffStatusResult {
  const handoff = parseProductCreativeHandoff(input.handoff);
  if (!handoff) throw new ProductCreativeHandoffError("invalid_handoff", "handoff is invalid");
  assertCurrentResearch(input.currentResearch);
  const versionRevision = input.versionRevision ?? handoff.currentRevision;
  if (!Number.isSafeInteger(versionRevision)
    || versionRevision < 1
    || versionRevision > handoff.currentRevision) {
    throw new ProductCreativeHandoffError("invalid_handoff_revision", "handoff revision is invalid");
  }

  if (handoff.controlState === "revoked") return revoked(storedRevokeReason(handoff));
  if (handoff.candidateId !== input.currentResearch.candidateId) return revoked("identity_invalid");
  if (!input.currentResearch.verificationValid) return revoked("verification_invalid");
  if (input.currentResearch.workflowStatus !== "completed") return revoked("workflow_incomplete");
  if (input.currentResearch.decisionStatus === "needs_information") return revoked("decision_needs_information");
  if (input.currentResearch.decisionStatus === "abandoned") return revoked("decision_abandoned");
  if (versionRevision !== handoff.currentRevision) return stale("handoff_revision_superseded");

  const version = handoff.versions[versionRevision - 1];
  if (version.sourceResearch.researchRevision !== input.currentResearch.researchRevision) {
    return stale("research_revision_changed");
  }
  if (version.sourceResearch.researchHash !== input.currentResearch.researchHash) {
    return stale("research_basis_changed");
  }
  if (version.sourceResearch.candidateSourceFingerprint !== input.currentResearch.candidateSourceFingerprint) {
    return stale("source_snapshot_changed");
  }
  return { status: "active", reasonCode: "current", generationAllowed: true };
}
