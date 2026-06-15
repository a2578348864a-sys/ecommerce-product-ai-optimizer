import type { Metadata } from "next";
import { TaskRecordsList } from "@/components/TaskRecordsList";

export const metadata: Metadata = {
  title: "任务记录 - 轻选 Agent",
  description: "这里后续会放本地选品档案、历史分析和待办记录。",
};

export default function TasksPage() {
  return <TaskRecordsList />;
}
