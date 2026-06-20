import type { Metadata } from "next";
import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";

export const metadata: Metadata = {
  title: "机会雷达 - 轻选 Agent",
  description: "批量导入候选商品，自动分析筛选，生成推荐排行榜和人工确认清单。",
};

export default function OpportunitiesPage() {
  return <OpportunitiesForm />;
}
