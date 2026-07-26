import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SellerSpriteOpportunityPreview } from "@/components/cross-border/SellerSpriteOpportunityPreview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SellerSprite 机会市场预览 - 轻选 Agent",
  description: "Owner 本地只读 SellerSprite XLSX 市场预筛能力。",
};

export default function SellerSpriteOpportunityPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SellerSpriteOpportunityPreview />;
}
