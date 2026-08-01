import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeEvidenceUrl,
  normalizeRuleAssessmentV1,
  normalizeSourceEvidenceV2,
  type RuleAssessmentV1Input,
  type SourceEvidenceV2Input,
} from "@/lib/sourceEvidenceContract";
import type { CandidateEvidenceReviewV1 } from "@/lib/candidateEvidenceReview";
import { inspectStoredCandidateSourceMeta } from "@/lib/candidateSourceIntegrity";
import { parseCandidateEvidenceSnapshot } from "@/lib/candidateEvidence";
import {
  CURRENT_RULE_ASSESSMENT_ALGORITHM,
  isSupportedStoredAssessmentAlgorithm,
} from "@/lib/ruleAssessmentPolicy";
import { assessSourceEvidenceV2 } from "@/lib/server/sourceEvidenceAssessment";
import { parseR22MarketDecisionFromAnalysisJson } from "@/lib/r22DecisionModel";

type CandidateEvidenceRecord = {
  sourceMetaJson?: unknown;
  analysisJson?: unknown;
  link?: unknown;
  source?: unknown;
};

export type CandidatePublicSourceKind =
  | "sellersprite_direct"
  | "product_batch"
  | "manual"
  | "other";

const PUBLIC_CANDIDATE_FIELDS = [
  "id",
  "name",
  "rawInput",
  "link",
  "score",
  "source",
  "keyword",
  "riskLevel",
  "riskLabel",
  "summaryLabel",
  "status",
  "convertedTaskId",
  "createdAt",
  "updatedAt",
  "lastActionAt",
  "sourceMode",
  "isSandbox",
  "canEdit",
  "canDelete",
] as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizedOpenUrl(value: unknown): string | undefined {
  try {
    const normalized = normalizeEvidenceUrl(value, "candidate_link");
    return normalized ?? undefined;
  } catch {
    return undefined;
  }
}

function normalizePublicMarketplace(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > 32 || !/^[\p{L}\p{N} ._-]+$/u.test(normalized)) return null;
  const upper = normalized.toUpperCase();
  if (upper === "US" || upper === "AMAZON US") return "Amazon US";
  return normalized;
}

function publicSourceClassification(input: {
  sourceMeta: Record<string, unknown> | null;
  source: unknown;
}): { sourceKind: CandidatePublicSourceKind; marketplace: string | null } {
  const { sourceMeta } = input;
  const nestedSource = isRecord(sourceMeta?.source) ? sourceMeta.source : null;
  if (sourceMeta?.schema === "sellersprite_candidate_source_v1"
    && nestedSource?.provider === "SellerSprite"
    && nestedSource.type === "sellersprite_xlsx") {
    return {
      sourceKind: "sellersprite_direct",
      marketplace: normalizePublicMarketplace(nestedSource.marketplace),
    };
  }
  if (sourceMeta?.version === "product-batch-candidate-source.v1"
    && sourceMeta.originKind === "seller_sprite_product_batch") {
    return {
      sourceKind: "product_batch",
      marketplace: normalizePublicMarketplace(sourceMeta.marketplace),
    };
  }
  const source = typeof input.source === "string" ? input.source.trim().toLowerCase() : "";
  const manual = source.includes("manual")
    || source.includes("人工")
    || source.includes("本浏览器")
    || source.includes("访客输入")
    || source.includes("访客导入");
  return { sourceKind: manual ? "manual" : "other", marketplace: null };
}

function unverified(input: CandidateEvidenceRecord): CandidateEvidenceReviewV1 {
  const openUrl = normalizedOpenUrl(input.link);
  return {
    version: "candidate-evidence-review-v1",
    integrity: "unverified",
    reason: "legacy_or_invalid",
    ...(openUrl ? { openUrl } : {}),
  };
}

export function buildCandidateEvidenceReview(
  input: CandidateEvidenceRecord,
): CandidateEvidenceReviewV1 {
  const sourceInspection = inspectStoredCandidateSourceMeta(input.sourceMetaJson);
  if (sourceInspection.sourceIntegrity !== "verified_public") return unverified(input);

  const sourceMeta = parseRecord(input.sourceMetaJson);
  const analysis = parseRecord(input.analysisJson);
  if (!sourceMeta
    || !analysis
    || analysis.version !== "candidate-analysis-v2"
    || analysis.integrity !== "signed_source_v2"
    || typeof analysis.assessmentHash !== "string"
    || !SHA256_PATTERN.test(analysis.assessmentHash)
    || !isRecord(sourceMeta.sourceEvidence)
    || !isRecord(analysis.ruleAssessment)) {
    return unverified(input);
  }

  try {
    const sourceEvidence = normalizeSourceEvidenceV2(
      sourceMeta.sourceEvidence as SourceEvidenceV2Input,
    );
    const ruleAssessment = normalizeRuleAssessmentV1(
      analysis.ruleAssessment as RuleAssessmentV1Input,
    );
    const evidenceHash = createEvidenceHash(sourceEvidence);
    const assessmentHash = createAssessmentHash(ruleAssessment);

    if (sourceInspection.evidenceHash !== evidenceHash
      || ruleAssessment.evidenceHash !== evidenceHash
      || analysis.assessmentHash !== assessmentHash
      || !isSupportedStoredAssessmentAlgorithm(ruleAssessment.algorithm)) {
      return unverified(input);
    }
    if (ruleAssessment.algorithm === CURRENT_RULE_ASSESSMENT_ALGORITHM
      && createAssessmentHash(assessSourceEvidenceV2(sourceEvidence, ruleAssessment.computedAt)) !== assessmentHash) {
      return unverified(input);
    }

    const documentUrl = sourceEvidence.finalUrl;
    const openUrl = sourceEvidence.candidateUrl ?? documentUrl;
    if (!documentUrl || !openUrl) return unverified(input);

    return {
      version: "candidate-evidence-review-v1",
      integrity: "verified_public",
      facts: {
        capturedAt: sourceEvidence.capturedAt,
        sourceHost: sourceEvidence.sourceHost,
        sourceType: sourceEvidence.sourceType,
        sourceRelation: sourceEvidence.sourceRelation,
        documentUrl,
        candidateUrl: sourceEvidence.candidateUrl,
        openUrl,
        httpStatus: sourceEvidence.retrieval.httpStatus,
        contentType: sourceEvidence.retrieval.contentType,
        robots: sourceEvidence.retrieval.robots,
        redirectCount: sourceEvidence.retrieval.redirectCount,
        title: sourceEvidence.observations.title,
        categoryHint: sourceEvidence.observations.categoryHint,
        signalText: sourceEvidence.observations.signalText,
        priceText: sourceEvidence.observations.priceText,
        hasImage: sourceEvidence.observations.hasImage,
        extractionSignals: sourceEvidence.extractionSignals,
      },
      assessment: {
        algorithm: ruleAssessment.algorithm,
        computedAt: ruleAssessment.computedAt,
        candidateType: ruleAssessment.candidateType,
        scores: ruleAssessment.scores,
        riskFlags: ruleAssessment.riskFlags,
        reasons: ruleAssessment.reasons,
        queueSuggestion: ruleAssessment.queueSuggestion,
      },
    };
  } catch {
    return unverified(input);
  }
}

export function toPublicOpportunityCandidate<T extends object>(candidate: T) {
  const record = candidate as T & CandidateEvidenceRecord & Record<string, unknown>;
  const sourceMetaJson = record.sourceMetaJson;
  const analysisJson = record.analysisJson;
  const publicFields: Record<string, unknown> = {};
  for (const field of PUBLIC_CANDIDATE_FIELDS) {
    if (record[field] !== undefined) publicFields[field] = record[field];
  }
  const parsedSourceMeta = parseRecord(sourceMetaJson);
  const publicSource = publicSourceClassification({
    sourceMeta: parsedSourceMeta,
    source: record.source,
  });
  const evidenceSnapshot = parseCandidateEvidenceSnapshot(parsedSourceMeta?.evidenceSnapshot);
  const sourceReview = buildCandidateEvidenceReview({
    sourceMetaJson,
    analysisJson,
    link: record.link,
  });
  const r22MarketDecisionSnapshot = parseR22MarketDecisionFromAnalysisJson(analysisJson);

  return {
    ...publicFields,
    ...publicSource,
    ...(evidenceSnapshot ? { evidenceSnapshot } : {}),
    ...(r22MarketDecisionSnapshot ? { r22MarketDecisionSnapshot } : {}),
    sourceIntegrity: sourceReview.integrity,
    sourceReview,
  };
}
