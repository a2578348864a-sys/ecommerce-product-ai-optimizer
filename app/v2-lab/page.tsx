import type { Metadata } from "next";
import V2WorkflowLabClient from "@/components/cross-border/V2WorkflowLabClient";

export const metadata: Metadata = {
  title: "V2 工作流沙盒 - 轻选 Agent",
  description: "V2 工作流原型，Phase 1B 只读已有机会雷达记录，不调用新 AI。",
};

export default function V2LabPage() {
  return <V2WorkflowLabClient />;
}
