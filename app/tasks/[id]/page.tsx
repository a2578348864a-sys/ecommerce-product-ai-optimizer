import type { Metadata } from "next";
import { TaskRecordDetail } from "@/components/TaskRecordDetail";

export const metadata: Metadata = {
  title: "任务详情 - 轻选 Agent",
  description: "查看单条爆款拆解任务记录的输入内容和完整分析结果。",
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
