import { redirect } from "next/navigation";

type WorkflowSearchParams = {
  product?: string | string[];
  source?: string | string[];
  opportunityTitle?: string | string[];
  opportunityScore?: string | string[];
  opportunitySource?: string | string[];
  keyword?: string | string[];
  candidateType?: string | string[];
  sourceUrl?: string | string[];
  candidateId?: string | string[];
  productName?: string | string[];
  from?: string | string[];
  entry?: string | string[];
  sourceTitle?: string | string[];
  originalName?: string | string[];
  analyzedName?: string | string[];
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Phase Direction-Recovery.3: /workflow (old 4-step "单品一键分析") redirects to
 * /agent/run (8-step second-gen Agent main flow). All query params are preserved.
 */
export default async function WorkflowPage({
  searchParams,
}: {
  searchParams: Promise<WorkflowSearchParams>;
}) {
  const params = await searchParams;

  // Build redirect URL preserving all known query params
  const redirectParams = new URLSearchParams();

  const map: Record<string, string | undefined> = {};
  for (const key of ["product", "productName", "source", "from", "entry", "sourceTitle",
    "opportunityTitle", "opportunityScore", "opportunitySource", "keyword",
    "candidateType", "sourceUrl", "candidateId", "originalName", "analyzedName"]) {
    map[key] = firstParam(params[key as keyof WorkflowSearchParams]);
  }

  for (const [key, value] of Object.entries(map)) {
    if (value) redirectParams.set(key, value);
  }

  // If entry was candidate_to_workflow, update to candidate_to_agent_run
  if (redirectParams.get("entry") === "candidate_to_workflow") {
    redirectParams.set("entry", "candidate_to_agent_run");
  }

  const query = redirectParams.toString();
  redirect(query ? `/agent/run?${query}` : "/agent/run");
}
