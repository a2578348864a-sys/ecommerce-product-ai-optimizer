import type { Metadata } from "next";
import { WorkspacePlaceholderPage } from "@/components/WorkspacePlaceholderPage";

export const metadata: Metadata = {
  title: "任务记录 - 轻选 Agent",
  description: "这里后续会放本地选品档案、历史分析和待办记录。",
};

export default function TasksPage() {
  return <WorkspacePlaceholderPage title="任务记录" description="这里后续会放本地选品档案、历史分析和待办记录。" />;
}
