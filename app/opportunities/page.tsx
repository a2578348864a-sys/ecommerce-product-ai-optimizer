import type { Metadata } from "next";
import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";
import { OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE } from "@/lib/opportunityDecisionDeskVisualFixture";

export const metadata: Metadata = {
  title: "机会雷达 - 轻选 Agent",
  description: "批量导入候选商品，自动分析筛选，生成推荐排行榜和人工确认清单。",
};

export default function OpportunitiesPage() {
  const visualFixture = process.env.NODE_ENV === "development"
    && process.env.OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE === "1"
    ? OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE
    : undefined;
  return <OpportunitiesForm visualFixture={visualFixture} />;
}
