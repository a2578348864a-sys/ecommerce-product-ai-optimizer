export type CandidateSourceIntegrity = "verified_public" | "unverified";

export type CandidateSourcePolicyErrorCode =
  | "source_review_required"
  | "verified_source_fields_locked";

export class CandidateSourcePolicyError extends Error {
  constructor(
    public readonly code: CandidateSourcePolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CandidateSourcePolicyError";
  }
}

export type StoredCandidateSourceInspection =
  | { sourceIntegrity: "verified_public"; evidenceHash: string }
  | { sourceIntegrity: "unverified" };

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const READY_STATUSES = new Set(["worth_analyzing", "analyzed"]);
const VERIFIED_SOURCE_DERIVED_FIELDS = new Set([
  "name",
  "rawInput",
  "link",
  "score",
  "source",
  "keyword",
  "riskLevel",
  "riskLabel",
  "summaryLabel",
  "sourceMetaJson",
  "analysisJson",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function inspectStoredCandidateSourceMeta(value: unknown): StoredCandidateSourceInspection {
  if (typeof value !== "string" || !value.trim()) return { sourceIntegrity: "unverified" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { sourceIntegrity: "unverified" };
  }
  if (!isRecord(parsed)
    || parsed.version !== "candidate-source-meta-v2"
    || parsed.integrity !== "signed_source_v2"
    || typeof parsed.evidenceHash !== "string"
    || !SHA256_PATTERN.test(parsed.evidenceHash)
    || !isRecord(parsed.sourceEvidence)
    || parsed.sourceEvidence.version !== "candidate-source-v2"
    || parsed.sourceEvidence.origin !== "public_url"
    || typeof parsed.sourceEvidence.sourceType !== "string"
    || !isRecord(parsed.proof)
    || !isIsoTime(parsed.proof.issuedAt)
    || !isIsoTime(parsed.proof.expiresAt)
    || parsed.proof.sourceType !== parsed.sourceEvidence.sourceType
    || Date.parse(parsed.proof.issuedAt) > Date.parse(parsed.proof.expiresAt)) {
    return { sourceIntegrity: "unverified" };
  }

  return { sourceIntegrity: "verified_public", evidenceHash: parsed.evidenceHash };
}

export function getCandidateSourceIntegrity(value: unknown): CandidateSourceIntegrity {
  return inspectStoredCandidateSourceMeta(value).sourceIntegrity;
}

export function isCandidateReadyStatus(status: unknown): boolean {
  return typeof status === "string" && READY_STATUSES.has(status);
}

export function requiresCandidateSourceReview(
  sourceIntegrity: CandidateSourceIntegrity,
  currentStatus: unknown,
  targetStatus: unknown,
): boolean {
  return sourceIntegrity === "unverified"
    && !isCandidateReadyStatus(currentStatus)
    && isCandidateReadyStatus(targetStatus);
}

export function getVerifiedSourceLockedFields(requestedFields: readonly string[]): string[] {
  return requestedFields.filter((field) => VERIFIED_SOURCE_DERIVED_FIELDS.has(field));
}

export function assertCandidateSourceUpdateAllowed(input: {
  sourceMetaJson: unknown;
  reviewIntegrity?: CandidateSourceIntegrity;
  currentStatus: unknown;
  targetStatus?: unknown;
  sourceReviewAcknowledged?: unknown;
  requestedFields: readonly string[];
}): CandidateSourceIntegrity {
  const storedSourceIntegrity = getCandidateSourceIntegrity(input.sourceMetaJson);
  if (storedSourceIntegrity === "verified_public") {
    const lockedFields = getVerifiedSourceLockedFields(input.requestedFields);
    if (lockedFields.length > 0) {
      throw new CandidateSourcePolicyError(
        "verified_source_fields_locked",
        "已验证来源字段不能通过通用候选更新接口修改。",
      );
    }
  }

  const reviewIntegrity = input.reviewIntegrity ?? storedSourceIntegrity;
  if (requiresCandidateSourceReview(reviewIntegrity, input.currentStatus, input.targetStatus)
    && input.sourceReviewAcknowledged !== true) {
    throw new CandidateSourcePolicyError(
      "source_review_required",
      "未验证来源必须经过明确人工确认后才能进入待分析。",
    );
  }

  return reviewIntegrity;
}
