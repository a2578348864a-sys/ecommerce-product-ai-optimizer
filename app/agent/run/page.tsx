import { redirect } from "next/navigation";

/**
 * R1: /agent/run 已迁移。研究运行入口收敛到商品研究池候选详情页
 * （/opportunity-candidates/[candidateId]）。旧 URL 仅保留安全重定向，
 * 不再渲染独立页面；query 参数中仅保留 candidateId（研究上下文由
 * research-context API 服务端加载，不依赖 URL 传递敏感字段）。
 */
type AgentRunSearchParams = {
  source?: string | string[];
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

export default async function AgentRunPage({
  searchParams,
}: {
  searchParams: Promise<AgentRunSearchParams>;
}) {
  const params = await searchParams;
  const candidateMode = firstParam(params.source) === "opportunity";
  const candidateId = candidateMode
    ? safeDecode(firstParam(params.candidateId))?.trim().slice(0, 80)
    : undefined;

  if (candidateMode && candidateId) {
    redirect(`/opportunity-candidates/${encodeURIComponent(candidateId)}`);
  }

  // 非候选模式（旧临时分析入口）：回到研究池，由用户从候选继续
  redirect("/opportunity-candidates");
}
