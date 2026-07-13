import { createHmac, timingSafeEqual } from "crypto";
import type { SourceEvidenceSourceType } from "@/lib/sourceEvidenceContract";
import { getAccessPassword } from "@/lib/server/accessPassword";

export type SourceProofPayload = {
  v: 1;
  subject: string;
  evidenceHash: string;
  assessmentHash: string;
  sourceType: SourceEvidenceSourceType;
  issuedAt: string;
  expiresAt: string;
};

export type SourceProofBindings = Pick<
  SourceProofPayload,
  "subject" | "evidenceHash" | "assessmentHash" | "sourceType"
>;

export type VerifiedSourceProof =
  | { ok: true; payload: SourceProofPayload }
  | {
      ok: false;
      reason:
        | "missing_key"
        | "malformed"
        | "invalid_signature"
        | "invalid_payload"
        | "expired"
        | "subject_mismatch"
        | "binding_mismatch";
    };

const SOURCE_PROOF_PREFIX = "sourceproof_v1.";
const SOURCE_PROOF_TTL_MS = 2 * 60 * 60 * 1000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SUBJECT_PATTERN = /^(owner|demo:[a-zA-Z0-9_-]{1,120})$/;
const BASE64URL_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SOURCE_TYPES = new Set<SourceEvidenceSourceType>(["html", "rss", "sitemap", "json", "manual"]);

function getSigningKey(): Buffer | null {
  const password = getAccessPassword();
  if (!password) return null;
  return createHmac("sha256", "qx-agent-source-proof-v1")
    .update(password)
    .digest();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isValidSubject(value: unknown): value is string {
  return typeof value === "string" && SUBJECT_PATTERN.test(value);
}

function isValidPayload(value: unknown): value is SourceProofPayload {
  if (!isRecord(value)) return false;
  if (value.v !== 1
    || !isValidSubject(value.subject)
    || typeof value.evidenceHash !== "string"
    || !HASH_PATTERN.test(value.evidenceHash)
    || typeof value.assessmentHash !== "string"
    || !HASH_PATTERN.test(value.assessmentHash)
    || typeof value.sourceType !== "string"
    || !SOURCE_TYPES.has(value.sourceType as SourceEvidenceSourceType)
    || !isCanonicalIsoTime(value.issuedAt)
    || !isCanonicalIsoTime(value.expiresAt)) {
    return false;
  }
  return Date.parse(value.expiresAt) > Date.parse(value.issuedAt);
}

function normalizeBindings(input: SourceProofBindings): SourceProofBindings | null {
  if (typeof input.evidenceHash !== "string"
    || typeof input.assessmentHash !== "string"
    || typeof input.sourceType !== "string") {
    return null;
  }
  const evidenceHash = input.evidenceHash.toLowerCase();
  const assessmentHash = input.assessmentHash.toLowerCase();
  if (!isValidSubject(input.subject)
    || !HASH_PATTERN.test(evidenceHash)
    || !HASH_PATTERN.test(assessmentHash)
    || !SOURCE_TYPES.has(input.sourceType)) {
    return null;
  }
  return {
    subject: input.subject,
    evidenceHash,
    assessmentHash,
    sourceType: input.sourceType,
  };
}

export function buildSourceProofSubject(
  context: { mode: "owner" } | { mode: "demo"; demoAccessId: string },
): string {
  const subject = context.mode === "owner" ? "owner" : `demo:${context.demoAccessId}`;
  if (!isValidSubject(subject)) throw new Error("SOURCE_PROOF_SUBJECT_INVALID");
  return subject;
}

export function createSourceProof(input: SourceProofBindings & { now?: number }): string {
  const key = getSigningKey();
  if (!key) throw new Error("SOURCE_PROOF_KEY_MISSING");
  const bindings = normalizeBindings(input);
  if (!bindings) throw new Error("SOURCE_PROOF_BINDINGS_INVALID");

  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now)) throw new Error("SOURCE_PROOF_TIME_INVALID");
  const payload: SourceProofPayload = {
    v: 1,
    ...bindings,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SOURCE_PROOF_TTL_MS).toISOString(),
  };
  if (!isValidPayload(payload)) throw new Error("SOURCE_PROOF_PAYLOAD_INVALID");

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(encodedPayload).digest("base64url");
  return `${SOURCE_PROOF_PREFIX}${encodedPayload}.${signature}`;
}

export function verifySourceProof(
  token: unknown,
  expectedBindings: SourceProofBindings,
  now = Date.now(),
): VerifiedSourceProof {
  const key = getSigningKey();
  if (!key) return { ok: false, reason: "missing_key" };
  if (typeof token !== "string" || token.length > 4096 || !token.startsWith(SOURCE_PROOF_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }

  const tokenBody = token.slice(SOURCE_PROOF_PREFIX.length);
  const separator = tokenBody.lastIndexOf(".");
  if (separator <= 0 || separator === tokenBody.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const encodedPayload = tokenBody.slice(0, separator);
  const encodedSignature = tokenBody.slice(separator + 1);
  if (!BASE64URL_PATTERN.test(encodedPayload) || !BASE64URL_PATTERN.test(encodedSignature)) {
    return { ok: false, reason: "malformed" };
  }

  const providedSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = createHmac("sha256", key).update(encodedPayload).digest();
  if (providedSignature.length !== expectedSignature.length
    || !timingSafeEqual(providedSignature, expectedSignature)) {
    return { ok: false, reason: "invalid_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isValidPayload(payload)) return { ok: false, reason: "invalid_payload" };
  if (!Number.isSafeInteger(now)) return { ok: false, reason: "invalid_payload" };
  if (now >= Date.parse(payload.expiresAt)) return { ok: false, reason: "expired" };

  const expected = normalizeBindings(expectedBindings);
  if (!expected) return { ok: false, reason: "invalid_payload" };
  if (payload.subject !== expected.subject) return { ok: false, reason: "subject_mismatch" };
  if (payload.evidenceHash !== expected.evidenceHash
    || payload.assessmentHash !== expected.assessmentHash
    || payload.sourceType !== expected.sourceType) {
    return { ok: false, reason: "binding_mismatch" };
  }

  return { ok: true, payload };
}
