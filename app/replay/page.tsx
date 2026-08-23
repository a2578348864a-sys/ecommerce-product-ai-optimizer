import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { PublicCasePage } from "@/components/v4/showcase/PublicCasePage";
import { loadPublicShowcaseCase } from "@/lib/public-showcase/case";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "完整商品研究案例 - 轻选工作台",
  description: "一个真实、完整、带图片脱敏商品研究案例：市场机会、买家需求、供应匹配、成本风险、人工决定与 Listing 草稿。",
};

/**
 * 公网 HR 演示收口：/replay 现为「完整商品研究案例」页（旧链接继续可用）。
 */
export default function ReplayPage() {
  const data = loadPublicShowcaseCase();
  return (
    <div className="workspace-page workspace-layout">
      <WorkspaceMobileNav />
      <WorkspaceSidebar />
      <div className="app-shell px-4 py-6 sm:px-6 lg:px-8">
        <PublicCasePage data={data} />
      </div>
    </div>
  );
}
