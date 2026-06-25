import { AgentRunClient, type AgentRunSourceMeta } from "@/components/agent/AgentRunClient";

type AgentRunSearchParams = {
  product?: string | string[];
  source?: string | string[];
  opportunityTitle?: string | string[];
  opportunityScore?: string | string[];
  opportunitySource?: string | string[];
  keyword?: string | string[];
  candidateType?: string | string[];
  sourceUrl?: string | string[];
  candidateId?: string | string[];
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
  const opportunityTitle = safeDecode(firstParam(params.opportunityTitle)) || productName;
  const opportunitySource = safeDecode(firstParam(params.opportunitySource));
  const keyword = safeDecode(firstParam(params.keyword));
  const candidateType = safeDecode(firstParam(params.candidateType));
  const sourceUrl = safeDecode(firstParam(params.sourceUrl));
  const candidateId = safeDecode(firstParam(params.candidateId));

  return {
    source: "opportunity",
    opportunityTitle,
    ...(opportunitySource ? { opportunitySource } : {}),
    ...(opportunityScore !== undefined ? { opportunityScore } : {}),
    ...(keyword ? { keyword } : {}),
    ...(candidateType ? { candidateType } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(candidateId ? { candidateId } : {}),
    importedAt: new Date().toISOString(),
  };
}

export default async function AgentRunPage({
  searchParams,
}: {
  searchParams: Promise<AgentRunSearchParams>;
}) {
  const params = await searchParams;
  const initialProductName = safeDecode(firstParam(params.product));
  const initialSourceMeta = sourceMetaFromParams(params, initialProductName);

  return (
    <AgentRunClient
      initialProductName={initialProductName}
      initialSourceMeta={initialSourceMeta}
    />
  );
}
