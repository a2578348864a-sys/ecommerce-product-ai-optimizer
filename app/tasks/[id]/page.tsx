import type { Metadata } from "next";
import { TaskRecordDetail } from "@/components/TaskRecordDetail";

export const metadata: Metadata = {
  title: "商品研究结果 - 轻选工作台",
  description: "查看单个商品的当前研究阶段、已有产物、人工核验项和下一步动作。",
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
