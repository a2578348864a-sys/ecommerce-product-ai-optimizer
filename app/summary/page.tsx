import type { Metadata } from "next";
import { LegacyMigratedPage } from "@/components/LegacyMigratedPage";

export const metadata: Metadata = {
  title: "结论汇总已迁移 - 轻选工作台",
  description: "结论汇总已并入商品研究流程。",
};

export default function SummaryPage() {
  return (
    <LegacyMigratedPage
      pageName="结论汇总"
      description="商品能不能做、为什么、下一步怎么试，已并入商品研究结论，由你确认后保存到研究历史。"
    />
  );
}
