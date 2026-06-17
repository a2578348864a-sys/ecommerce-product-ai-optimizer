import type { Metadata } from "next";
import { RiskCheckForm } from "@/components/cross-border/RiskCheckForm";

export const metadata: Metadata = {
  title: "风险排查 - 轻选 Agent",
  description: "检查跨境商品的侵权、功效宣称、品类、物流和售后风险。",
};

export default function RiskPage() {
  return <RiskCheckForm />;
}
