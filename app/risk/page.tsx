import type { Metadata } from "next";
import { LegacyMigratedPage } from "@/components/LegacyMigratedPage";

export const metadata: Metadata = {
  title: "风险排查已迁移 - 轻选工作台",
  description: "风险排查已并入商品研究流程。",
};

export default function RiskPage() {
  return (
    <LegacyMigratedPage
      pageName="风险排查"
      description="合规、侵权、物流与售后风险已并入商品研究流程，研究结论中一并呈现并提示人工核验。"
    />
  );
}
