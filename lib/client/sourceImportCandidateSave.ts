import type {
  RuleAssessmentV1,
  SourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import { getSignedSourceQueuePolicy } from "@/lib/ruleAssessmentPolicy";

export type SourceImportCandidateSaveData = {
  title: string;
  sourceUrl: string;
  sourceType: string;
  sourceHost: string;
  categoryHint: string;
  keyword: string;
  riskHint: string;
  riskLevel: string;
  summaryLabel: string;
  score: number;
  demandSignalScore: number;
  supplyEaseScore: number;
  riskScore: number;
  beginnerFitScore: number;
  candidateType?: string;
  sourceEvidence: SourceEvidenceV2;
  ruleAssessment: RuleAssessmentV1;
  sourceProof: string;
};

function sourceLabel(sourceType: string, sourceHost: string): string {
  const label = sourceType === "rss"
    ? "RSS抓取"
    : sourceType === "sitemap"
      ? "Sitemap抓取"
      : sourceType === "json"
        ? "JSON抓取"
        : "网页抓取";
  return sourceHost ? `${label} · ${sourceHost}` : label;
}

function riskLabel(riskLevel: string): string {
  if (riskLevel === "red") return "高风险";
  if (riskLevel === "yellow") return "需注意";
  if (riskLevel === "green") return "低风险";
  return "未评级";
}

export function buildSourceImportCandidateSaveInput(candidate: SourceImportCandidateSaveData) {
  if (!getSignedSourceQueuePolicy(candidate.ruleAssessment).canSave) {
    throw new Error("SOURCE_IMPORT_CANDIDATE_NOT_SAVEABLE");
  }
  return {
    name: candidate.title,
    rawInput: candidate.title,
    link: candidate.sourceUrl || null,
    score: candidate.score,
    source: sourceLabel(candidate.sourceType, candidate.sourceHost),
    keyword: candidate.keyword || candidate.categoryHint,
    riskLevel: candidate.riskLevel,
    riskLabel: riskLabel(candidate.riskLevel),
    summaryLabel: candidate.summaryLabel,
    sourceEvidence: candidate.sourceEvidence,
    ruleAssessment: candidate.ruleAssessment,
    sourceProof: candidate.sourceProof,
  };
}

export function sourceImportSaveSuccessMessage(created: number, unchanged: number): string {
  if (created === 0 && unchanged > 0) {
    return "候选已在池中，来源一致，无需重复导入。";
  }
  return `已导入候选池：新增 ${created} 个，已有相同来源 ${unchanged} 个。`;
}
