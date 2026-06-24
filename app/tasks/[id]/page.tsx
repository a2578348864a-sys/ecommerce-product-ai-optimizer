import type { Metadata } from "next";
import { TaskRecordDetail } from "@/components/TaskRecordDetail";

export const metadata: Metadata = {
  title: "运营跟进面板 - 轻选 Agent",
  description: "查看任务结论、风险、下一步动作、人工决策状态和确认提醒。",
};

type TaskDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { id } = await params;
  return <TaskRecordDetail id={id} />;
}
