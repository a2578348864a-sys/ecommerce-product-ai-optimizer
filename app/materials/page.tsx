import type { Metadata } from "next";
import { MaterialsForm } from "@/components/cross-border/MaterialsForm";

export const metadata: Metadata = {
  title: "素材接收 - 轻选 Agent",
  description: "粘贴商品链接、截图描述或选品想法，AI 自动提取商品信息。",
};

export default function MaterialsPage() {
  return <MaterialsForm />;
}
