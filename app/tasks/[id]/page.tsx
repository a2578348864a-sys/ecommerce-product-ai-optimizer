import type { Metadata } from "next";
import { TaskRecordDetail } from "@/components/TaskRecordDetail";

export const metadata: Metadata = {
  title: "任务详情 - 轻选 Agent",
  description: "查看任务详情、AI 分析结果、下一步建议和人工确认清单。",
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
