import type { Metadata } from "next";
import { SourcingForm } from "@/components/cross-border/SourcingForm";

export const metadata: Metadata = {
  title: "货源判断 - 轻选 Agent",
  description: "根据商品信息判断货源可行性、1688 搜索词、价格带和新手可操作性。",
};

export default function SourcingPage() {
  return <SourcingForm />;
}
