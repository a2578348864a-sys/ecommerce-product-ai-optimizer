import type { Metadata } from "next";
import { WorkspacePlaceholderPage } from "@/components/WorkspacePlaceholderPage";

export const metadata: Metadata = {
  title: "爆款拆解 - 轻选 Agent",
  description: "这里后续会放标题钩子、卖点强度、场景代入感和小红书内容潜力判断。",
};

export default function ViralPage() {
  return <WorkspacePlaceholderPage title="爆款拆解" description="这里后续会放标题钩子、卖点强度、场景代入感和小红书内容潜力判断。" />;
}
