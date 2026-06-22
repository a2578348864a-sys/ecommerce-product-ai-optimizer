import type { Metadata } from "next";
import { ViralMockAgent } from "@/components/ViralMockAgent";

export const metadata: Metadata = {
  title: "海外爆款趋势拆解 - 轻选 Agent",
  description: "服务于全自动电商 Agent Alpha MVP 的爆款商品与内容趋势拆解能力。",
};

export default function ViralPage() {
  return <ViralMockAgent />;
}
