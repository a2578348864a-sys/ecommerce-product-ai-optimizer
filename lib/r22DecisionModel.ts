export type R22MarketDecision =
  | "market_shortlisted"
  | "market_watch"
  | "market_reject"
  | "insufficient_market_data";

export type R22ExperimentConclusion =
  | "not_validated"
  | "directional_only"
  | "unstable"
  | "blocked"
  | "failed"
  | "promising";

export type R22EvidenceBindingLevel =
  | "candidate_bound"
  | "variant_bound"
  | "product_family_bound"
  | "category_analog"
  | "common_rule_reference"
  | "procedural_reference";

export type R22InformationStatus =
  | "confirmed_fact"
  | "calculated"
  | "estimated"
  | "inference"
  | "missing"
  | "conflicting";

export type R22EvidenceItem = {
  bindingLevel: R22EvidenceBindingLevel;
  informationStatus: R22InformationStatus;
  sourceRef: string;
  limitation: string | null;
};

export type R22EvidenceIssue = "conflict" | "limitation" | "unbound" | null;

export function classifyR22Evidence(item: R22EvidenceItem) {
  const candidateRelated = item.bindingLevel === "candidate_bound"
    || item.bindingLevel === "variant_bound"
    || item.bindingLevel === "product_family_bound";
  const factual = item.informationStatus === "confirmed_fact" || item.informationStatus === "calculated";
  const issue: R22EvidenceIssue = item.informationStatus === "conflicting"
    ? "conflict"
    : !candidateRelated
      ? "unbound"
      : item.limitation
        ? "limitation"
        : null;
  return {
    countsTowardCandidateMarketEvidence: candidateRelated && factual && issue === null,
    issue,
  };
}

export function adaptR21CommercialHistory(input: {
  schemaVersion: string;
  commercialClassification: "needs_data" | "reject" | "advance" | "watch";
  r21ValidationConclusion: "promising" | "inconclusive" | "failed" | "blocked";
}) {
  return {
    schemaVersion: "r21-readonly-compat-v1" as const,
    sourceSchemaVersion: input.schemaVersion,
    originalCommercialClassification: input.commercialClassification,
    originalValidationConclusion: input.r21ValidationConclusion,
    marketDecision: null,
    readOnly: true as const,
  };
}

export type R22MarketRule = {
  ruleVersion: "r22-stage1-market-v1";
  minimumEvidenceCoverage: number;
  stabilityByBrief: { A: "stable"; B: "unstable" };
  reject: {
    stage1ScoreLt: number;
    customerProofLt: number;
    visibleOfferSignalLte: number;
  };
  shortlist: {
    stage1ScoreGte: number;
    searchFootprintGte: number;
    customerProofGte: number;
    visibleOfferSignalGte: number;
  };
};

export type R22MarketDecisionInput = {
  candidateId: string;
  asin: string;
  briefId: "A" | "B";
  frozenRank: number | null;
  frozenGroup?: "top" | "control";
  title: string;
  url: string;
  priceUsd: number | null;
  identityAndSourceMapped: boolean;
  identityConflicts: string[];
  candidateBoundSourceRefs: string[];
  dimensionStatus: {
    searchFootprint: "valid" | "unknown";
    customerProof: "valid" | "unknown";
    visibleOfferSignal: "valid" | "unknown";
  };
  evidenceCoverage: number;
  stage1Score: number | null;
  searchFootprint: number | null;
  customerProof: number | null;
  visibleOfferSignal: number | null;
  confirmedFatalRisk: boolean;
  confirmedFatalRiskCode?: "brand_or_ip" | "platform_restriction" | "compliance_block" | "other_fatal";
  stabilityStatus: "stable" | "unstable";
  inputHash: string;
  createdAt: string;
};

export type R22MarketDecisionSnapshot = {
  schemaVersion: "r22-market-decision-v1";
  evidenceVersion: "r22-evidence-semantics-v1";
  candidateId: string;
  asin: string;
  briefId: "A" | "B";
  frozenRank: number | null;
  marketDecision: R22MarketDecision;
  decisionReasons: string[];
  supportingEvidenceRefs: string[];
  opposingEvidenceRefs: string[];
  marketMissingFields: string[];
  dataCompleteness: number;
  confidence: "high" | "medium" | "low";
  stabilityStatus: "stable" | "unstable";
  ruleVersion: "r22-stage1-market-v1";
  inputHash: string;
  createdAt: string;
};

const HASH = /^[a-f0-9]{64}$/i;

function presentText(value: string) {
  return value.trim().length > 0;
}

function finite(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function evaluateR22MarketDecision(
  input: R22MarketDecisionInput,
  rule: R22MarketRule,
): R22MarketDecisionSnapshot {
  const checks: Array<[string, boolean]> = [
    ["candidateId", presentText(input.candidateId)],
    ["asin", presentText(input.asin)],
    ["briefId", input.briefId === "A" || input.briefId === "B"],
    ["title", presentText(input.title)],
    ["url", presentText(input.url)],
    ["priceUsd", finite(input.priceUsd) && input.priceUsd > 0],
    ["identityAndSourceMapped", input.identityAndSourceMapped && input.identityConflicts.length === 0],
    ["candidateBoundSourceRefs", input.candidateBoundSourceRefs.some(presentText)],
    ["searchFootprint", input.dimensionStatus.searchFootprint === "valid" && finite(input.searchFootprint)],
    ["customerProof", input.dimensionStatus.customerProof === "valid" && finite(input.customerProof)],
    ["visibleOfferSignal", input.dimensionStatus.visibleOfferSignal === "valid" && finite(input.visibleOfferSignal)],
    ["evidenceCoverage", input.evidenceCoverage === rule.minimumEvidenceCoverage],
    ["stage1Score", finite(input.stage1Score)],
    ["frozenRank", Number.isInteger(input.frozenRank) && (input.frozenRank ?? 0) > 0],
  ];
  const marketMissingFields = checks.filter(([, valid]) => !valid).map(([field]) => field);
  const dataCompleteness = (checks.length - marketMissingFields.length) / checks.length;
  let marketDecision: R22MarketDecision;
  let decisionReasons: string[];

  if (marketMissingFields.length > 0) {
    marketDecision = "insufficient_market_data";
    decisionReasons = ["required_market_data_incomplete"];
  } else {
    const stage1Score = input.stage1Score as number;
    const searchFootprint = input.searchFootprint as number;
    const customerProof = input.customerProof as number;
    const visibleOfferSignal = input.visibleOfferSignal as number;
    const consistentWeakSignal = stage1Score < rule.reject.stage1ScoreLt
      && customerProof < rule.reject.customerProofLt
      && visibleOfferSignal <= rule.reject.visibleOfferSignalLte;
    const shortlisted = stage1Score >= rule.shortlist.stage1ScoreGte
      && searchFootprint >= rule.shortlist.searchFootprintGte
      && customerProof >= rule.shortlist.customerProofGte
      && visibleOfferSignal >= rule.shortlist.visibleOfferSignalGte;

    if (input.confirmedFatalRisk) {
      marketDecision = "market_reject";
      decisionReasons = [input.confirmedFatalRiskCode
        ? `confirmed_fatal_market_or_platform_risk:${input.confirmedFatalRiskCode}`
        : "confirmed_fatal_market_or_platform_risk"];
    } else if (consistentWeakSignal) {
      marketDecision = "market_reject";
      decisionReasons = ["consistent_weak_market_signals"];
    } else if (shortlisted) {
      marketDecision = "market_shortlisted";
      decisionReasons = ["all_preregistered_shortlist_thresholds_met"];
    } else {
      marketDecision = "market_watch";
      decisionReasons = ["market_data_complete_but_shortlist_thresholds_not_all_met"];
    }
  }

  const stabilityStatus = rule.stabilityByBrief[input.briefId];
  return {
    schemaVersion: "r22-market-decision-v1",
    evidenceVersion: "r22-evidence-semantics-v1",
    candidateId: input.candidateId,
    asin: input.asin,
    briefId: input.briefId,
    frozenRank: input.frozenRank,
    marketDecision,
    decisionReasons,
    supportingEvidenceRefs: [...input.candidateBoundSourceRefs],
    opposingEvidenceRefs: [],
    marketMissingFields,
    dataCompleteness,
    confidence: marketDecision === "insufficient_market_data"
      ? "low"
      : stabilityStatus === "unstable" || marketDecision === "market_watch"
        ? "medium"
        : "high",
    stabilityStatus,
    ruleVersion: rule.ruleVersion,
    inputHash: input.inputHash,
    createdAt: input.createdAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseR22MarketDecisionSnapshot(value: unknown): R22MarketDecisionSnapshot | null {
  if (!isRecord(value)
    || value.schemaVersion !== "r22-market-decision-v1"
    || value.evidenceVersion !== "r22-evidence-semantics-v1"
    || typeof value.candidateId !== "string"
    || !presentText(value.candidateId)
    || typeof value.asin !== "string"
    || !presentText(value.asin)
    || (value.briefId !== "A" && value.briefId !== "B")
    || !["market_shortlisted", "market_watch", "market_reject", "insufficient_market_data"].includes(String(value.marketDecision))
    || !Array.isArray(value.decisionReasons)
    || !Array.isArray(value.supportingEvidenceRefs)
    || !Array.isArray(value.opposingEvidenceRefs)
    || !Array.isArray(value.marketMissingFields)
    || typeof value.dataCompleteness !== "number"
    || !Number.isFinite(value.dataCompleteness)
    || value.dataCompleteness < 0
    || value.dataCompleteness > 1
    || (value.confidence !== "high" && value.confidence !== "medium" && value.confidence !== "low")
    || (value.stabilityStatus !== "stable" && value.stabilityStatus !== "unstable")
    || value.stabilityStatus !== (value.briefId === "B" ? "unstable" : "stable")
    || value.ruleVersion !== "r22-stage1-market-v1"
    || typeof value.inputHash !== "string"
    || !HASH.test(value.inputHash)
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))) {
    return null;
  }
  const frozenRank = value.frozenRank;
  if (frozenRank !== null && (!Number.isInteger(frozenRank) || Number(frozenRank) <= 0)) return null;
  if (![value.decisionReasons, value.supportingEvidenceRefs, value.opposingEvidenceRefs, value.marketMissingFields]
    .every((items) => items.every((item) => typeof item === "string" && item.trim().length > 0))) return null;
  const isInsufficient = value.marketDecision === "insufficient_market_data";
  if (isInsufficient) {
    if (value.marketMissingFields.length === 0 || value.dataCompleteness >= 1) return null;
  } else if (value.marketMissingFields.length > 0
    || value.dataCompleteness !== 1
    || value.supportingEvidenceRefs.length === 0) {
    return null;
  }
  return {
    schemaVersion: "r22-market-decision-v1",
    evidenceVersion: "r22-evidence-semantics-v1",
    candidateId: value.candidateId,
    asin: value.asin,
    briefId: value.briefId,
    frozenRank: frozenRank as number | null,
    marketDecision: value.marketDecision as R22MarketDecision,
    decisionReasons: [...value.decisionReasons] as string[],
    supportingEvidenceRefs: [...value.supportingEvidenceRefs] as string[],
    opposingEvidenceRefs: [...value.opposingEvidenceRefs] as string[],
    marketMissingFields: [...value.marketMissingFields] as string[],
    dataCompleteness: value.dataCompleteness,
    confidence: value.confidence,
    stabilityStatus: value.stabilityStatus,
    ruleVersion: "r22-stage1-market-v1",
    inputHash: value.inputHash,
    createdAt: value.createdAt,
  };
}

export function parseR22MarketDecisionFromAnalysisJson(value: unknown): R22MarketDecisionSnapshot | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;
  return parseR22MarketDecisionSnapshot(parsed.r22MarketDecision);
}
