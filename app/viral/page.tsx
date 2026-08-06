import type { Metadata } from "next";
import { LegacyMigratedPage } from "@/components/LegacyMigratedPage";

export const metadata: Metadata = {
  title: "海外爆款趋势拆解已迁移 - 轻选 Agent",
  description: "爆款拆解能力已并入商品研究主链。",
};

export default function ViralPage() {
  return (
    <LegacyMigratedPage
      pageName="海外爆款趋势拆解"
      description="商品趋势判断已并入商品研究流程，在研究结论中一并查看市场机会与竞争分析。"
    />
  );
}
