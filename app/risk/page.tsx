import type { Metadata } from "next";
import { WorkspacePlaceholderPage } from "@/components/WorkspacePlaceholderPage";

export const metadata: Metadata = {
  title: "风险排查 - 轻选 Agent",
  description: "这里后续会放侵权、功效宣称、售后、带电、大件和敏感类目风险检查。",
};

export default function RiskPage() {
  return <WorkspacePlaceholderPage title="风险排查" description="这里后续会放侵权、功效宣称、售后、带电、大件和敏感类目风险检查。" />;
}
