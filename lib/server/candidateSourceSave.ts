import "server-only";
import { normalizeCandidateEvidence } from "@/lib/candidateEvidence";
import { inspectStoredCandidateSourceMeta } from "@/lib/candidateSourceIntegrity";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeRuleAssessmentV1,
  normalizeSourceEvidenceV2,
  type RuleAssessmentV1Input,
  type SourceEvidenceV2Input,
} from "@/lib/sourceEvidenceContract";
import {
  buildSourceProofSubject,
  verifySourceProof,
  type SourceProofPayload,
} from "@/lib/server/sourceProof";
import { assessSourceEvidenceV2 } from "@/lib/server/sourceEvidenceAssessment";
import { getSignedSourceQueuePolicy } from "@/lib/ruleAssessmentPolicy";

export type CandidateSaveMode = "signed_source_v2" | "legacy_unverified";
export type CandidateSourceSaveErrorCode =
  | "invalid_payload"
  | "candidate_batch_invalid"
  | "source_proof_invalid"
  | "candidate_source_conflict";

export type CandidateSaveAccessContext =
  | { mode: "owner" }
  | { mode: "demo"; demoAccessId: string };

export type CandidateSaveItem = {
  name: string;
  rawInput: string;
  link: string | null;
  score: number;
  source: string;
  keyword: string;
  riskLevel: string;
  riskLabel: string;
  summaryLabel: string;
  status: "pending" | "worth_analyzing" | "analyzed" | "paused" | "rejected";
  sourceMetaJson: string;
  analysisJson: string;
  convertedTaskId: string | null;
  evidenceHash?: string;
  assessmentHash?: string;
};

export type CandidateSavePreflight = {
  mode: CandidateSaveMode;
  items: CandidateSaveItem[];
};

type RecordValue = Record<string, unknown>;

const SIGNED_FIELDS = ["sourceEvidence", "ruleAssessment", "sourceProof"] as const;
export class CandidateSourceSaveError extends Error {
  constructor(
    public readonly code: CandidateSourceSaveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CandidateSourceSaveError";
  }
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.normalize("NFC").trim().replace(/\s+/g, " ")
    : fallback;
}

function score(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(100, Math.max(0, Math.round(numberValue)));
}

function hasSignedField(item: RecordValue, field: typeof SIGNED_FIELDS[number]): boolean {
  return item[field] !== undefined && item[field] !== null;
}

function signedFieldCount(item: RecordValue): number {
  return SIGNED_FIELDS.filter((field) => hasSignedField(item, field)).length;
}

export function normalizeCandidateIdentity(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

function sourceLabel(sourceType: string, sourceHost: string | null): string {
  const label = sourceType === "rss"
    ? "RSS抓取"
    : sourceType === "sitemap"
      ? "Sitemap抓取"
      : sourceType === "json"
        ? "JSON抓取"
        : "网页抓取";
  return sourceHost ? `${label} · ${sourceHost}` : label;
}

function riskPresentation(riskScore: number): Pick<CandidateSaveItem, "riskLevel" | "riskLabel"> {
  if (riskScore >= 70) return { riskLevel: "red", riskLabel: "高风险" };
  if (riskScore >= 40) return { riskLevel: "yellow", riskLabel: "需注意" };
  return { riskLevel: "green", riskLabel: "低风险" };
}

function summaryLabel(finalScore: number, riskScore: number, queueSuggestion: string): string {
  if (queueSuggestion === "reject" || riskScore >= 70) return "风险较高，需人工复核后决定";
  if (queueSuggestion === "watch" || finalScore < 60) return "证据有限，建议人工观察";
  if (finalScore >= 80) return "高分候选，建议优先人工评估";
  return "候选可评估，需人工确认后进入分析";
}

function verifySignedItem(
  raw: RecordValue,
  context: CandidateSaveAccessContext,
  now: number,
): CandidateSaveItem {
  let sourceEvidence;
  let ruleAssessment;
  try {
    sourceEvidence = normalizeSourceEvidenceV2(raw.sourceEvidence as SourceEvidenceV2Input);
    ruleAssessment = normalizeRuleAssessmentV1(raw.ruleAssessment as RuleAssessmentV1Input);
  } catch {
    throw new CandidateSourceSaveError("candidate_batch_invalid", "Signed Candidate 契约无效。");
  }

  if (sourceEvidence.origin !== "public_url" || sourceEvidence.sourceType === "manual") {
    throw new CandidateSourceSaveError("candidate_batch_invalid", "Signed Candidate 来源类型无效。");
  }

  const evidenceHash = createEvidenceHash(sourceEvidence);
  const assessmentHash = createAssessmentHash(ruleAssessment);
  if (ruleAssessment.evidenceHash !== evidenceHash) {
    throw new CandidateSourceSaveError("source_proof_invalid", "来源证明无效。");
  }

  let subject: string;
  try {
    subject = buildSourceProofSubject(context);
  } catch {
    throw new CandidateSourceSaveError("source_proof_invalid", "来源证明无效。");
  }
  const verification = verifySourceProof(raw.sourceProof, {
    subject,
    evidenceHash,
    assessmentHash,
    sourceType: sourceEvidence.sourceType,
  }, now);
  if (!verification.ok) {
    throw new CandidateSourceSaveError("source_proof_invalid", "来源证明无效或已过期。");
  }

  const queuePolicy = getSignedSourceQueuePolicy(ruleAssessment);
  if (queuePolicy.reason === "unsupported_algorithm") {
    throw new CandidateSourceSaveError("candidate_batch_invalid", "Signed Candidate 规则版本不受支持。");
  }
  const recomputedAssessment = assessSourceEvidenceV2(sourceEvidence, ruleAssessment.computedAt);
  if (createAssessmentHash(recomputedAssessment) !== assessmentHash) {
    throw new CandidateSourceSaveError("source_proof_invalid", "来源规则结果无法由 Evidence 重算。");
  }
  if (!queuePolicy.canSave) {
    throw new CandidateSourceSaveError("candidate_batch_invalid", "该来源结果不能保存为 Candidate。");
  }

  const name = text(sourceEvidence.observations.title);
  if (!name) {
    throw new CandidateSourceSaveError("candidate_batch_invalid", "Signed Candidate 名称为空。");
  }
  const link = sourceEvidence.candidateUrl ?? sourceEvidence.finalUrl;
  if (!link) {
    throw new CandidateSourceSaveError("candidate_batch_invalid", "Signed Candidate 缺少权威来源链接。");
  }

  const finalScore = score(ruleAssessment.scores.final);
  const riskScore = score(ruleAssessment.scores.risk);
  const risk = riskPresentation(riskScore);
  const evidenceSnapshot = normalizeCandidateEvidence({
    title: name,
    sourceType: sourceEvidence.sourceType,
    sourceName: sourceEvidence.sourceHost || "public_source",
    sourceUrl: link,
    candidateType: ruleAssessment.candidateType,
    score: finalScore,
    demandSignalScore: ruleAssessment.scores.demandSignal,
    supplyEaseScore: ruleAssessment.scores.supplyEase,
    riskScore,
    beginnerFitScore: ruleAssessment.scores.beginnerFit,
    priceText: sourceEvidence.observations.priceText,
    hasImage: sourceEvidence.observations.hasImage,
    riskFlags: ruleAssessment.riskFlags,
    generatedAt: ruleAssessment.computedAt,
  });

  return {
    name,
    rawInput: name,
    link,
    score: finalScore,
    source: sourceLabel(sourceEvidence.sourceType, sourceEvidence.sourceHost),
    keyword: sourceEvidence.observations.categoryHint || "",
    ...risk,
    summaryLabel: summaryLabel(finalScore, riskScore, ruleAssessment.queueSuggestion),
    status: "pending",
    convertedTaskId: null,
    evidenceHash,
    assessmentHash,
    sourceMetaJson: JSON.stringify({
      version: "candidate-source-meta-v2",
      integrity: "signed_source_v2",
      evidenceHash,
      sourceEvidence,
      proof: proofMetadata(verification.payload),
      evidenceSnapshot,
    }),
    analysisJson: JSON.stringify({
      version: "candidate-analysis-v2",
      integrity: "signed_source_v2",
      assessmentHash,
      ruleAssessment,
    }),
  };
}

function proofMetadata(payload: SourceProofPayload) {
  return {
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    sourceType: payload.sourceType,
  };
}

function legacyItem(raw: RecordValue): CandidateSaveItem {
  const name = text(raw.name);
  if (!name) throw new CandidateSourceSaveError("invalid_payload", "候选品名称为空。");

  const link = text(raw.link) || null;
  const itemScore = score(raw.score);
  const source = text(raw.source, "机会雷达");
  const riskLevel = text(raw.riskLevel);
  const riskLabel = text(raw.riskLabel);
  const evidenceSnapshot = normalizeCandidateEvidence({
    title: name,
    sourceType: "manual",
    sourceName: "manual_or_legacy",
    sourceUrl: link,
    score: itemScore,
    riskHint: riskLabel,
  });
  return {
    name,
    rawInput: text(raw.rawInput, name),
    link,
    score: itemScore,
    source,
    keyword: text(raw.keyword),
    riskLevel,
    riskLabel,
    summaryLabel: text(raw.summaryLabel),
    status: "pending",
    convertedTaskId: null,
    sourceMetaJson: JSON.stringify({
      version: "candidate-source-meta-v2",
      integrity: "legacy_unverified",
      origin: "manual_or_legacy",
      evidenceSnapshot,
    }),
    analysisJson: JSON.stringify({
      version: "candidate-analysis-v2",
      integrity: "legacy_unverified",
      origin: "manual_or_legacy",
    }),
  };
}

export function preflightCandidateSaveBatch(
  rawItems: unknown[],
  context: CandidateSaveAccessContext,
  now = Date.now(),
): CandidateSavePreflight {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new CandidateSourceSaveError("invalid_payload", "请提供至少一个候选品。");
  }

  const records = rawItems.filter(isRecord);
  const signedCounts = records.map(signedFieldCount);
  const hasAnySigned = signedCounts.some((count) => count > 0);
  const isCompleteSignedBatch = records.length === rawItems.length
    && signedCounts.length === rawItems.length
    && signedCounts.every((count) => count === SIGNED_FIELDS.length);

  if (hasAnySigned && !isCompleteSignedBatch) {
    throw new CandidateSourceSaveError("candidate_batch_invalid", "Candidate 批次签名模式不完整或混合。");
  }
  if (records.length !== rawItems.length) {
    throw new CandidateSourceSaveError(
      hasAnySigned ? "candidate_batch_invalid" : "invalid_payload",
      "Candidate 批次包含无效项目。",
    );
  }

  if (!isCompleteSignedBatch) {
    return { mode: "legacy_unverified", items: records.map(legacyItem) };
  }

  if (!Number.isSafeInteger(now)) {
    throw new CandidateSourceSaveError("candidate_batch_invalid", "Candidate 批次时间无效。");
  }
  const uniqueItems = new Map<string, CandidateSaveItem>();
  for (const raw of records) {
    const item = verifySignedItem(raw, context, now);
    const identity = normalizeCandidateIdentity(item.name);
    const existing = uniqueItems.get(identity);
    if (!existing) {
      uniqueItems.set(identity, item);
      continue;
    }
    if (existing.evidenceHash !== item.evidenceHash) {
      throw new CandidateSourceSaveError("candidate_source_conflict", "同名 Candidate 来源证据冲突。");
    }
  }

  return { mode: "signed_source_v2", items: [...uniqueItems.values()] };
}

export function parseStoredCandidateSourceMeta(value: string): {
  integrity: "signed_source_v2";
  evidenceHash: string;
} | { integrity: "legacy_or_invalid" } {
  const inspected = inspectStoredCandidateSourceMeta(value);
  return inspected.sourceIntegrity === "verified_public"
    ? { integrity: "signed_source_v2", evidenceHash: inspected.evidenceHash }
    : { integrity: "legacy_or_invalid" };
}
