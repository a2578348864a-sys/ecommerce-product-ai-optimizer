import type { Metadata } from "next";
import { TaskRecordsList } from "@/components/TaskRecordsList";

export const metadata: Metadata = {
  title: "研究记录 - 轻选工作台",
  description: "已经形成历史结果的研究：已完成、已放弃与旧版记录。",
};

export default function TasksPage() {
  return <TaskRecordsList view="records" />;
}
