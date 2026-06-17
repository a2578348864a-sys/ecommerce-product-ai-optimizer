import type { Metadata } from "next";
import { ViralMockAgent } from "@/components/ViralMockAgent";

export const metadata: Metadata = {
  title: "海外爆款趋势拆解 - 轻选 Agent",
  description: "针对 TikTok、Amazon、Etsy、Shopify 等海外平台的爆款商品与内容趋势半自动拆解工具。",
};

export default function ViralPage() {
  return <ViralMockAgent />;
}
