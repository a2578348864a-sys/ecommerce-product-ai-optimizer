import type { Metadata } from "next";
import { WorkspacePlaceholderPage } from "@/components/WorkspacePlaceholderPage";

export const metadata: Metadata = {
  title: "小白结论 - 轻选 Agent",
  description: "这里后续会汇总能不能做、为什么、下一步怎么试，不让你在一堆指标里迷路。",
};

export default function SummaryPage() {
  return <WorkspacePlaceholderPage title="小白结论" description="这里后续会汇总能不能做、为什么、下一步怎么试，不让你在一堆指标里迷路。" />;
}
