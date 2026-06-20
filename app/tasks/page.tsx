import type { Metadata } from "next";
import { TaskRecordsList } from "@/components/TaskRecordsList";

export const metadata: Metadata = {
  title: "任务工作流中心 - 轻选 Agent",
  description: "沉淀每次选品分析、风险判断和下一步动作，支持人工确认和多 Agent 工作流扩展。",
};

export default function TasksPage() {
  return <TaskRecordsList />;
}
