import type { Metadata } from "next";
import Link from "next/link";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { SellerSpritePreviewPanel } from "@/components/cross-border/SellerSpritePreviewPanel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "卖家精灵美国站搜索结果导出预览 - 轻选工作台",
  description: "只读预览卖家精灵导出的 Amazon 美国站搜索结果 XLSX。",
};

export default function SellerSpritePreviewPage() {
  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0">
          <header className="workspace-header page-header space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <Link href="/opportunities" className="font-medium text-teal-700 hover:text-teal-800">
                发现商品
              </Link>
              <span aria-hidden="true">/</span>
              <span>卖家精灵数据导入</span>
            </div>
            <div className="space-y-3">
              <p className="eyebrow">卖家精灵美国站搜索结果导出</p>
              <div>
                <h1 className="section-title text-2xl sm:text-3xl">上传并选择 SellerSprite 商品</h1>
                <p className="mt-2 text-sm text-slate-600">
                  只支持卖家精灵导出的 Amazon 美国站搜索结果 XLSX；本页只做结构检查、异常隔离和人工选择。
                </p>
              </div>
              <p className="text-sm font-medium text-teal-800">只读预览，尚未进入商品研究池</p>
              <p className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm leading-6 text-amber-900">
                数据来自卖家精灵，不是 Amazon 官方导出；数值可能是第三方估算或时间点快照；不等于真实销量、利润、采购建议或商业结论。
              </p>
            </div>
            <WorkspaceMobileNav />
          </header>

          <div className="mt-4">
            <SellerSpritePreviewPanel />
          </div>
        </div>
      </div>
    </main>
  );
}
