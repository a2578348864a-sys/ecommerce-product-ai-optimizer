import type {
  RuleAssessmentQueueSuggestion,
  RuleAssessmentV1,
  SourceEvidenceRelation,
  SourceEvidenceRobotsStatus,
  SourceEvidenceSourceType,
} from "@/lib/sourceEvidenceContract";
import { isSupportedStoredAssessmentAlgorithm } from "@/lib/ruleAssessmentPolicy";

export type CandidateEvidenceReviewFactsV1 = {
  capturedAt: string;
  sourceHost: string | null;
  sourceType: SourceEvidenceSourceType;
  sourceRelation: SourceEvidenceRelation;
  documentUrl: string;
  candidateUrl: string | null;
  openUrl: string;
  httpStatus: number | null;
  contentType: string | null;
  robots: SourceEvidenceRobotsStatus;
  redirectCount: number | null;
  title: string;
  categoryHint: string | null;
  signalText: string | null;
  priceText: string | null;
  hasImage: boolean | null;
  extractionSignals: string[];
};

export type CandidateEvidenceReviewAssessmentV1 = {
  algorithm: string;
  computedAt: string;
  candidateType: string;
  scores: RuleAssessmentV1["scores"];
  riskFlags: string[];
  reasons: string[];
  queueSuggestion: RuleAssessmentQueueSuggestion;
};

export type CandidateEvidenceReviewV1 =
  | {
      version: "candidate-evidence-review-v1";
      integrity: "verified_public";
      facts: CandidateEvidenceReviewFactsV1;
      assessment: CandidateEvidenceReviewAssessmentV1;
    }
  | {
      version: "candidate-evidence-review-v1";
      integrity: "unverified";
      reason: "legacy_or_invalid";
      openUrl?: string;
    };

const SOURCE_TYPE_LABELS: Record<SourceEvidenceSourceType, string> = {
  html: "公开网页",
  rss: "RSS",
  sitemap: "Sitemap",
  json: "公开 JSON",
  manual: "人工输入",
};

const SOURCE_RELATION_LABELS: Record<SourceEvidenceRelation, string> = {
  document: "来源页面就是商品页面",
  document_item: "商品来自来源文档中的条目",
  manual: "人工输入",
};

const QUEUE_SUGGESTION_LABELS: Record<RuleAssessmentQueueSuggestion, string> = {
  review: "建议人工复核",
  watch: "建议继续观察",
  reject: "建议暂不推进",
};

export function getEvidenceSourceTypeLabel(value: SourceEvidenceSourceType): string {
  return SOURCE_TYPE_LABELS[value];
}

export function getEvidenceSourceRelationLabel(value: SourceEvidenceRelation): string {
  return SOURCE_RELATION_LABELS[value];
}

export function getEvidenceQueueSuggestionLabel(value: RuleAssessmentQueueSuggestion): string {
  return QUEUE_SUGGESTION_LABELS[value];
}

const SOURCE_TYPES = new Set<SourceEvidenceSourceType>(["html", "rss", "sitemap", "json", "manual"]);
const SOURCE_RELATIONS = new Set<SourceEvidenceRelation>(["document", "document_item", "manual"]);
const ROBOTS_STATUSES = new Set<SourceEvidenceRobotsStatus>(["allowed", "not_present", "manual"]);
const QUEUE_SUGGESTIONS = new Set<RuleAssessmentQueueSuggestion>(["review", "watch", "reject"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:")
      || url.username
      || url.password
      || url.port) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function nullableText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  return text(value, maxLength) ?? undefined;
}

function nullableInteger(value: unknown, min: number, max: number): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

function score(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result: string[] = [];
  for (const item of value) {
    const normalized = text(item, maxLength);
    if (!normalized) return null;
    result.push(normalized);
  }
  return result;
}

function unverifiedReview(openUrl?: string): CandidateEvidenceReviewV1 {
  return {
    version: "candidate-evidence-review-v1",
    integrity: "unverified",
    reason: "legacy_or_invalid",
    ...(openUrl ? { openUrl } : {}),
  };
}

export function parseCandidateEvidenceReviewV1(value: unknown): CandidateEvidenceReviewV1 {
  if (!isRecord(value) || value.version !== "candidate-evidence-review-v1") {
    return unverifiedReview();
  }
  if (value.integrity === "unverified") {
    return unverifiedReview(safeHttpUrl(value.openUrl) ?? undefined);
  }
  if (value.integrity !== "verified_public"
    || !isRecord(value.facts)
    || !isRecord(value.assessment)
    || !isRecord(value.assessment.scores)) {
    return unverifiedReview();
  }

  const facts = value.facts;
  const assessment = value.assessment;
  const scores = assessment.scores as Record<string, unknown>;
  const documentUrl = safeHttpUrl(facts.documentUrl);
  const candidateUrl = facts.candidateUrl === null ? null : safeHttpUrl(facts.candidateUrl);
  const openUrl = safeHttpUrl(facts.openUrl);
  const capturedAt = text(facts.capturedAt, 64);
  const computedAt = text(assessment.computedAt, 64);
  const sourceHost = nullableText(facts.sourceHost, 253);
  const contentType = nullableText(facts.contentType, 200);
  const categoryHint = nullableText(facts.categoryHint, 200);
  const signalText = nullableText(facts.signalText, 2_000);
  const priceText = nullableText(facts.priceText, 200);
  const httpStatus = nullableInteger(facts.httpStatus, 100, 599);
  const redirectCount = nullableInteger(facts.redirectCount, 0, 10);
  const extractionSignals = stringArray(facts.extractionSignals, 32, 200);
  const riskFlags = stringArray(assessment.riskFlags, 32, 120);
  const reasons = stringArray(assessment.reasons, 32, 500);
  const demandSignal = score(scores.demandSignal);
  const supplyEase = score(scores.supplyEase);
  const risk = score(scores.risk);
  const beginnerFit = score(scores.beginnerFit);
  const final = score(scores.final);

  if (!documentUrl
    || !openUrl
    || (facts.candidateUrl !== null && !candidateUrl)
    || !capturedAt
    || !Number.isFinite(Date.parse(capturedAt))
    || !computedAt
    || !Number.isFinite(Date.parse(computedAt))
    || sourceHost === undefined
    || contentType === undefined
    || categoryHint === undefined
    || signalText === undefined
    || priceText === undefined
    || httpStatus === undefined
    || redirectCount === undefined
    || (facts.hasImage !== null && typeof facts.hasImage !== "boolean")
    || typeof facts.sourceType !== "string"
    || !SOURCE_TYPES.has(facts.sourceType as SourceEvidenceSourceType)
    || typeof facts.sourceRelation !== "string"
    || !SOURCE_RELATIONS.has(facts.sourceRelation as SourceEvidenceRelation)
    || typeof facts.robots !== "string"
    || !ROBOTS_STATUSES.has(facts.robots as SourceEvidenceRobotsStatus)
    || !text(facts.title, 500)
    || !extractionSignals
    || !text(assessment.algorithm, 80)
    || !isSupportedStoredAssessmentAlgorithm(assessment.algorithm)
    || !text(assessment.candidateType, 80)
    || typeof assessment.queueSuggestion !== "string"
    || !QUEUE_SUGGESTIONS.has(assessment.queueSuggestion as RuleAssessmentQueueSuggestion)
    || !riskFlags
    || !reasons
    || demandSignal === null
    || supplyEase === null
    || risk === null
    || beginnerFit === null
    || final === null) {
    return unverifiedReview();
  }

  return {
    version: "candidate-evidence-review-v1",
    integrity: "verified_public",
    facts: {
      capturedAt,
      sourceHost,
      sourceType: facts.sourceType as SourceEvidenceSourceType,
      sourceRelation: facts.sourceRelation as SourceEvidenceRelation,
      documentUrl,
      candidateUrl,
      openUrl,
      httpStatus,
      contentType,
      robots: facts.robots as SourceEvidenceRobotsStatus,
      redirectCount,
      title: text(facts.title, 500)!,
      categoryHint,
      signalText,
      priceText,
      hasImage: facts.hasImage as boolean | null,
      extractionSignals,
    },
    assessment: {
      algorithm: text(assessment.algorithm, 80)!,
      computedAt,
      candidateType: text(assessment.candidateType, 80)!,
      scores: { demandSignal, supplyEase, risk, beginnerFit, final },
      riskFlags,
      reasons,
      queueSuggestion: assessment.queueSuggestion as RuleAssessmentQueueSuggestion,
    },
  };
}
