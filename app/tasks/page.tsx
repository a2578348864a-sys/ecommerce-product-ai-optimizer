import type { Metadata } from "next";
import { TaskRecordsList } from "@/components/TaskRecordsList";

export const metadata: Metadata = {
  title: "任务中心 / 运营跟进台 - 轻选 Agent",
  description: "查看已保存的分析任务，继续复核、筛选和跟进，跨境电商运营全流程 Agent 工作台。",
};

export default function TasksPage() {
  return <TaskRecordsList />;
}
