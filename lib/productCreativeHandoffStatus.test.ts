import { describe, expect, it } from "vitest";
import vectors from "@/lib/fixtures/product-creative-handoff-golden-vectors.json";
import {
  appendProductCreativeHandoffVersion,
  createProductCreativeHandoff,
  revokeProductCreativeHandoff,
  type ProductCreativeHandoffCandidate,
} from "@/lib/productCreativeHandoff";
import { evaluateHandoffStatus } from "@/lib/productCreativeHandoffStatus";

const ACTOR = { mode: "owner", subjectFingerprint: "1".repeat(16) } as const;

function candidate(): ProductCreativeHandoffCandidate {
  return structuredClone(vectors.vectors[0].candidate) as ProductCreativeHandoffCandidate;
}

function handoff() {
  return createProductCreativeHandoff({
    handoffId: "77777777-7777-4777-8777-777777777777",
    taskId: "task-golden-1",
    candidateId: "candidate-golden-1",
    createdAt: "2026-08-04T00:00:00.000Z",
    createdBy: ACTOR,
    candidate: candidate(),
  });
}

function currentResearch() {
  const source = candidate().sourceResearch;
  return {
    candidateId: source.candidateId,
    researchRevision: source.researchRevision,
    researchHash: source.researchHash,
    candidateSourceFingerprint: source.candidateSourceFingerprint,
    verificationValid: true,
    workflowStatus: "completed" as const,
    decisionStatus: "creative_ready" as const,
  };
}

describe("derived handoff status", () => {
  it("returns active only when the current research and current handoff revision still match", () => {
    expect(evaluateHandoffStatus({ handoff: handoff(), currentResearch: currentResearch() })).toEqual({
      status: "active",
      reasonCode: "current",
      generationAllowed: true,
    });
  });

  it.each([
    ["researchRevision", 99, "research_revision_changed"],
    ["researchHash", "c".repeat(64), "research_basis_changed"],
    ["candidateSourceFingerprint", "d".repeat(64), "source_snapshot_changed"],
  ] as const)("marks %s drift stale", (field, value, reasonCode) => {
    expect(evaluateHandoffStatus({
      handoff: handoff(),
      currentResearch: { ...currentResearch(), [field]: value },
    })).toEqual({ status: "stale", reasonCode, generationAllowed: false });
  });

  it("revokes candidate mismatches and failed verification", () => {
    expect(evaluateHandoffStatus({
      handoff: handoff(),
      currentResearch: { ...currentResearch(), candidateId: "candidate-other" },
    })).toEqual({ status: "revoked", reasonCode: "identity_invalid", generationAllowed: false });
    expect(evaluateHandoffStatus({
      handoff: handoff(),
      currentResearch: { ...currentResearch(), verificationValid: false },
    })).toEqual({ status: "revoked", reasonCode: "verification_invalid", generationAllowed: false });
    expect(evaluateHandoffStatus({
      handoff: handoff(),
      currentResearch: { ...currentResearch(), workflowStatus: "partial_failed" },
    })).toEqual({ status: "revoked", reasonCode: "workflow_incomplete", generationAllowed: false });
  });

  it.each([
    ["needs_information", "decision_needs_information"],
    ["abandoned", "decision_abandoned"],
  ] as const)("revokes when the latest decision becomes %s", (decisionStatus, reasonCode) => {
    expect(evaluateHandoffStatus({
      handoff: handoff(),
      currentResearch: { ...currentResearch(), decisionStatus },
    })).toEqual({ status: "revoked", reasonCode, generationAllowed: false });
  });

  it("marks an older version stale after a newer handoff revision is created", () => {
    const current = handoff();
    const nextCandidate = candidate();
    nextCandidate.creativePreferences.tone = "new tone";
    const next = appendProductCreativeHandoffVersion({
      handoff: current,
      candidate: nextCandidate,
      createdAt: "2026-08-04T00:05:00.000Z",
      createdBy: ACTOR,
    });

    expect(evaluateHandoffStatus({
      handoff: next,
      versionRevision: 1,
      currentResearch: currentResearch(),
    })).toEqual({ status: "stale", reasonCode: "handoff_revision_superseded", generationAllowed: false });
  });

  it("honours an explicit server-stored revocation", () => {
    const revoked = revokeProductCreativeHandoff(handoff(), {
      revokedAt: "2026-08-04T00:10:00.000Z",
      reasonCode: "explicit_user_revoke",
    });
    expect(evaluateHandoffStatus({ handoff: revoked, currentResearch: currentResearch() })).toEqual({
      status: "revoked",
      reasonCode: "explicit_user_revoke",
      generationAllowed: false,
    });
  });
});
