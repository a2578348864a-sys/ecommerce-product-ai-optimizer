import type { Metadata } from "next";
import { TaskRecordsList } from "@/components/TaskRecordsList";

export const metadata: Metadata = {
  title: "决策复盘 - 轻选工作台",
  description: "查看商品开发决策报告与历史沉淀，跟进推进、暂缓与放弃项目。",
};

export default function TasksPage() {
  return <TaskRecordsList view="records" />;
}
