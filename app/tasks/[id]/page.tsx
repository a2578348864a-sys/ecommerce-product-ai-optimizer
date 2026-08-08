import type { Metadata } from "next";
import { TaskRecordDetail } from "@/components/TaskRecordDetail";

export const metadata: Metadata = {
  title: "商品研究记录 - 轻选工作台",
  description: "查看单个商品的研究结论、风险、证据缺口、人工决定和历史成果。",
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
