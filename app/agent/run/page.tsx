import { AgentRunClient, type AgentRunSourceMeta } from "@/components/agent/AgentRunClient";
import { parseCandidateEvidenceParam } from "@/lib/candidateEvidence";
import { parseR22MarketDecisionSnapshot } from "@/lib/r22DecisionModel";

type AgentRunSearchParams = {
  product?: string | string[];
  productName?: string | string[];
  source?: string | string[];
  from?: string | string[];
  entry?: string | string[];
  opportunityTitle?: string | string[];
  sourceTitle?: string | string[];
  opportunityScore?: string | string[];
  opportunitySource?: string | string[];
  keyword?: string | string[];
  candidateType?: string | string[];
  sourceUrl?: string | string[];
  candidateId?: string | string[];
  originalName?: string | string[];
  analyzedName?: string | string[];
  evidence?: string | string[];
  r22Market?: string | string[];
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeDecode(value: string | undefined) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sourceMetaFromParams(params: AgentRunSearchParams, productName?: string): AgentRunSourceMeta | null {
  if (firstParam(params.source) !== "opportunity" || !productName) return null;

  const opportunityScoreRaw = firstParam(params.opportunityScore);
  const opportunityScoreNumber = opportunityScoreRaw === undefined ? Number.NaN : Number(opportunityScoreRaw);
  const opportunityScore = Number.isFinite(opportunityScoreNumber)
    ? Math.min(100, Math.max(0, Math.round(opportunityScoreNumber)))
    : undefined;
  const sourceTitle = safeDecode(firstParam(params.sourceTitle));
  const opportunityTitle = safeDecode(firstParam(params.opportunityTitle)) || sourceTitle || productName;
  const opportunitySource = safeDecode(firstParam(params.opportunitySource));
  const keyword = safeDecode(firstParam(params.keyword));
  const candidateType = safeDecode(firstParam(params.candidateType));
  const sourceUrl = safeDecode(firstParam(params.sourceUrl));
  const candidateId = safeDecode(firstParam(params.candidateId));
  const from = safeDecode(firstParam(params.from));
  const entry = safeDecode(firstParam(params.entry));
  const originalName = safeDecode(firstParam(params.originalName));
  const analyzedName = safeDecode(firstParam(params.analyzedName));
  const evidenceSnapshot = parseCandidateEvidenceParam(firstParam(params.evidence));
  let r22MarketDecisionSnapshot = null;
  const r22MarketRaw = firstParam(params.r22Market);
  if (r22MarketRaw) {
    try {
      r22MarketDecisionSnapshot = parseR22MarketDecisionSnapshot(JSON.parse(r22MarketRaw));
    } catch {
      r22MarketDecisionSnapshot = null;
    }
  }

  return {
    source: "opportunity",
    ...(from === "opportunity" ? { from } : {}),
    ...(entry === "candidate_to_agent_m1" || entry === "candidate_to_agent_run" ? { entry } : {}),
    opportunityTitle,
    ...(opportunitySource ? { opportunitySource } : {}),
    ...(opportunityScore !== undefined ? { opportunityScore } : {}),
    ...(keyword ? { keyword } : {}),
    ...(candidateType ? { candidateType } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(candidateId ? { candidateId } : {}),
    ...(sourceTitle ? { sourceTitle } : {}),
    ...(originalName ? { originalName } : {}),
    ...(analyzedName ? { analyzedName } : {}),
    ...(evidenceSnapshot ? { evidenceSnapshot } : {}),
    ...(r22MarketDecisionSnapshot ? { r22MarketDecisionSnapshot } : {}),
    importedAt: new Date().toISOString(),
  };
}

export default async function AgentRunPage({
  searchParams,
}: {
  searchParams: Promise<AgentRunSearchParams>;
}) {
  const params = await searchParams;
  const initialProductName = safeDecode(firstParam(params.productName)) || safeDecode(firstParam(params.product));
  const initialSourceMeta = sourceMetaFromParams(params, initialProductName);

  return (
    <AgentRunClient
      initialProductName={initialProductName}
      initialSourceMeta={initialSourceMeta}
    />
  );
}
