import type { Metadata } from "next";
import { TaskRecordsList } from "@/components/TaskRecordsList";

export const metadata: Metadata = {
  title: "商品研究记录 - 轻选工作台",
  description: "按商品查看已保存的研究结论、风险、证据缺口、人工决定和历史成果。",
};

export default function TasksPage() {
  return <TaskRecordsList />;
}
