import { parseCandidateEvidenceSnapshot, type CandidateEvidenceSnapshot } from "@/lib/candidateEvidence";
import { isAuthoritativeCandidateId } from "@/lib/opportunityCandidatePool";
import {
  parseR22MarketDecisionSnapshot,
  type R22MarketDecisionSnapshot,
} from "@/lib/r22DecisionModel";

export type CandidateAgentRunLinkInput = {
  candidateId?: string | null;
  name?: string | null;
  rawInput?: string | null;
  analyzedName?: string | null;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  source?: string | null;
  score?: number | null;
  keyword?: string | null;
  evidenceSnapshot?: CandidateEvidenceSnapshot | null;
  marketDecisionSnapshot?: R22MarketDecisionSnapshot | null;
  explicitMarketWatchReview?: boolean;
};

function cleanText(value: string | null | undefined, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : "";
}

function boundedScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Math.min(100, Math.max(0, Math.round(value))));
}

export function buildCandidateAgentRunHref(input: CandidateAgentRunLinkInput) {
  const candidateId = cleanText(input.candidateId, 80);
  if (!isAuthoritativeCandidateId(candidateId)) return null;
  const marketDecisionSnapshot = input.marketDecisionSnapshot
    ? parseR22MarketDecisionSnapshot(input.marketDecisionSnapshot)
    : null;
  if (input.marketDecisionSnapshot && !marketDecisionSnapshot) return null;
  if (marketDecisionSnapshot) {
    if (marketDecisionSnapshot.candidateId !== candidateId) return null;
    if (marketDecisionSnapshot.marketDecision === "market_reject"
      || marketDecisionSnapshot.marketDecision === "insufficient_market_data") return null;
    if (marketDecisionSnapshot.marketDecision === "market_watch" && !input.explicitMarketWatchReview) return null;
  }

  const productName = cleanText(input.analyzedName, 120)
    || cleanText(input.name, 120)
    || cleanText(input.rawInput, 120);
  const sourceTitle = cleanText(input.sourceTitle, 160)
    || cleanText(input.name, 160)
    || cleanText(input.rawInput, 160)
    || productName;

  const params = new URLSearchParams({
    source: "opportunity",
    from: "opportunity",
    entry: "candidate_to_agent_run",
  });

  if (productName) {
    params.set("productName", productName);
    params.set("product", productName); // System-Recovery.2: unified product param
  }
  if (sourceTitle) params.set("sourceTitle", sourceTitle);

  const sourceUrl = cleanText(input.sourceUrl, 500);
  const source = cleanText(input.source, 180);
  const score = boundedScore(input.score);
  const keyword = cleanText(input.keyword, 80);
  const rawInput = cleanText(input.rawInput, 200);
  const analyzedName = cleanText(input.analyzedName, 120);

  params.set("candidateId", candidateId);
  if (sourceUrl) params.set("sourceUrl", sourceUrl);
  if (source) params.set("opportunitySource", source);
  if (score) params.set("opportunityScore", score);
  if (keyword) params.set("keyword", keyword);
  if (rawInput) params.set("originalName", rawInput);
  if (analyzedName) params.set("analyzedName", analyzedName);
  const evidenceSnapshot = parseCandidateEvidenceSnapshot(input.evidenceSnapshot);
  if (evidenceSnapshot) params.set("evidence", JSON.stringify(evidenceSnapshot));
  if (marketDecisionSnapshot) params.set("r22Market", JSON.stringify(marketDecisionSnapshot));
  if (marketDecisionSnapshot?.marketDecision === "market_watch" && input.explicitMarketWatchReview) {
    params.set("r22MarketWatchReviewed", "true");
  }

  return `/agent/run?${params.toString()}`;
}
