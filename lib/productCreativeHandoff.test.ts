import { describe, expect, it } from "vitest";
import {
  appendProductCreativeHandoffVersion,
  calculateHandoffFingerprint,
  createProductCreativeHandoff,
  parseProductCreativeHandoff,
  ProductCreativeHandoffError,
  revokeProductCreativeHandoff,
  validateProductCreativeHandoffTransition,
  type ProductCreativeHandoffCandidate,
  type ProductCreativeHandoffInternalActor,
  type ProductCreativeHandoffVersion,
} from "@/lib/productCreativeHandoff";

const OWNER: ProductCreativeHandoffInternalActor = {
  mode: "owner",
  subjectFingerprint: "1".repeat(16),
};

const CREATED_AT = "2026-08-04T00:00:00.000Z";

export function validHandoffCandidate(): ProductCreativeHandoffCandidate {
  return {
    sourceResearch: {
      recordSchema: "product-research-record.v1",
      candidateId: "candidate-synthetic-1",
      researchRevision: 2,
      researchHash: "a".repeat(64),
      workflowStatus: "completed",
      decisionStatus: "creative_ready",
      candidateSourceFingerprint: "b".repeat(64),
    },
    productIdentity: {
      displayName: "Synthetic desk organizer",
      marketplace: "Amazon US",
      identityConfirmedAt: CREATED_AT,
    },
    confirmedFacts: [
      {
        factId: "11111111-1111-4111-8111-111111111111",
        field: "material",
        label: "Material",
        value: "Recycled paperboard",
        evidenceTier: "human_confirmed",
        usageScopes: ["listing", "image"],
        sourceRef: {
          sourceKind: "user_confirmation",
          sourceField: "material",
          confirmedBy: OWNER,
          confirmedAt: CREATED_AT,
          confirmationReference: "manual-review:material:v1",
        },
        confirmedAt: CREATED_AT,
        confirmedBy: OWNER,
      },
    ],
    stableSourceFacts: [
      {
        factId: "22222222-2222-4222-8222-222222222222",
        field: "source_title",
        label: "Source title",
        value: "Synthetic source snapshot",
        evidenceTier: "source_snapshot",
        usageScopes: ["internal"],
        sourceRef: {
          sourceKind: "seller_sprite_snapshot",
          sourceField: "title",
          sellerSpriteSnapshotFingerprint: "c".repeat(64),
          capturedAt: CREATED_AT,
        },
        stabilityRule: "human_confirmation_required_for_claim",
      },
    ],
    aiCreativeReferences: [
      {
        referenceId: "33333333-3333-4333-8333-333333333333",
        field: "layout_direction",
        summary: "Use a calm comparison layout.",
        evidenceTier: "ai_hypothesis",
        allowedUse: "layout",
        prohibitedUses: [
          "title_fact",
          "bullet_fact",
          "parameter",
          "certification",
          "performance_claim",
          "image_text",
        ],
      },
    ],
    issues: [
      {
        issueId: "44444444-4444-4444-8444-444444444444",
        field: "dimensions",
        kind: "missing",
        summary: "Dimensions are not confirmed.",
        risk: "medium",
        blocks: ["listing_bullets", "image_product_depiction"],
        recommendedAction: "Confirm dimensions before using them.",
      },
    ],
    prohibitedClaims: [
      {
        claimId: "55555555-5555-4555-8555-555555555555",
        category: "unconfirmed_dimension",
        summary: "Do not state or depict dimensions.",
        appliesTo: ["both"],
        source: "research_issue",
      },
    ],
    creativePreferences: {
      evidenceTier: "creative_preference",
      targetMarket: "US",
      language: "en-US",
      tone: "clear and restrained",
      imageStyle: "minimal studio concept",
    },
    visualReferences: [
      {
        assetFingerprint: "d".repeat(64),
        sourceTier: "human_confirmed",
        identityBound: true,
        humanApprovedForReference: true,
        approvedBy: OWNER,
        approvedAt: CREATED_AT,
        confirmationReference: "visual-review:hero-image:v1",
      },
    ],
    humanReviewRequired: true,
  };
}

function createValidHandoff() {
  return createProductCreativeHandoff({
    handoffId: "66666666-6666-4666-8666-666666666666",
    taskId: "task-synthetic-1",
    candidateId: "candidate-synthetic-1",
    createdAt: CREATED_AT,
    createdBy: OWNER,
    candidate: validHandoffCandidate(),
  });
}

function candidateFromVersion(version: ProductCreativeHandoffVersion): ProductCreativeHandoffCandidate {
  const {
    revision: _revision,
    createdAt: _createdAt,
    createdBy: _createdBy,
    confirmation: _confirmation,
    handoffFingerprint: _handoffFingerprint,
    ...candidate
  } = version;
  return candidate;
}

describe("product-creative-handoff.v1 contract", () => {
  it("creates a strict revision-one active handoff with a confirmed input package", () => {
    const handoff = createValidHandoff();

    expect(handoff).toMatchObject({
      schema: "product-creative-handoff.v1",
      currentRevision: 1,
      controlState: "active",
      researchMode: "market_research_only",
      promotionEligible: false,
    });
    expect(handoff.versions).toHaveLength(1);
    expect(handoff.versions[0].confirmation.confirmed).toBe(true);
    expect(handoff.versions[0].handoffFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(parseProductCreativeHandoff(handoff)).toEqual(handoff);
  });

  it("rejects unknown fields and fixed-policy changes", () => {
    const handoff = createValidHandoff();

    expect(parseProductCreativeHandoff({ ...handoff, futureField: true })).toBeNull();
    expect(parseProductCreativeHandoff({ ...handoff, promotionEligible: true })).toBeNull();
    expect(parseProductCreativeHandoff({ ...handoff, researchMode: "commercial_promotion" })).toBeNull();
  });

  it("requires user-confirmation provenance for every confirmed fact", () => {
    const candidate = validHandoffCandidate();
    candidate.confirmedFacts[0] = {
      ...candidate.confirmedFacts[0],
      sourceRef: {
        sourceKind: "candidate_snapshot",
        sourceField: "material",
        sourceSnapshotFingerprint: "e".repeat(64),
      },
    } as never;

    expect(() => createProductCreativeHandoff({
      handoffId: "77777777-7777-4777-8777-777777777777",
      taskId: "task-synthetic-1",
      candidateId: "candidate-synthetic-1",
      createdAt: CREATED_AT,
      createdBy: OWNER,
      candidate,
    })).toThrowError(expect.objectContaining({ code: "confirmed_fact_requires_user_confirmation" }));
  });

  it("fails closed without confirmed facts or prohibited claims", () => {
    for (const mutation of ["confirmedFacts", "prohibitedClaims"] as const) {
      const candidate = validHandoffCandidate();
      candidate[mutation] = [] as never;
      expect(() => createProductCreativeHandoff({
        handoffId: "88888888-8888-4888-8888-888888888888",
        taskId: "task-synthetic-1",
        candidateId: "candidate-synthetic-1",
        createdAt: CREATED_AT,
        createdBy: OWNER,
        candidate,
      })).toThrowError(ProductCreativeHandoffError);
    }
  });

  it("rejects conflicting confirmed facts for the same field", () => {
    const candidate = validHandoffCandidate();
    candidate.confirmedFacts.push({
      ...structuredClone(candidate.confirmedFacts[0]),
      factId: "aaaaaaaa-1111-4111-8111-111111111111",
      value: "Conflicting material",
    });

    expect(() => createProductCreativeHandoff({
      handoffId: "abababab-abab-4bab-8bab-abababababab",
      taskId: "task-synthetic-1",
      candidateId: "candidate-synthetic-1",
      createdAt: CREATED_AT,
      createdBy: OWNER,
      candidate,
    })).toThrowError(expect.objectContaining({ code: "invalid_handoff_candidate" }));
  });

  it("rejects duplicate semantic identifiers in every set-like collection", () => {
    const mutations: Array<(candidate: ProductCreativeHandoffCandidate) => void> = [
      (candidate) => candidate.stableSourceFacts.push(structuredClone(candidate.stableSourceFacts[0])),
      (candidate) => candidate.aiCreativeReferences.push(structuredClone(candidate.aiCreativeReferences[0])),
      (candidate) => candidate.issues.push(structuredClone(candidate.issues[0])),
      (candidate) => candidate.prohibitedClaims.push(structuredClone(candidate.prohibitedClaims[0])),
      (candidate) => candidate.visualReferences.push(structuredClone(candidate.visualReferences[0])),
    ];

    for (const mutate of mutations) {
      const candidate = validHandoffCandidate();
      mutate(candidate);
      expect(() => createProductCreativeHandoff({
        handoffId: "acacacac-acac-4cac-8cac-acacacacacac",
        taskId: "task-synthetic-1",
        candidateId: "candidate-synthetic-1",
        createdAt: CREATED_AT,
        createdBy: OWNER,
        candidate,
      })).toThrowError(expect.objectContaining({ code: "invalid_handoff_candidate" }));
    }
  });

  it("rejects an unapproved visual reference and a creative preference disguised as a fact", () => {
    const unapproved = validHandoffCandidate();
    unapproved.visualReferences[0] = {
      ...unapproved.visualReferences[0],
      humanApprovedForReference: false,
    } as never;
    expect(() => createProductCreativeHandoff({
      handoffId: "99999999-9999-4999-8999-999999999999",
      taskId: "task-synthetic-1",
      candidateId: "candidate-synthetic-1",
      createdAt: CREATED_AT,
      createdBy: OWNER,
      candidate: unapproved,
    })).toThrowError(expect.objectContaining({ code: "visual_reference_not_approved" }));

    const disguised = validHandoffCandidate();
    disguised.confirmedFacts[0] = {
      ...disguised.confirmedFacts[0],
      evidenceTier: "creative_preference",
    } as never;
    expect(() => createProductCreativeHandoff({
      handoffId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      taskId: "task-synthetic-1",
      candidateId: "candidate-synthetic-1",
      createdAt: CREATED_AT,
      createdBy: OWNER,
      candidate: disguised,
    })).toThrowError(ProductCreativeHandoffError);
  });

  it("appends immutable contiguous versions up to ten and rejects an eleventh", () => {
    let handoff = createValidHandoff();
    for (let revision = 2; revision <= 10; revision += 1) {
      const candidate = validHandoffCandidate();
      candidate.sourceResearch.researchRevision = revision + 1;
      candidate.sourceResearch.researchHash = revision.toString(16).padStart(64, "0");
      candidate.creativePreferences.tone = `clear revision ${revision}`;
      const previous = handoff;
      handoff = appendProductCreativeHandoffVersion({
        handoff,
        candidate,
        createdAt: new Date(Date.UTC(2026, 7, 4, 0, revision)).toISOString(),
        createdBy: OWNER,
      });
      expect(validateProductCreativeHandoffTransition(previous, handoff)).toBe(true);
    }

    expect(handoff.currentRevision).toBe(10);
    expect(handoff.versions.map((version) => version.revision)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => appendProductCreativeHandoffVersion({
      handoff,
      candidate: validHandoffCandidate(),
      createdAt: "2026-08-04T01:00:00.000Z",
      createdBy: OWNER,
    })).toThrowError(expect.objectContaining({ code: "handoff_version_limit_reached" }));
  });

  it("detects a rewritten historical version even when the forged object is internally valid", () => {
    const first = createValidHandoff();
    const second = appendProductCreativeHandoffVersion({
      handoff: first,
      candidate: validHandoffCandidate(),
      createdAt: "2026-08-04T00:02:00.000Z",
      createdBy: OWNER,
    });
    const forged = structuredClone(second);
    forged.versions[0].productIdentity.displayName = "Rewritten history";
    forged.versions[0].handoffFingerprint = calculateHandoffFingerprint(candidateFromVersion(forged.versions[0]));

    expect(parseProductCreativeHandoff(forged)).not.toBeNull();
    expect(validateProductCreativeHandoffTransition(first, forged)).toBe(false);
  });

  it("revokes without rewriting version history", () => {
    const current = createValidHandoff();
    const revoked = revokeProductCreativeHandoff(current, {
      revokedAt: "2026-08-04T00:10:00.000Z",
      reasonCode: "explicit_user_revoke",
    });

    expect(revoked.controlState).toBe("revoked");
    expect(revoked.versions).toEqual(current.versions);
    expect(parseProductCreativeHandoff(revoked)).toEqual(revoked);
  });

  it("rejects non-contiguous revision metadata", () => {
    const handoff = createValidHandoff();
    expect(parseProductCreativeHandoff({ ...handoff, currentRevision: 2 })).toBeNull();
    expect(parseProductCreativeHandoff({
      ...handoff,
      versions: [{ ...handoff.versions[0], revision: 2 }],
    })).toBeNull();
  });

  it("fails closed when the final UTF-8 payload exceeds 96 KiB", () => {
    const candidate = validHandoffCandidate();
    candidate.confirmedFacts = Array.from({ length: 50 }, (_, index) => ({
      ...structuredClone(candidate.confirmedFacts[0]),
      factId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      field: `confirmed_field_${index + 1}`,
      label: `Confirmed field ${index + 1}`,
      value: "中".repeat(1_000),
      sourceRef: {
        ...structuredClone(candidate.confirmedFacts[0].sourceRef),
        sourceField: `confirmed_field_${index + 1}`,
        confirmationReference: `manual-review:field-${index + 1}:v1`,
      },
    }));
    candidate.prohibitedClaims = Array.from({ length: 50 }, (_, index) => ({
      ...structuredClone(candidate.prohibitedClaims[0]),
      claimId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      summary: `Restriction ${index + 1}: ${"文".repeat(470)}`,
    }));

    expect(() => createProductCreativeHandoff({
      handoffId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      taskId: "task-synthetic-1",
      candidateId: "candidate-synthetic-1",
      createdAt: CREATED_AT,
      createdBy: OWNER,
      candidate,
    })).toThrowError(expect.objectContaining({ code: "handoff_too_large" }));
  });
});
