import type { Metadata } from "next";
import { TaskRecordsList } from "@/components/TaskRecordsList";

export const metadata: Metadata = {
  title: "运营任务中心 - 轻选 Agent",
  description: "沉淀每次机会发现、商品分析、人工复核和下一步运营动作，跨境电商运营全流程 Agent 工作台。",
};

export default function TasksPage() {
  return <TaskRecordsList />;
}
