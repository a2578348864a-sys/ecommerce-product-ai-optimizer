import type { CandidateEvidenceSnapshot } from "@/lib/candidateEvidence";
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

  const params = new URLSearchParams({
    source: "opportunity",
    candidateId,
  });

  return `/agent/run?${params.toString()}`;
}
