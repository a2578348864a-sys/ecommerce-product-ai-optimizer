import type { Metadata } from "next";
import { LegacyMigratedPage } from "@/components/LegacyMigratedPage";

export const metadata: Metadata = {
  title: "素材接收已迁移 - 轻选 Agent",
  description: "素材整理已并入商品研究流程。",
};

export default function MaterialsPage() {
  return (
    <LegacyMigratedPage
      pageName="素材接收"
      description="商品信息整理已并入商品研究流程，在商品研究中完成理解、市场研究和创作准备。"
    />
  );
}
