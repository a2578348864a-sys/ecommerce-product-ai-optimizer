import type { Metadata } from "next";
import { LegacyMigratedPage } from "@/components/LegacyMigratedPage";

export const metadata: Metadata = {
  title: "货源判断已迁移 - 轻选 Agent",
  description: "货源判断已并入商品研究流程。",
};

export default function SourcingPage() {
  return (
    <LegacyMigratedPage
      pageName="货源判断"
      description="货源可行性、价格带与新手可操作性已并入商品研究流程，研究结论中一并呈现。"
    />
  );
}
