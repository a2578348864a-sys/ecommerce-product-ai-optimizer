import { describe, expect, it } from "vitest";
import vectors from "@/lib/fixtures/product-creative-handoff-golden-vectors.json";
import type {
  ProductCreativeHandoffCandidate,
  ProductCreativeHandoffConfirmedFact,
  ProductCreativeHandoffIssue,
} from "@/lib/productCreativeHandoff";
import {
  ProductCreativeHandoffProjectionError,
  projectProductCreativeHandoffCandidate,
  type ProductCreativeHandoffProjectionInput,
} from "@/lib/productCreativeHandoffProjection";

function sourceCandidate(): ProductCreativeHandoffCandidate {
  return structuredClone(vectors.vectors[0].candidate) as ProductCreativeHandoffCandidate;
}

function conflictIssue(): ProductCreativeHandoffIssue {
  return {
    issueId: "33333333-3333-4333-8333-333333333333",
    field: "dimensions",
    kind: "conflict",
    summary: "Two source snapshots disagree.",
    sourceSummaries: ["source A differs", "source B differs"],
    risk: "high",
    blocks: ["listing_bullets", "image_product_depiction"],
    recommendedAction: "Confirm the dimensions manually.",
  };
}

function projectionInput(): ProductCreativeHandoffProjectionInput {
  const source = sourceCandidate();
  return {
    sourceResearch: source.sourceResearch,
    productIdentity: source.productIdentity,
    evidence: [
      {
        evidenceTier: "source_snapshot",
        fact: {
          factId: "44444444-4444-4444-8444-444444444444",
          field: "source_title",
          label: "Source title",
          value: "Snapshot title",
          evidenceTier: "source_snapshot",
          usageScopes: ["internal"],
          sourceRef: {
            sourceKind: "seller_sprite_snapshot",
            sourceField: "title",
            sellerSpriteSnapshotFingerprint: "c".repeat(64),
            capturedAt: "2026-08-04T00:00:00.000Z",
          },
          stabilityRule: "human_confirmation_required_for_claim",
        },
      },
      {
        evidenceTier: "deterministic_check",
        checkId: "source_identity_consistent",
        passed: true,
        blocksHandoff: true,
        summary: "Source identity is internally consistent.",
      },
      {
        evidenceTier: "human_confirmed",
        fact: structuredClone(source.confirmedFacts[0]),
      },
      {
        evidenceTier: "ai_hypothesis",
        reference: {
          referenceId: "55555555-5555-4555-8555-555555555555",
          field: "composition",
          summary: "Use a calm comparison layout.",
          evidenceTier: "ai_hypothesis",
          allowedUse: "composition",
          prohibitedUses: [
            "title_fact",
            "bullet_fact",
            "parameter",
            "certification",
            "performance_claim",
            "image_text",
          ],
        },
      },
      {
        evidenceTier: "unknown_or_conflict",
        issue: conflictIssue(),
      },
    ],
    prohibitedClaims: source.prohibitedClaims,
    creativePreferences: {
      evidenceTier: "creative_preference",
      tone: "Cafe\u0301 clarity",
    },
    visualReferences: [],
  };
}

describe("five-tier product research projection", () => {
  it("keeps every evidence tier separate and normalizes projected text to NFC", () => {
    const result = projectProductCreativeHandoffCandidate(projectionInput());

    expect(result.eligible).toBe(true);
    expect(result.blockingCodes).toEqual([]);
    expect(result.candidate).not.toBeNull();
    expect(result.candidate?.confirmedFacts.map((fact) => fact.field)).toEqual(["material"]);
    expect(result.candidate?.stableSourceFacts.map((fact) => fact.field)).toEqual(["source_title"]);
    expect(result.candidate?.aiCreativeReferences.map((item) => item.field)).toEqual(["composition"]);
    expect(result.candidate?.issues.map((issue) => issue.kind)).toEqual(["conflict"]);
    expect(result.candidate?.creativePreferences.tone).toBe("Caf\u00e9 clarity");
    expect(result.deterministicChecks).toEqual([
      expect.objectContaining({ checkId: "source_identity_consistent", passed: true }),
    ]);
  });

  it("never upgrades a source snapshot or AI hypothesis into a confirmed fact", () => {
    const snapshotPromotion = projectionInput();
    const snapshot = snapshotPromotion.evidence[0];
    if (snapshot.evidenceTier !== "source_snapshot") throw new Error("fixture mismatch");
    snapshot.fact.usageScopes = ["listing"] as never;
    expect(() => projectProductCreativeHandoffCandidate(snapshotPromotion)).toThrowError(
      ProductCreativeHandoffProjectionError,
    );

    const aiPromotion = projectionInput();
    const confirmed = aiPromotion.evidence.find((item) => item.evidenceTier === "human_confirmed");
    if (!confirmed || confirmed.evidenceTier !== "human_confirmed") throw new Error("fixture mismatch");
    confirmed.fact = {
      ...confirmed.fact,
      evidenceTier: "ai_hypothesis",
    } as unknown as ProductCreativeHandoffConfirmedFact;
    expect(() => projectProductCreativeHandoffCandidate(aiPromotion)).toThrowError(
      ProductCreativeHandoffProjectionError,
    );
  });

  it("fails the projection gate when a blocking deterministic check fails", () => {
    const input = projectionInput();
    const check = input.evidence.find((item) => item.evidenceTier === "deterministic_check");
    if (!check || check.evidenceTier !== "deterministic_check") throw new Error("fixture mismatch");
    check.passed = false;

    const result = projectProductCreativeHandoffCandidate(input);
    expect(result).toMatchObject({
      eligible: false,
      candidate: null,
      blockingCodes: ["deterministic_check_failed:source_identity_consistent"],
    });
  });

  it("rejects unknown evidence fields instead of widening the contract", () => {
    const input = projectionInput();
    input.evidence[0] = { ...input.evidence[0], futureEvidence: true } as never;

    expect(() => projectProductCreativeHandoffCandidate(input)).toThrowError(
      expect.objectContaining({ code: "unknown_evidence_field" }),
    );
  });
});
