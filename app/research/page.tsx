import type { Metadata } from "next";
import { TaskRecordsList } from "@/components/TaskRecordsList";

export const metadata: Metadata = {
  title: "商品研究 - 轻选工作台",
  description: "继续正在进行或等待补充资料的商品研究。",
};

export default function ResearchPage() {
  return <TaskRecordsList view="research" />;
}
