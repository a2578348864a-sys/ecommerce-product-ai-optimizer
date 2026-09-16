import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ProductBatchManager } from "@/components/cross-border/ProductBatchManager";
import { OpportunityAnalysisPanel } from "@/components/cross-border/OpportunityAnalysisPanel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "发现商品 - 轻选工作台",
  description: "用商品机会分析实验入口生成待研究的候选方向，或上传卖家精灵报表导入商品。",
};

export default function OpportunitiesPage() {
  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0">
          <div className="workspace-header page-header space-y-4">
            <header className="space-y-3">
              <p className="eyebrow">发现商品 · 选择要研究的商品</p>
              <div>
                <h1 className="section-title text-2xl sm:text-3xl">发现商品</h1>
                <p className="mt-2 text-sm text-slate-600">
                  上传卖家精灵报表，查看导入的商品，选择要进入研究的目标。
                </p>
              </div>
            </header>
            <WorkspaceMobileNav />
          </div>
          {/* 实验模式入口：商品机会分析（Spike，V0 不接外部数据源，只生成待验证候选方向） */}
          <div className="mt-4">
            <OpportunityAnalysisPanel />
          </div>
          <div className="mt-4">
            <ProductBatchManager />
          </div>
        </div>
      </div>
    </main>
  );
}
