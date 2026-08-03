import { describe, expect, it } from "vitest";
import {
  PRODUCT_RESEARCH_HASH_FINGERPRINT_LENGTH,
  sanitizeProductResearchRecordForBrowser,
  sanitizeProductResearchResultForBrowser,
  toResearchHashFingerprint,
} from "@/lib/productResearchPublicDto";

describe("product research browser DTO", () => {
  it("replaces every full research hash with a 12-character fingerprint", () => {
    const fullHash = "a".repeat(64);
    const result = sanitizeProductResearchResultForBrowser({
      unknownNamespace: { keep: true },
      researchRecord: {
        schema: "product-research-record.v1",
        researchHash: fullHash,
        latestDecision: { revision: 2, researchHash: fullHash },
        decisionEvents: [
          { revision: 1, researchHash: fullHash },
          { revision: 2, researchHash: fullHash },
        ],
      },
    }) as Record<string, any>;

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(fullHash);
    expect(result.unknownNamespace).toEqual({ keep: true });
    expect(result.researchRecord).not.toHaveProperty("researchHash");
    expect(result.researchRecord.researchHashFingerprint).toBe("a".repeat(12));
    expect(result.researchRecord.latestDecision.researchHashFingerprint).toBe("a".repeat(12));
    expect(result.researchRecord.decisionEvents[0].researchHashFingerprint).toBe("a".repeat(12));
  });

  it("never invents a fingerprint for invalid or absent hashes", () => {
    expect(toResearchHashFingerprint("not-a-hash")).toBeNull();
    expect(toResearchHashFingerprint(null)).toBeNull();
    expect(sanitizeProductResearchRecordForBrowser({ researchHash: "z".repeat(64) }))
      .toEqual({});
    expect(PRODUCT_RESEARCH_HASH_FINGERPRINT_LENGTH).toBe(12);
  });
});
