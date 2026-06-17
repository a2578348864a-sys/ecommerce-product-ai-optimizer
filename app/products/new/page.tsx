import type { Metadata } from "next";
import Link from "next/link";
import { ProductProfitForm } from "@/components/cross-border/ProductProfitForm";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

export const metadata: Metadata = {
  title: "跨境商品利润测算 - 轻选 Agent",
  description: "填写跨境商品基础信息，用程序公式实时测算成本、售价和利润。",
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
                <p className="eyebrow">Qingxuan Workspace</p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">选品体检</h1>
                <p className="mt-1 text-sm muted-text">这里是跨境商品利润测算入口。</p>
              </div>
              <Link
                href="/"
                className="linear-button inline-flex h-10 items-center px-4 text-sm font-semibold"
              >
                ← 返回工作台
              </Link>
            </div>
            <WorkspaceMobileNav />
          </div>

          <section className="mb-6 overflow-hidden surface-card-strong">
          <div className="border-b border-slate-100 px-6 py-6">
            <p className="text-sm font-semibold text-teal-700">新建商品分析</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">跨境商品利润测算</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 muted-text">
              先用程序公式测算成本、售价、利润和风险提示。当前页面只是利润测算草稿，不会保存数据、
              不会调用 AI、不会自动上架；后续再接 AI 选品分析、上架文案和历史记录。
            </p>
          </div>
          <div className="grid gap-3 px-6 py-4 text-sm sm:grid-cols-3">
            <div className="surface-card-soft rounded-[22px] px-4 py-3">
              <p className="font-semibold text-slate-900">程序公式优先</p>
              <p className="mt-1 leading-6 muted-text">利润数字由本地函数计算，不交给 AI 猜。</p>
            </div>
            <div className="surface-card-soft rounded-[22px] px-4 py-3">
              <p className="font-semibold text-slate-900">不会保存数据</p>
              <p className="mt-1 leading-6 muted-text">刷新页面后输入内容不会写入数据库。</p>
            </div>
            <div className="surface-card-soft rounded-[22px] px-4 py-3">
              <p className="font-semibold text-slate-900">不做自动上架</p>
              <p className="mt-1 leading-6 muted-text">这里只辅助判断，最终仍由你人工确认。</p>
            </div>
          </div>
          </section>

          <ProductProfitForm />
        </div>
      </div>
    </main>
  );
}
