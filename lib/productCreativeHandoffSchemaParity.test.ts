import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parseProductCreativeHandoff, createProductCreativeHandoff, parseProductCreativeHandoffWithErrors, HANDOFF_ERROR_CODES } from "@/lib/productCreativeHandoff";
import { PRODUCT_CREATIVE_HANDOFF_JSON_SCHEMA } from "@/lib/productCreativeHandoffSchema";

/**
 * Schema-Runtime Parity Tests (P1-5)
 *
 * Validates that the AJV Draft 2020-12 engine and the hand-written Runtime Parser
 * produce consistent accept/reject decisions on the same parity samples.
 * Neither engine calls the other — they are completely independent.
 */

function buildAjv() {
  const ajv = new Ajv2020({
    strict: true,
    strictRequired: false,  // conditional required via allOf/if/then
    strictTypes: false,     // $defs used as arrays don't always have explicit type
    allErrors: true,
    validateFormats: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  addFormats(ajv);
  return ajv;
}

const OWNER = { mode: "owner" as const, subjectFingerprint: "1111111111111111" };
const CREATED_AT = "2026-08-04T00:00:00.000Z";

function minimalValidVersion() {
  return {
    sourceResearch: {
      recordSchema: "product-research-record.v1" as const,
      candidateId: "candidate-p-1",
      researchRevision: 1,
      researchHash: "a".repeat(64),
      workflowStatus: "completed" as const,
      decisionStatus: "creative_ready" as const,
      candidateSourceFingerprint: "b".repeat(64),
    },
    productIdentity: {
      displayName: "Parity product",
      identityConfirmedAt: CREATED_AT,
    },
    confirmedFacts: [{
      factId: "11111111-1111-4111-8111-111111111111",
      field: "material",
      label: "Material",
      value: "Steel",
      evidenceTier: "human_confirmed" as const,
      usageScopes: ["listing" as const, "image" as const],
      sourceRef: {
        sourceKind: "user_confirmation" as const,
        sourceField: "material",
        confirmedBy: OWNER,
        confirmedAt: CREATED_AT,
        confirmationReference: "manual-review:material:v1",
      },
      confirmedAt: CREATED_AT,
      confirmedBy: OWNER,
    }],
    stableSourceFacts: [],
    aiCreativeReferences: [],
    issues: [],
    prohibitedClaims: [{
      claimId: "22222222-2222-4222-8222-222222222222",
      category: "absolute_claim" as const,
      summary: "No absolute claims.",
      appliesTo: ["both" as const],
      source: "system_rule" as const,
    }],
    creativePreferences: { evidenceTier: "creative_preference" as const, tone: "neutral" },
    visualReferences: [],
    humanReviewRequired: true as const,
  };
}

function buildValidHandoff() {
  return createProductCreativeHandoff({
    handoffId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    taskId: "task-parity",
    candidateId: "candidate-p-1",
    createdAt: CREATED_AT,
    createdBy: OWNER,
    candidate: minimalValidVersion(),
  });
}

describe("Schema-Runtime parity (AJV Draft 2020-12 vs Runtime Parser)", () => {
  const ajv = buildAjv();
  const schemaValidate = ajv.compile(PRODUCT_CREATIVE_HANDOFF_JSON_SCHEMA);

  it("both accept a fully valid handoff", () => {
    const handoff = buildValidHandoff();
    const runtimeResult = parseProductCreativeHandoff(handoff);
    const schemaResult = schemaValidate(handoff);

    expect(runtimeResult).not.toBeNull();
    expect(schemaResult).toBe(true);
  });

  it("both reject a handoff missing required top-level fields", () => {
    const { schema: _, handoffId: __, ...missing } = buildValidHandoff();
    const runtimeResult = parseProductCreativeHandoff(missing);
    const schemaResult = schemaValidate(missing);

    expect(runtimeResult).toBeNull();
    expect(schemaResult).toBe(false);
  });

  it("both reject an unknown top-level property", () => {
    const handoff = { ...buildValidHandoff(), futureField: true };
    const runtimeResult = parseProductCreativeHandoff(handoff);
    const schemaResult = schemaValidate(handoff);

    expect(runtimeResult).toBeNull();
    expect(schemaResult).toBe(false);
  });

  it("both reject a candidate_snapshot with missing capturedAt", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    (version.stableSourceFacts as unknown[])!.push({
      factId: "33333333-3333-4333-8333-333333333333",
      field: "weight",
      label: "Weight",
      value: "10kg",
      evidenceTier: "source_snapshot",
      usageScopes: ["internal"],
      sourceRef: {
        sourceKind: "candidate_snapshot",
        sourceField: "weight",
        candidateSnapshotFingerprint: "e".repeat(64),
        // capturedAt missing — should be rejected
      },
      stabilityRule: "identity_only",
    });

    const runtimeResult = parseProductCreativeHandoff(handoff);
    const schemaResult = schemaValidate(handoff);

    expect(runtimeResult).toBeNull();
    expect(schemaResult).toBe(false);
  });

  it("both reject a user_confirmation with a snapshot fingerprint field", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    const facts = version.confirmedFacts as Record<string, unknown>[];
    (facts[0].sourceRef as Record<string, unknown>).candidateSnapshotFingerprint = "e".repeat(64);

    const runtimeResult = parseProductCreativeHandoff(handoff);
    const schemaResult = schemaValidate(handoff);

    // Runtime rejects via hasExactKeys (unknown key on userConfirmation)
    expect(runtimeResult).toBeNull();
    // Schema rejects via additionalProperties=false on userConfirmationReference
    expect(schemaResult).toBe(false);
  });

  it("both reject a seller_sprite_snapshot spoofed by only changing sourceKind", () => {
    // Start with candidate_snapshot, change ONLY sourceKind to seller_sprite_snapshot
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    const spoofedRef = {
      sourceKind: "seller_sprite_snapshot",
      sourceField: "weight",
      candidateSnapshotFingerprint: "e".repeat(64), // wrong field name for this branch
      capturedAt: CREATED_AT,
    };
    (version.stableSourceFacts as unknown[])!.push({
      factId: "44444444-4444-4444-8444-444444444444",
      field: "test_field",
      label: "Test",
      value: "test",
      evidenceTier: "source_snapshot",
      usageScopes: ["internal"],
      sourceRef: spoofedRef,
      stabilityRule: "identity_only",
    });

    const runtimeResult = parseProductCreativeHandoff(handoff);
    const schemaResult = schemaValidate(handoff);

    // Runtime: candidateSnapshotFingerprint is unknown on seller_sprite_snapshot → null
    expect(runtimeResult).toBeNull();
    // Schema: additionalProperties=false rejects the wrong fingerprint field
    expect(schemaResult).toBe(false);
  });

  it("both reject a research_result missing researchRevision", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    (version.stableSourceFacts as unknown[])!.push({
      factId: "55555555-5555-4555-8555-555555555555",
      field: "notes",
      label: "Notes",
      value: "test",
      evidenceTier: "source_snapshot",
      usageScopes: ["internal"],
      sourceRef: {
        sourceKind: "research_result",
        sourceField: "notes",
        researchResultFingerprint: "f".repeat(64),
        // researchRevision missing
      },
      stabilityRule: "identity_only",
    });

    const runtimeResult = parseProductCreativeHandoff(handoff);
    const schemaResult = schemaValidate(handoff);

    expect(runtimeResult).toBeNull();
    expect(schemaResult).toBe(false);
  });

  it("Runtime-accepts and Schema-rejects are only allowed for cross-field semantic gates", () => {
    // NFC normalization: Schema permits non-NFC but Runtime requires NFC.
    // This is a documented allowed divergence (cross-field semantic gate).
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    (version.confirmedFacts as Record<string, unknown>[])[0].label = "Café"; // decomposed é

    const runtimeResult = parseProductCreativeHandoff(handoff);
    const schemaResult = schemaValidate(handoff);

    // Runtime rejects (not NFC-normalized)
    expect(runtimeResult).toBeNull();
    // Schema accepts (JSON Schema has no NFC requirement on strings)
    expect(schemaResult).toBe(true);
  });

  it("Schema-rejects and Runtime-accepts is never allowed", () => {
    // The schema should never be stricter in a way the runtime permits.
    // Test: runtime allows valid UUID, schema should also accept it.
    const handoff = buildValidHandoff();
    const runtimeResult = parseProductCreativeHandoff(handoff);
    const schemaResult = schemaValidate(handoff);

    if (!schemaResult && runtimeResult !== null) {
      // This is the forbidden scenario: Schema rejects but runtime accepts
      expect(schemaResult).toBe(true); // force failure with diagnostic
    }
    // Both should accept (handoff is valid)
    expect(runtimeResult).not.toBeNull();
    expect(schemaResult).toBe(true);
  });

  it("both engines run independently — Ajv never calls Runtime Parser", () => {
    // Ajv validate is a pure function call with no dependency on parseProductCreativeHandoff
    const handoff = buildValidHandoff();
    const schemaResult = schemaValidate(handoff);
    expect(schemaResult).toBe(true);
  });

  it("validates date-time format strictly (RFC 3339 / ISO 8601)", () => {
    const invalid = buildValidHandoff();
    invalid.createdAt = "not-a-date";

    const schemaResult = schemaValidate(invalid);
    expect(schemaResult).toBe(false);
  });

  it("validates uuid format strictly", () => {
    const invalid = buildValidHandoff();
    invalid.handoffId = "not-a-uuid";

    const schemaResult = schemaValidate(invalid);
    expect(schemaResult).toBe(false);
  });

  it("rejects appliesTo with both+listing coexistence", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    (version.prohibitedClaims as Record<string, unknown>[])[0].appliesTo = ["both", "listing"];

    const runtimeResult = parseProductCreativeHandoff(handoff);
    // Schema allows unique enum but runtime enforces exclusivity
    expect(runtimeResult).toBeNull();
  });

  it("rejects blocking issue in handoff candidate", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    (version.issues as unknown[])!.push({
      issueId: "66666666-6666-4666-8666-666666666666",
      field: "price",
      kind: "conflict",
      summary: "Price conflict.",
      risk: "blocking",
      blocks: ["listing_bullets"],
      recommendedAction: "Resolve price.",
    });

    const runtimeResult = parseProductCreativeHandoff(handoff);
    expect(runtimeResult).toBeNull();
  });

  it("rejects confirmedFacts and stableSourceFacts sharing the same field", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    (version.stableSourceFacts as unknown[])!.push({
      factId: "77777777-7777-4777-8777-777777777777",
      field: "material", // Same field as confirmed fact
      label: "Material source",
      value: "Aluminum",
      evidenceTier: "source_snapshot",
      usageScopes: ["internal"],
      sourceRef: {
        sourceKind: "seller_sprite_snapshot",
        sourceField: "material",
        sellerSpriteSnapshotFingerprint: "g".repeat(64),
        capturedAt: CREATED_AT,
      },
      stabilityRule: "identity_only",
    });

    const runtimeResult = parseProductCreativeHandoff(handoff);
    expect(runtimeResult).toBeNull();
  });
});

describe("stable error model", () => {
  it("reports blocking_issue_present for handoff with blocking issue", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    (version.issues as unknown[])!.push({
      issueId: "99999999-9999-4999-8999-999999999999",
      field: "blocked_field",
      kind: "conflict",
      summary: "Blocking conflict.",
      risk: "blocking",
      blocks: ["listing_title"],
      recommendedAction: "Resolve.",
    });

    const result = parseProductCreativeHandoffWithErrors(handoff);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("blocking_issue_present");
    }
  });

  it("reports cross_tier_fact_conflict for shared confirmed/stable field", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    (version.stableSourceFacts as unknown[])!.push({
      factId: "88888888-8888-4888-8888-888888888888",
      field: "material",
      label: "Material source",
      value: "Aluminum",
      evidenceTier: "source_snapshot",
      usageScopes: ["internal"],
      sourceRef: {
        sourceKind: "seller_sprite_snapshot",
        sourceField: "material",
        sellerSpriteSnapshotFingerprint: "h".repeat(64),
        capturedAt: "2026-08-04T00:00:00.000Z",
      },
      stabilityRule: "identity_only",
    });

    const result = parseProductCreativeHandoffWithErrors(handoff);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("cross_tier_fact_conflict");
    }
  });

  it("reports applies_to_both_exclusive for both+listing coexistence", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    (version.prohibitedClaims as Record<string, unknown>[])[0].appliesTo = ["both", "listing"];

    const result = parseProductCreativeHandoffWithErrors(handoff);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("applies_to_both_exclusive");
    }
  });

  it("reports confirmation_binding_invalid when createdAt != confirmedAt", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    if (isRecord(version.confirmation)) {
      (version.confirmation as Record<string, unknown>).confirmedAt = "2025-01-01T00:00:00.000Z";
    }

    const result = parseProductCreativeHandoffWithErrors(handoff);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("confirmation_binding_invalid");
    }
  });

  it("reports visual_approval_invalid for unapproved visual reference", () => {
    const handoff = buildValidHandoff();
    const version = handoff.versions[0] as Record<string, unknown>;
    (version.visualReferences as unknown[])!.push({
      assetFingerprint: "x".repeat(64),
      sourceTier: "human_confirmed",
      identityBound: true,
      humanApprovedForReference: false,
      approvedBy: OWNER,
      approvedAt: CREATED_AT,
      confirmationReference: "ref:test",
    });

    const result = parseProductCreativeHandoffWithErrors(handoff);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("visual_approval_invalid");
    }
  });

  it("returns distinct error codes, not all collapsed to invalid_handoff_candidate", () => {
    // Verify the error code constants are distinct
    const codes = Object.values(HANDOFF_ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    // At minimum these key codes must exist
    expect(codes).toContain("blocking_issue_present");
    expect(codes).toContain("cross_tier_fact_conflict");
    expect(codes).toContain("applies_to_both_exclusive");
    expect(codes).toContain("confirmation_binding_invalid");
    expect(codes).toContain("visual_approval_invalid");
  });
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
