import { describe, expect, it } from "vitest";
import {
  buildListingKeywordBrief,
  parseListingKeywordBrief,
  type ListingKeywordBrief,
} from "./listingKeywordBrief";

const CAPTURED_AT = "2026-08-14T02:00:00.000Z";

describe("listing keyword brief provenance (05 contract, Phase 3/4)", () => {
  it("round-trips provenance fields through build and parse", () => {
    const built = buildListingKeywordBrief({
      primaryKeyword: "insulated water bottle",
      supportingKeywords: ["stainless steel"],
      backendSearchTerms: ["water bottle", "tumbler"],
      source: "sellersprite",
      capturedAt: CAPTURED_AT,
      reportType: "keyword_mining",
      marketplace: "amazon.com",
      month: "2026-07",
      evidenceRef: "abc123",
      reportHash: "d".repeat(64),
      asin: "B0TEST0001",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const parsed = parseListingKeywordBrief(built.brief);
    expect(parsed).toMatchObject({
      schema: "listing-keyword-brief.v1",
      primaryKeyword: "insulated water bottle",
      reportType: "keyword_mining",
      marketplace: "amazon.com",
      month: "2026-07",
      evidenceRef: "abc123",
      reportHash: "d".repeat(64),
      asin: "B0TEST0001",
    });
  });

  it("keeps legacy briefs parseable when provenance fields are missing", () => {
    const legacy = parseListingKeywordBrief({
      schema: "listing-keyword-brief.v1",
      primaryKeyword: "legacy keyword",
      supportingKeywords: [],
      backendSearchTerms: [],
      source: "manual",
      capturedAt: CAPTURED_AT,
    });
    expect(legacy).not.toBeNull();
    expect(legacy?.reportType).toBeUndefined();
    expect(legacy?.month).toBeUndefined();
  });

  it("ignores non-string provenance input (fail safe)", () => {
    const built = buildListingKeywordBrief({
      primaryKeyword: "safe keyword",
      capturedAt: CAPTURED_AT,
      reportType: 123 as unknown as string,
      asin: "B0TEST0001",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const brief = built.brief as ListingKeywordBrief;
    expect(brief.reportType).toBeUndefined();
    expect(brief.asin).toBe("B0TEST0001");
  });

  it("does not confuse capturedAt with month (data period)", () => {
    const built = buildListingKeywordBrief({
      primaryKeyword: "period keyword",
      capturedAt: CAPTURED_AT,
      month: "2026-07",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.capturedAt).toContain("2026-08-14");
    expect(built.brief.month).toBe("2026-07");
  });
});
