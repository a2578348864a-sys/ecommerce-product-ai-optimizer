import type { Metadata } from "next";
import { ShowcasePage } from "@/components/showcase/ShowcasePage";

export const metadata: Metadata = {
  title: "轻选工作台｜Evidence-driven AI Commerce Workbench - 项目展示",
  description:
    "面向跨境电商商品研究与 Amazon 上架准备，把商品研究、证据整理、人工事实确认、Listing 与图片创作收成一条可复核的工作流。",
};

export default function Page() {
  return <ShowcasePage />;
}
