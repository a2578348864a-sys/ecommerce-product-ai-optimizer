import type { Metadata } from "next";
import { AgentRunClient } from "@/components/agent/AgentRunClient";

export const metadata: Metadata = {
  title: "商品研究 - 轻选 Agent",
  description: "分三阶段理解商品、研究市场并准备 Listing 与图片方案，最终由人工确认。",
};

type CandidateResearchPageProps = {
  params: Promise<{
    candidateId: string;
  }>;
};

/**
 * 商品研究权威页面（R1：/agent/run 迁移而来）。
 * 从商品研究池「开始／继续研究」进入；研究结束后保存任务并跳转研究历史。
 */
export default async function CandidateResearchPage({ params }: CandidateResearchPageProps) {
  const { candidateId } = await params;
  const normalized = candidateId.trim().slice(0, 80);

  return <AgentRunClient candidateMode candidateId={normalized} />;
}
