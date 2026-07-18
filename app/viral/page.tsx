import type { Metadata } from "next";
import { ViralMockAgent } from "@/components/ViralMockAgent";

export const metadata: Metadata = {
  title: "海外爆款趋势拆解 - 轻选 Agent",
  description: "拆解海外商品与内容趋势。AI 辅助判断，关键动作由人工确认。",
};

export default function ViralPage() {
  return <ViralMockAgent />;
}
