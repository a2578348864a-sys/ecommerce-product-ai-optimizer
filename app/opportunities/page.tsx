import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ProductBatchManager } from "@/components/cross-border/ProductBatchManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "商品发现 - 轻选工作台",
  description: "上传商品数据，建立待研究候选池。",
};

export default function OpportunitiesPage() {
  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0">
          <div className="workspace-header page-header space-y-4">
            <header className="space-y-3">
              <p className="eyebrow">核心流程 01 · 导入商品数据</p>
              <div>
                <h1 className="section-title text-2xl sm:text-3xl">商品发现</h1>
                <p className="mt-2 text-sm text-slate-600">
                  上传商品数据或选品报表，建立待研究候选池，挑选高潜标的进入决策研判。
                </p>
              </div>
            </header>
            <WorkspaceMobileNav />
          </div>
          <div className="mt-4">
            <ProductBatchManager />
          </div>
        </div>
      </div>
    </main>
  );
}
