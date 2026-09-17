import { createHash } from "node:crypto";
import type {
  ProductCreativeHandoffConfirmedFact,
  ProductCreativeHandoffInternalActor,
  ProductCreativeHandoffAmazonConfirmationOrigin,
} from "@/lib/productCreativeHandoff";
import type { AmazonFactCandidateV1 } from "./contract";

function uuidV4FromSeed(seed: string): string {
  const hex = createHash("sha256").update(`amazon-confirmed-fact-v1:${seed}`, "utf8").digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export function confirmSelectedAmazonProductFacts(input: {
  candidates: AmazonFactCandidateV1[];
  actor: ProductCreativeHandoffInternalActor;
  confirmedAt: string;
  confirmationReference: string;
}): ProductCreativeHandoffConfirmedFact[] {
  const fields = new Set<string>();
  for (const candidate of input.candidates) {
    if (fields.has(candidate.field)) throw new Error("amazon_enrichment_duplicate_field_selection");
    if (candidate.conflict) throw new Error("amazon_enrichment_selection_invalid");
    fields.add(candidate.field);
  }
  return input.candidates.map((candidate) => {
    const origin: ProductCreativeHandoffAmazonConfirmationOrigin = {
      kind: "amazon_fact_enrichment",
      asin: candidate.asin,
      capturedAt: candidate.createdAt,
      sources: candidate.sources.slice(0, 5).map((source) => ({
        sourceUrl: source.sourceUrl,
        sourceSection: source.section,
        sourceLabel: source.label,
        sourceBlockId: source.sourceBlockId,
        evidenceText: source.text,
      })),
    };
    return {
      factId: uuidV4FromSeed(`${candidate.taskId}:${candidate.asin}:${candidate.field}:${candidate.value}:${input.confirmedAt}`),
      field: candidate.field,
      label: candidate.field,
      value: candidate.value,
      evidenceTier: "human_confirmed" as const,
      usageScopes: ["internal", "listing", "image"] as Array<"internal" | "listing" | "image">,
      sourceRef: {
        sourceKind: "user_confirmation" as const,
        sourceField: candidate.field,
        confirmedBy: input.actor,
        confirmedAt: input.confirmedAt,
        confirmationReference: input.confirmationReference,
        origin,
      },
      confirmedAt: input.confirmedAt,
      confirmedBy: input.actor,
    };
  });
}
