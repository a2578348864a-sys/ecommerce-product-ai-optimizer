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
};

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
  const evidenceSnapshot = parseCandidateEvidenceSnapshot(parsedSourceMeta?.evidenceSnapshot);
  const sourceReview = buildCandidateEvidenceReview({
    sourceMetaJson,
    analysisJson,
    link: record.link,
  });
  const r22MarketDecisionSnapshot = parseR22MarketDecisionFromAnalysisJson(analysisJson);

  return {
    ...publicFields,
    ...(evidenceSnapshot ? { evidenceSnapshot } : {}),
    ...(r22MarketDecisionSnapshot ? { r22MarketDecisionSnapshot } : {}),
    sourceIntegrity: sourceReview.integrity,
    sourceReview,
  };
}
