import type { Metadata } from "next";
import Link from "next/link";
import { ProductProfitForm } from "@/components/cross-border/ProductProfitForm";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

export const metadata: Metadata = {
  title: "利润试算 - 轻选 Agent",
  description: "辅助工具：填写跨境商品基础信息，用程序公式实时测算成本、售价和利润。",
};

export default function NewProductPage() {
  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="min-w-0">
          <div className="workspace-header mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">轻选工作台</p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">利润试算</h1>
                <p className="mt-1 text-sm muted-text">辅助工具：只做利润测算，主链路请先去单品分析。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/"
                  className="linear-button inline-flex h-10 items-center px-4 text-sm font-semibold"
                >
                  ← 返回工作台
                </Link>
                <Link
                  href="/workflow"
                  className="linear-button-primary inline-flex h-10 items-center px-4 text-sm font-semibold"
                >
                  去单品分析
                </Link>
              </div>
            </div>
            <WorkspaceMobileNav />
          </div>

          <section className="mb-6 overflow-hidden surface-card-strong">
          <div className="border-b border-slate-100 px-6 py-6">
            <p className="text-sm font-semibold text-teal-700">开始试算</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">填写商品成本和预期售价</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 muted-text">
              先用程序公式测算成本、售价、利润和风险提示。当前页面只是辅助试算草稿，不会保存数据、
              不会调用 AI、不会自动上架；完整选品判断请回到单品分析主链路。
            </p>
          </div>
          <div className="border-t border-slate-100 px-6 py-4 text-sm leading-6 text-slate-600">
            数字由本地公式计算，刷新后不会保存；试算结果只用于人工判断。
          </div>
          </section>

          <ProductProfitForm />
        </div>
      </div>
    </main>
  );
}
