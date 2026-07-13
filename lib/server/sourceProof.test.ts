import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSourceProofSubject,
  createSourceProof,
  verifySourceProof,
} from "@/lib/server/sourceProof";

const PASSWORD = "source-proof-test-password";
const EVIDENCE_HASH = "a".repeat(64);
const ASSESSMENT_HASH = "b".repeat(64);
const NOW = Date.parse("2026-07-11T00:00:00.000Z");

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", PASSWORD);
});

function createOwnerProof() {
  return createSourceProof({
    subject: "owner",
    evidenceHash: EVIDENCE_HASH,
    assessmentHash: ASSESSMENT_HASH,
    sourceType: "html",
    now: NOW,
  });
}

const ownerBindings = {
  subject: "owner",
  evidenceHash: EVIDENCE_HASH,
  assessmentHash: ASSESSMENT_HASH,
  sourceType: "html" as const,
};

describe("SourceProof", () => {
  it("issues and verifies a proof with all source trust bindings", () => {
    const verified = verifySourceProof(createOwnerProof(), ownerBindings, NOW + 1);

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload).toEqual({
      v: 1,
      subject: "owner",
      evidenceHash: EVIDENCE_HASH,
      assessmentHash: ASSESSMENT_HASH,
      sourceType: "html",
      issuedAt: "2026-07-11T00:00:00.000Z",
      expiresAt: "2026-07-11T02:00:00.000Z",
    });
  });

  it("rejects a modified token", () => {
    const proof = createOwnerProof();
    const tampered = `${proof.slice(0, -1)}${proof.endsWith("a") ? "b" : "a"}`;
    expect(verifySourceProof(tampered, ownerBindings, NOW + 1)).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("rejects an expired proof", () => {
    expect(verifySourceProof(createOwnerProof(), ownerBindings, NOW + 2 * 60 * 60 * 1000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("keeps Owner and Visitor subjects isolated", () => {
    expect(verifySourceProof(createOwnerProof(), {
      ...ownerBindings,
      subject: "demo:visitor-a",
    }, NOW + 1)).toEqual({
      ok: false,
      reason: "subject_mismatch",
    });
  });

  it("keeps Visitor A and Visitor B subjects isolated", () => {
    const proof = createSourceProof({
      ...ownerBindings,
      subject: "demo:visitor-a",
      now: NOW,
    });
    expect(verifySourceProof(proof, {
      ...ownerBindings,
      subject: "demo:visitor-b",
    }, NOW + 1)).toEqual({
      ok: false,
      reason: "subject_mismatch",
    });
  });

  it.each([
    ["evidenceHash", { evidenceHash: "c".repeat(64) }],
    ["assessmentHash", { assessmentHash: "d".repeat(64) }],
    ["sourceType", { sourceType: "rss" as const }],
  ])("rejects a mismatched %s binding", (_label, changed) => {
    expect(verifySourceProof(createOwnerProof(), {
      ...ownerBindings,
      ...changed,
    }, NOW + 1)).toEqual({
      ok: false,
      reason: "binding_mismatch",
    });
  });

  it("builds stable Owner and Visitor access subjects", () => {
    expect(buildSourceProofSubject({ mode: "owner" })).toBe("owner");
    expect(buildSourceProofSubject({ mode: "demo", demoAccessId: "visitor_01" }))
      .toBe("demo:visitor_01");
  });
});
