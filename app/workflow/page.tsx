import { WorkflowClient, type WorkflowSourceMeta } from "@/components/cross-border/WorkflowClient";

type WorkflowSearchParams = {
  product?: string | string[];
  source?: string | string[];
  opportunityTitle?: string | string[];
  opportunityScore?: string | string[];
  opportunitySource?: string | string[];
  keyword?: string | string[];
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

function sourceMetaFromParams(params: WorkflowSearchParams, productName?: string): WorkflowSourceMeta | null {
  if (firstParam(params.source) !== "opportunity" || !productName) return null;

  const opportunityScoreRaw = firstParam(params.opportunityScore);
  const opportunityScoreNumber = opportunityScoreRaw === undefined ? Number.NaN : Number(opportunityScoreRaw);
  const opportunityScore = Number.isFinite(opportunityScoreNumber)
    ? Math.min(100, Math.max(0, Math.round(opportunityScoreNumber)))
    : undefined;
  const opportunityTitle = safeDecode(firstParam(params.opportunityTitle)) || productName;
  const opportunitySource = safeDecode(firstParam(params.opportunitySource));
  const keyword = safeDecode(firstParam(params.keyword));

  return {
    source: "opportunity",
    opportunityTitle,
    ...(opportunitySource ? { opportunitySource } : {}),
    ...(opportunityScore !== undefined ? { opportunityScore } : {}),
    ...(keyword ? { keyword } : {}),
    importedAt: new Date().toISOString(),
  };
}

export default async function WorkflowPage({
  searchParams,
}: {
  searchParams: Promise<WorkflowSearchParams>;
}) {
  const params = await searchParams;
  const initialProductName = safeDecode(firstParam(params.product));
  const initialSourceMeta = sourceMetaFromParams(params, initialProductName);
  return <WorkflowClient initialProductName={initialProductName} initialSourceMeta={initialSourceMeta} />;
}
