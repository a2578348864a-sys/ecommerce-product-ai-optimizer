import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ProductBatchManager } from "@/components/cross-border/ProductBatchManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "发现商品 - 轻选 Agent",
  description: "上传卖家精灵报表、管理商品批次并决定下一步研究哪些商品。",
};

export default function OpportunitiesPage() {
  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0">
          <div className="workspace-header page-header space-y-4">
            <header className="space-y-3">
              <p className="eyebrow">发现商品 · 运营入口</p>
              <div>
                <h1 className="section-title text-2xl sm:text-3xl">发现商品</h1>
                <p className="mt-2 text-sm text-slate-600">
                  上传卖家精灵报表，管理商品批次，并决定下一步研究哪些商品。
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
