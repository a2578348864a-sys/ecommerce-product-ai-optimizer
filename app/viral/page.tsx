import type { Metadata } from "next";
import { ViralMockAgent } from "@/components/ViralMockAgent";

export const metadata: Metadata = {
  title: "海外爆款趋势拆解 - 轻选 Agent",
  description: "服务于跨境电商运营 Agent 工作台 Alpha MVP 的爆款商品与内容趋势拆解能力。AI 辅助判断，关键动作人工确认。",
};

export default function ViralPage() {
  return <ViralMockAgent />;
}
