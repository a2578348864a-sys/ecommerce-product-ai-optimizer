import { createHash } from "crypto";

export type SourceEvidenceOrigin = "public_url" | "manual";
export type SourceEvidenceSourceType = "html" | "rss" | "sitemap" | "json" | "manual";
export type SourceEvidenceTransportSecurity = "https" | "http" | "manual";
export type SourceEvidenceRetrievalStatus = "retrieved" | "manual";
export type SourceEvidenceRobotsStatus = "allowed" | "not_present" | "manual";
export type SourceEvidenceRelation = "document" | "document_item" | "manual";

export type SourceEvidenceV2 = {
  version: "candidate-source-v2";
  evidenceId: string;
  origin: SourceEvidenceOrigin;
  capturedAt: string;
  submittedUrl: string | null;
  finalUrl: string | null;
  candidateUrl: string | null;
  sourceRelation: SourceEvidenceRelation;
  sourceHost: string | null;
  sourceType: SourceEvidenceSourceType;
  transportSecurity: SourceEvidenceTransportSecurity;
  retrieval: {
    status: SourceEvidenceRetrievalStatus;
    httpStatus: number | null;
    contentType: string | null;
    robots: SourceEvidenceRobotsStatus;
    redirectCount: number | null;
  };
  observations: {
    title: string;
    categoryHint: string | null;
    signalText: string | null;
    priceText: string | null;
    hasImage: boolean | null;
  };
  extractionSignals: string[];
};

export type SourceEvidenceV2Input = {
  version: "candidate-source-v2";
  evidenceId: string;
  origin: SourceEvidenceOrigin;
  capturedAt: string;
  submittedUrl?: string | null;
  finalUrl?: string | null;
  candidateUrl: string | null;
  sourceRelation: SourceEvidenceRelation;
  sourceHost?: string | null;
  sourceType: SourceEvidenceSourceType;
  transportSecurity: SourceEvidenceTransportSecurity;
  retrieval: {
    status: SourceEvidenceRetrievalStatus;
    httpStatus?: number | null;
    contentType?: string | null;
    robots: SourceEvidenceRobotsStatus;
    redirectCount?: number | null;
  };
  observations: {
    title: string;
    categoryHint?: string | null;
    signalText?: string | null;
    priceText?: string | null;
    hasImage?: boolean | null;
  };
  extractionSignals?: string[] | null;
};

export type RuleAssessmentQueueSuggestion = "review" | "watch" | "reject";

export type RuleAssessmentV1 = {
  version: "candidate-rule-v1";
  algorithm: string;
  evidenceHash: string;
  computedAt: string;
  candidateType: string;
  scores: {
    demandSignal: number;
    supplyEase: number;
    risk: number;
    beginnerFit: number;
    final: number;
  };
  riskFlags: string[];
  reasons: string[];
  queueSuggestion: RuleAssessmentQueueSuggestion;
};

export type RuleAssessmentV1Input = {
  version: "candidate-rule-v1";
  algorithm: string;
  evidenceHash: string;
  computedAt: string;
  candidateType: string;
  scores: RuleAssessmentV1["scores"];
  riskFlags?: string[] | null;
  reasons?: string[] | null;
  queueSuggestion: RuleAssessmentQueueSuggestion;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const SENSITIVE_QUERY_KEY = /^(?:auth|authentication|authorization|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|session|session[_-]?id|cookie|signature|credential|.*[_-](?:password|secret|token|api[_-]?key|session|signature))$/i;
const TRACKING_QUERY_KEY = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref_src|ref_url)$/i;
const SOURCE_ORIGINS = new Set<SourceEvidenceOrigin>(["public_url", "manual"]);
const SOURCE_TYPES = new Set<SourceEvidenceSourceType>(["html", "rss", "sitemap", "json", "manual"]);
const TRANSPORT_SECURITY_VALUES = new Set<SourceEvidenceTransportSecurity>(["https", "http", "manual"]);
const RETRIEVAL_STATUSES = new Set<SourceEvidenceRetrievalStatus>(["retrieved", "manual"]);
const ROBOTS_STATUSES = new Set<SourceEvidenceRobotsStatus>(["allowed", "not_present", "manual"]);
const SOURCE_RELATIONS = new Set<SourceEvidenceRelation>(["document", "document_item", "manual"]);
const QUEUE_SUGGESTIONS = new Set<RuleAssessmentQueueSuggestion>(["review", "watch", "reject"]);

function normalizeText(value: unknown, field: string, maxLength: number, required: true): string;
function normalizeText(value: unknown, field: string, maxLength: number, required?: false): string | null;
function normalizeText(value: unknown, field: string, maxLength: number, required = false): string | null {
  if (value === null || value === undefined) {
    if (required) throw new Error(`${field.toUpperCase()}_REQUIRED`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${field.toUpperCase()}_INVALID`);
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!normalized) {
    if (required) throw new Error(`${field.toUpperCase()}_REQUIRED`);
    return null;
  }
  if (normalized.length > maxLength) throw new Error(`${field.toUpperCase()}_TOO_LONG`);
  return normalized;
}

function normalizeIsoTime(value: unknown, field: string): string {
  const text = normalizeText(value, field, 64, true);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) throw new Error(`${field.toUpperCase()}_INVALID`);
  return new Date(milliseconds).toISOString();
}

function normalizeInteger(
  value: unknown,
  field: string,
  options: { min: number; max: number; nullable?: boolean },
): number | null {
  if ((value === null || value === undefined) && options.nullable) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${field.toUpperCase()}_INVALID`);
  }
  if (value < options.min || value > options.max) throw new Error(`${field.toUpperCase()}_OUT_OF_RANGE`);
  return value;
}

function normalizeScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field.toUpperCase()}_INVALID`);
  }
  if (value < 0 || value > 100) throw new Error(`${field.toUpperCase()}_OUT_OF_RANGE`);
  return Object.is(value, -0) ? 0 : value;
}

function deterministicCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeStringSet(
  value: unknown,
  field: string,
  options: { maxItems: number; maxItemLength: number },
): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field.toUpperCase()}_INVALID`);
  const normalized = value.map((item, index) =>
    normalizeText(item, `${field}_${index}`, options.maxItemLength, true));
  const unique = [...new Set(normalized)].sort(deterministicCompare);
  if (unique.length > options.maxItems) throw new Error(`${field.toUpperCase()}_TOO_MANY`);
  return unique;
}

function normalizeSourceUrl(value: unknown, field: string): string | null {
  const raw = normalizeText(value, field, 2048);
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${field.toUpperCase()}_INVALID`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${field.toUpperCase()}_UNSUPPORTED_PROTOCOL`);
  }
  if (url.username || url.password) throw new Error(`${field.toUpperCase()}_CREDENTIALS_FORBIDDEN`);
  if (url.port) throw new Error(`${field.toUpperCase()}_NON_STANDARD_PORT`);

  url.hash = "";
  const parameters = [...url.searchParams.entries()]
    .filter(([key]) => !SENSITIVE_QUERY_KEY.test(key) && !TRACKING_QUERY_KEY.test(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      deterministicCompare(leftKey, rightKey) || deterministicCompare(leftValue, rightValue));
  url.search = "";
  for (const [key, parameterValue] of parameters) url.searchParams.append(key, parameterValue);

  const normalized = url.toString();
  if (normalized.length > 2048) throw new Error(`${field.toUpperCase()}_TOO_LONG`);
  return normalized;
}

export function normalizeEvidenceUrl(value: unknown, field = "source_url"): string | null {
  return normalizeSourceUrl(value, field);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("CANONICAL_VALUE_INVALID");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(deterministicCompare)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("CANONICAL_VALUE_INVALID");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function normalizeSourceEvidenceV2(input: SourceEvidenceV2Input): SourceEvidenceV2 {
  if (input.version !== "candidate-source-v2") throw new Error("SOURCE_EVIDENCE_VERSION_INVALID");
  if (!SOURCE_ORIGINS.has(input.origin)) throw new Error("SOURCE_ORIGIN_INVALID");
  if (!SOURCE_TYPES.has(input.sourceType)) throw new Error("SOURCE_TYPE_INVALID");
  if (!TRANSPORT_SECURITY_VALUES.has(input.transportSecurity)) throw new Error("TRANSPORT_SECURITY_INVALID");
  if (!RETRIEVAL_STATUSES.has(input.retrieval.status)) throw new Error("RETRIEVAL_STATUS_INVALID");
  if (!ROBOTS_STATUSES.has(input.retrieval.robots)) throw new Error("ROBOTS_STATUS_INVALID");
  if (!SOURCE_RELATIONS.has(input.sourceRelation)) throw new Error("SOURCE_RELATION_INVALID");
  const evidenceId = normalizeText(input.evidenceId, "evidence_id", 120, true);
  if (!ID_PATTERN.test(evidenceId)) throw new Error("EVIDENCE_ID_INVALID");

  const submittedUrl = normalizeSourceUrl(input.submittedUrl, "submitted_url");
  const finalUrl = normalizeSourceUrl(input.finalUrl, "final_url");
  const candidateUrl = normalizeSourceUrl(input.candidateUrl, "candidate_url");
  const effectiveUrl = finalUrl ?? submittedUrl;
  const suppliedHost = normalizeText(input.sourceHost, "source_host", 253)?.toLowerCase() ?? null;
  const derivedHost = effectiveUrl ? new URL(effectiveUrl).hostname.toLowerCase() : null;
  if (suppliedHost && suppliedHost !== derivedHost) throw new Error("SOURCE_HOST_MISMATCH");

  if (input.origin === "public_url") {
    if (!submittedUrl || !finalUrl) throw new Error("PUBLIC_SOURCE_URLS_REQUIRED");
    if (input.sourceRelation !== "document" && input.sourceRelation !== "document_item") {
      throw new Error("PUBLIC_SOURCE_RELATION_INVALID");
    }
    if (input.sourceRelation === "document" && candidateUrl !== finalUrl) {
      throw new Error("DOCUMENT_CANDIDATE_URL_MISMATCH");
    }
    if (input.sourceType === "manual" || input.transportSecurity === "manual") {
      throw new Error("PUBLIC_SOURCE_MODE_INVALID");
    }
    if (input.retrieval.status !== "retrieved" || input.retrieval.robots === "manual") {
      throw new Error("PUBLIC_RETRIEVAL_MODE_INVALID");
    }
  } else if (input.origin === "manual") {
    if (submittedUrl || finalUrl || candidateUrl || suppliedHost) throw new Error("MANUAL_SOURCE_URL_FORBIDDEN");
    if (input.sourceRelation !== "manual") throw new Error("MANUAL_SOURCE_RELATION_INVALID");
    if (input.sourceType !== "manual"
      || input.transportSecurity !== "manual"
      || input.retrieval.status !== "manual"
      || input.retrieval.robots !== "manual") {
      throw new Error("MANUAL_SOURCE_MODE_INVALID");
    }
  }

  const httpStatus = normalizeInteger(input.retrieval.httpStatus, "http_status", {
    min: 100,
    max: 599,
    nullable: true,
  });
  const redirectCount = normalizeInteger(input.retrieval.redirectCount, "redirect_count", {
    min: 0,
    max: 10,
    nullable: true,
  });
  const contentType = normalizeText(input.retrieval.contentType, "content_type", 200)?.toLowerCase() ?? null;
  if (input.origin === "manual" && (httpStatus !== null || redirectCount !== null || contentType !== null)) {
    throw new Error("MANUAL_RETRIEVAL_METADATA_FORBIDDEN");
  }

  return {
    version: "candidate-source-v2",
    evidenceId,
    origin: input.origin,
    capturedAt: normalizeIsoTime(input.capturedAt, "captured_at"),
    submittedUrl,
    finalUrl,
    candidateUrl,
    sourceRelation: input.sourceRelation,
    sourceHost: derivedHost,
    sourceType: input.sourceType,
    transportSecurity: input.transportSecurity,
    retrieval: {
      status: input.retrieval.status,
      httpStatus,
      contentType,
      robots: input.retrieval.robots,
      redirectCount,
    },
    observations: {
      title: normalizeText(input.observations.title, "observation_title", 500, true),
      categoryHint: normalizeText(input.observations.categoryHint, "category_hint", 200),
      signalText: normalizeText(input.observations.signalText, "signal_text", 2_000),
      priceText: normalizeText(input.observations.priceText, "price_text", 200),
      hasImage: input.observations.hasImage === null || input.observations.hasImage === undefined
        ? null
        : typeof input.observations.hasImage === "boolean"
          ? input.observations.hasImage
          : (() => { throw new Error("HAS_IMAGE_INVALID"); })(),
    },
    extractionSignals: normalizeStringSet(input.extractionSignals, "extraction_signals", {
      maxItems: 32,
      maxItemLength: 200,
    }),
  };
}

export function createEvidenceHash(input: SourceEvidenceV2Input | SourceEvidenceV2): string {
  return sha256(normalizeSourceEvidenceV2(input));
}

export function normalizeRuleAssessmentV1(input: RuleAssessmentV1Input): RuleAssessmentV1 {
  if (input.version !== "candidate-rule-v1") throw new Error("RULE_ASSESSMENT_VERSION_INVALID");
  if (!QUEUE_SUGGESTIONS.has(input.queueSuggestion)) throw new Error("QUEUE_SUGGESTION_INVALID");
  const evidenceHash = normalizeText(input.evidenceHash, "evidence_hash", 64, true).toLowerCase();
  if (!SHA256_PATTERN.test(evidenceHash)) throw new Error("EVIDENCE_HASH_INVALID");

  return {
    version: "candidate-rule-v1",
    algorithm: normalizeText(input.algorithm, "algorithm", 80, true),
    evidenceHash,
    computedAt: normalizeIsoTime(input.computedAt, "computed_at"),
    candidateType: normalizeText(input.candidateType, "candidate_type", 80, true),
    scores: {
      demandSignal: normalizeScore(input.scores.demandSignal, "demand_signal_score"),
      supplyEase: normalizeScore(input.scores.supplyEase, "supply_ease_score"),
      risk: normalizeScore(input.scores.risk, "risk_score"),
      beginnerFit: normalizeScore(input.scores.beginnerFit, "beginner_fit_score"),
      final: normalizeScore(input.scores.final, "final_score"),
    },
    riskFlags: normalizeStringSet(input.riskFlags, "risk_flags", {
      maxItems: 32,
      maxItemLength: 120,
    }),
    reasons: normalizeStringSet(input.reasons, "reasons", {
      maxItems: 32,
      maxItemLength: 500,
    }),
    queueSuggestion: input.queueSuggestion,
  };
}

export function createAssessmentHash(input: RuleAssessmentV1Input | RuleAssessmentV1): string {
  return sha256(normalizeRuleAssessmentV1(input));
}
