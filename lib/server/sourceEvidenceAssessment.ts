import "server-only";
import { classifyRadarCandidateTitle } from "@/lib/server/radarNormalize";
import { CURRENT_RULE_ASSESSMENT_ALGORITHM } from "@/lib/ruleAssessmentPolicy";
import {
  createEvidenceHash,
  normalizeRuleAssessmentV1,
  normalizeSourceEvidenceV2,
  type RuleAssessmentQueueSuggestion,
  type RuleAssessmentV1,
  type SourceEvidenceV2,
  type SourceEvidenceV2Input,
} from "@/lib/sourceEvidenceContract";
import { scoreEvidenceSignals } from "@/lib/server/radarScore";

const RISK_RULES: Array<[RegExp, string]> = [
  [/baby|kids|child|toddler|infant|newborn/i, "儿童用品合规"],
  [/pet|dog|cat/i, "宠物用品安全"],
  [/food|edible|drink|water|bpa|food contact/i, "食品接触材料"],
  [/battery|charge|electric|usb.*power|recharge/i, "带电/电池运输"],
  [/magnet/i, "磁铁安全"],
  [/medical|health.*claim|supplement|cure|treatment/i, "医疗宣称"],
  [/disney|nike|pok[eé]mon|apple inc|marvel|star wars|harry potter|anime/i, "IP侵权风险"],
  [/cosmetic|skincare|cream|serum|face mask/i, "化妆品合规"],
  [/silicone|plastic|rubber/i, "材质检测"],
];

function riskFlagsFromEvidence(evidence: SourceEvidenceV2): string[] {
  const text = [
    evidence.observations.title,
    evidence.observations.categoryHint,
    evidence.observations.signalText,
  ].filter(Boolean).join(" ");
  return RISK_RULES.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

function queueSuggestion(
  candidateType: ReturnType<typeof classifyRadarCandidateTitle>["candidateType"],
  finalScore: number,
  riskScore: number,
): RuleAssessmentQueueSuggestion {
  if (candidateType === "rejected") return "reject";
  if (candidateType !== "product_candidate" || riskScore >= 70 || finalScore < 60) return "watch";
  return "review";
}

export function assessSourceEvidenceV2(
  input: SourceEvidenceV2Input | SourceEvidenceV2,
  computedAt: string,
): RuleAssessmentV1 {
  const evidence = normalizeSourceEvidenceV2(input);
  const classification = classifyRadarCandidateTitle(evidence.observations.title);
  const scores = scoreEvidenceSignals({
    title: evidence.observations.title,
    categoryHint: evidence.observations.categoryHint,
    signalText: evidence.observations.signalText,
  });
  const riskFlags = riskFlagsFromEvidence(evidence);
  const suggestion = queueSuggestion(
    classification.candidateType,
    scores.finalScore,
    scores.riskScore,
  );

  return normalizeRuleAssessmentV1({
    version: "candidate-rule-v1",
    algorithm: CURRENT_RULE_ASSESSMENT_ALGORITHM,
    evidenceHash: createEvidenceHash(evidence),
    computedAt,
    candidateType: classification.candidateType,
    scores: {
      demandSignal: scores.demandSignalScore,
      supplyEase: scores.supplyEaseScore,
      risk: scores.riskScore,
      beginnerFit: scores.beginnerFitScore,
      final: scores.finalScore,
    },
    riskFlags,
    reasons: [
      `页面规则分：综合 ${scores.finalScore}，风险 ${scores.riskScore}`,
      `来源文本分类：${classification.candidateType}`,
      ...(classification.reason ? [classification.reason] : []),
      ...riskFlags.map((flag) => `规则风险提示：${flag}`),
    ],
    queueSuggestion: suggestion,
  });
}
