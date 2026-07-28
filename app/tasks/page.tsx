import type { Metadata } from "next";
import { TaskRecordsList } from "@/components/TaskRecordsList";

export const metadata: Metadata = {
  title: "商品研究历史 - 轻选 Agent",
  description: "按商品查看已保存的研究阶段、真实产物、人工结论和下一步动作。",
};

export default function TasksPage() {
  return <TaskRecordsList />;
}
