import type { Metadata } from "next";
import { WorkspacePlaceholderPage } from "@/components/WorkspacePlaceholderPage";

export const metadata: Metadata = {
  title: "素材接收 - 轻选 Agent",
  description: "这里后续会放素材识别、截图整理和商品信息提取。现在先作为开发中入口，方便你知道这个模块在哪里。",
};

export default function MaterialsPage() {
  return <WorkspacePlaceholderPage title="素材接收" description="这里后续会放素材识别、截图整理和商品信息提取。现在先作为开发中入口，方便你知道这个模块在哪里。" />;
}
