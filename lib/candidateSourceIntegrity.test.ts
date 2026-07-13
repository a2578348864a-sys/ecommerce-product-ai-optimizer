import { describe, expect, it } from "vitest";
import {
  CandidateSourcePolicyError,
  assertCandidateSourceUpdateAllowed,
  getCandidateSourceIntegrity,
  inspectStoredCandidateSourceMeta,
  requiresCandidateSourceReview,
} from "@/lib/candidateSourceIntegrity";

const HASH = "a".repeat(64);

function signedMeta(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: "candidate-source-meta-v2",
    integrity: "signed_source_v2",
    evidenceHash: HASH,
    sourceEvidence: {
      version: "candidate-source-v2",
      origin: "public_url",
      sourceType: "html",
    },
    proof: {
      issuedAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2026-07-12T02:00:00.000Z",
      sourceType: "html",
    },
    ...overrides,
  });
}

describe("Candidate source integrity", () => {
  it("recognizes only a complete server-generated signed public wrapper", () => {
    expect(inspectStoredCandidateSourceMeta(signedMeta())).toEqual({
      sourceIntegrity: "verified_public",
      evidenceHash: HASH,
    });
    expect(getCandidateSourceIntegrity(signedMeta())).toBe("verified_public");
  });

  it.each([
    ["legacy", JSON.stringify({ version: "candidate-source-meta-v2", integrity: "legacy_unverified" })],
    ["empty", "{}"],
    ["corrupt", "{bad json"],
    ["unknown version", signedMeta({ version: "candidate-source-meta-v9" })],
    ["missing Evidence", signedMeta({ sourceEvidence: null })],
    ["missing proof metadata", signedMeta({ proof: null })],
    ["wrong proof source type", signedMeta({ proof: { issuedAt: "2026-07-12T00:00:00.000Z", expiresAt: "2026-07-12T02:00:00.000Z", sourceType: "rss" } })],
    ["manual origin", signedMeta({ sourceEvidence: { version: "candidate-source-v2", origin: "manual", sourceType: "manual" }, proof: { issuedAt: "2026-07-12T00:00:00.000Z", expiresAt: "2026-07-12T02:00:00.000Z", sourceType: "manual" } })],
  ])("fails closed for %s metadata", (_label, value) => {
    expect(inspectStoredCandidateSourceMeta(value)).toEqual({ sourceIntegrity: "unverified" });
  });

  it("requires strict acknowledgement only when unverified enters a ready state", () => {
    expect(requiresCandidateSourceReview("unverified", "pending", "worth_analyzing")).toBe(true);
    expect(requiresCandidateSourceReview("unverified", "paused", "analyzed")).toBe(true);
    expect(requiresCandidateSourceReview("verified_public", "pending", "worth_analyzing")).toBe(false);
    expect(requiresCandidateSourceReview("unverified", "worth_analyzing", "analyzed")).toBe(false);
    expect(requiresCandidateSourceReview("unverified", "analyzed", "pending")).toBe(false);
  });

  it.each([undefined, false, "true", 1])("rejects unverified ready transition acknowledgement %j", (acknowledgement) => {
    expect(() => assertCandidateSourceUpdateAllowed({
      sourceMetaJson: JSON.stringify({ integrity: "legacy_unverified" }),
      currentStatus: "pending",
      targetStatus: "worth_analyzing",
      sourceReviewAcknowledged: acknowledgement,
      requestedFields: ["status"],
    })).toThrowError(expect.objectContaining({ code: "source_review_required" }));
  });

  it("accepts strict true without upgrading unverified source integrity", () => {
    expect(assertCandidateSourceUpdateAllowed({
      sourceMetaJson: JSON.stringify({ integrity: "legacy_unverified" }),
      currentStatus: "pending",
      targetStatus: "worth_analyzing",
      sourceReviewAcknowledged: true,
      requestedFields: ["status", "sourceReviewAcknowledged"],
    })).toBe("unverified");
  });

  it.each(["name", "rawInput", "link", "score", "source", "keyword", "riskLevel", "riskLabel", "summaryLabel", "sourceMetaJson", "analysisJson"])(
    "locks signed source-derived field %s",
    (field) => {
      expect(() => assertCandidateSourceUpdateAllowed({
        sourceMetaJson: signedMeta(),
        currentStatus: "pending",
        targetStatus: "pending",
        sourceReviewAcknowledged: undefined,
        requestedFields: [field],
      })).toThrowError(expect.objectContaining({ code: "verified_source_fields_locked" }));
    },
  );

  it("keeps signed manual workflow fields writable", () => {
    expect(assertCandidateSourceUpdateAllowed({
      sourceMetaJson: signedMeta(),
      currentStatus: "pending",
      targetStatus: "worth_analyzing",
      sourceReviewAcknowledged: undefined,
      requestedFields: ["status", "convertedTaskId", "lastActionAt"],
    })).toBe("verified_public");
  });

  it("requires review when the full Evidence/Assessment chain degrades but keeps signed fields locked", () => {
    expect(() => assertCandidateSourceUpdateAllowed({
      sourceMetaJson: signedMeta(),
      reviewIntegrity: "unverified",
      currentStatus: "pending",
      targetStatus: "worth_analyzing",
      requestedFields: ["status"],
    })).toThrowError(expect.objectContaining({ code: "source_review_required" }));

    expect(() => assertCandidateSourceUpdateAllowed({
      sourceMetaJson: signedMeta(),
      reviewIntegrity: "unverified",
      currentStatus: "pending",
      targetStatus: "pending",
      requestedFields: ["score"],
    })).toThrowError(expect.objectContaining({ code: "verified_source_fields_locked" }));
  });

  it("uses a structured policy error", () => {
    try {
      assertCandidateSourceUpdateAllowed({
        sourceMetaJson: signedMeta(),
        currentStatus: "pending",
        requestedFields: ["score"],
      });
      throw new Error("expected policy error");
    } catch (error) {
      expect(error).toBeInstanceOf(CandidateSourcePolicyError);
    }
  });
});
