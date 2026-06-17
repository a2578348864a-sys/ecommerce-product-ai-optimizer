import type { Metadata } from "next";
import { SummaryForm } from "@/components/cross-border/SummaryForm";

export const metadata: Metadata = {
  title: "小白结论 - 轻选 Agent",
  description: "汇总分析结果，AI 用大白话告诉你这个品能不能做、为什么、下一步怎么试。",
};

export default function SummaryPage() {
  return <SummaryForm />;
}
