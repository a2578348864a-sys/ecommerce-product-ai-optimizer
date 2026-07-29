import type { Metadata } from "next";
import { AgentRunClient } from "@/components/agent/AgentRunClient";

export const metadata: Metadata = {
  title: "商品研究 - 轻选 Agent",
  description: "分三阶段理解商品、研究市场并准备 Listing 与图片方案，最终由人工确认。",
};

type AgentRunSearchParams = {
  product?: string | string[];
  productName?: string | string[];
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
    ? safeDecode(firstParam(params.candidateId))?.trim().slice(0, 80) || undefined
    : undefined;
  const initialProductName = candidateMode
    ? undefined
    : safeDecode(firstParam(params.productName))
      || safeDecode(firstParam(params.product));

  return (
    <AgentRunClient
      candidateMode={candidateMode}
      candidateId={candidateId}
      initialProductName={initialProductName}
    />
  );
}
