import type { Metadata } from "next";
import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";

export const metadata: Metadata = {
  title: "高级手工导入 - 轻选 Agent",
  description: "通过 URL、RSS 或 Sitemap 补充外部公开来源。",
};

export default function OpportunitiesImportPage() {
  return <OpportunitiesForm surface="advanced_import" />;
}
