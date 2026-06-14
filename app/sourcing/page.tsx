import type { Metadata } from "next";
import { WorkspacePlaceholderPage } from "@/components/WorkspacePlaceholderPage";

export const metadata: Metadata = {
  title: "货源判断 - 轻选 Agent",
  description: "这里后续会放同款/平替货源线索、价格带和新手可操作性判断。",
};

export default function SourcingPage() {
  return <WorkspacePlaceholderPage title="货源判断" description="这里后续会放同款/平替货源线索、价格带和新手可操作性判断。" />;
}
