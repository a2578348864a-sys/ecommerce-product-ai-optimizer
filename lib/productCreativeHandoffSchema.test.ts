import { describe, expect, it } from "vitest";
import vectors from "@/lib/fixtures/product-creative-handoff-golden-vectors.json";
import { createProductCreativeHandoff, type ProductCreativeHandoffCandidate } from "@/lib/productCreativeHandoff";
import {
  PRODUCT_CREATIVE_HANDOFF_JSON_SCHEMA,
  validateProductCreativeHandoffSchema,
} from "@/lib/productCreativeHandoffSchema";

function validHandoff() {
  return createProductCreativeHandoff({
    handoffId: "88888888-8888-4888-8888-888888888888",
    taskId: "task-schema-1",
    candidateId: "candidate-golden-1",
    createdAt: "2026-08-04T00:00:00.000Z",
    createdBy: { mode: "owner", subjectFingerprint: "1".repeat(16) },
    candidate: structuredClone(vectors.vectors[0].candidate) as ProductCreativeHandoffCandidate,
  });
}

describe("product-creative-handoff.v1 JSON Schema boundary", () => {
  it("publishes a strict Draft 2020-12 schema for the frozen contract", () => {
    expect(PRODUCT_CREATIVE_HANDOFF_JSON_SCHEMA).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:qingxuan:product-creative-handoff:v1",
      additionalProperties: false,
      properties: {
        schema: { const: "product-creative-handoff.v1" },
        researchMode: { const: "market_research_only" },
        promotionEligible: { const: false },
        versions: { maxItems: 10 },
      },
    });
  });

  it("validates the full stored object through the strict deterministic parser", () => {
    expect(validateProductCreativeHandoffSchema(validHandoff())).toEqual({ valid: true, errors: [] });
    expect(validateProductCreativeHandoffSchema({ ...validHandoff(), unknown: true })).toEqual({
      valid: false,
      errors: ["invalid_product_creative_handoff"],
    });

    const nestedUnknown = validHandoff();
    (nestedUnknown.versions[0].confirmedFacts[0].sourceRef as unknown as Record<string, unknown>).unknown = true;
    expect(validateProductCreativeHandoffSchema(nestedUnknown)).toEqual({
      valid: false,
      errors: ["invalid_product_creative_handoff"],
    });
  });

  it("keeps every object definition closed to unknown properties", () => {
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const schema = value as Record<string, unknown>;
      if (schema.type === "object") expect(schema.additionalProperties).toBe(false);
      Object.values(schema).forEach(visit);
    };

    visit(PRODUCT_CREATIVE_HANDOFF_JSON_SCHEMA);
  });

  it("uses discriminated sourceReference definitions instead of requiring a fake snapshot hash", () => {
    const definitions = PRODUCT_CREATIVE_HANDOFF_JSON_SCHEMA.$defs;
    expect(definitions.snapshotSourceReference.required).toContain("sourceSnapshotFingerprint");
    expect(definitions.userConfirmationReference.required).toEqual(expect.arrayContaining([
      "confirmedBy",
      "confirmedAt",
      "confirmationReference",
    ]));
    expect(definitions.userConfirmationReference.properties).not.toHaveProperty("sourceSnapshotFingerprint");
  });
});
