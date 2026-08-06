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
 * R1: /workflow（旧 4 步「单品一键分析」）重定向到商品研究池候选详情页。
 * 候选模式保留 candidateId；非候选模式回到研究池由用户选择候选。
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

  const candidateId = firstParam(params.candidateId);
  if (candidateId && redirectParams.get("source") === "opportunity") {
    redirect(`/opportunity-candidates/${encodeURIComponent(candidateId.trim().slice(0, 80))}`);
  }

  redirect("/opportunity-candidates");
}
