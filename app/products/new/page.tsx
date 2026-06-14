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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.14),transparent_32rem),linear-gradient(180deg,#f8fcfb_0%,#f4f8fb_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1540px] gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        <WorkspaceSidebar />

        <div className="min-w-0">
          <div className="mb-4 rounded-[28px] border border-white/80 bg-white/90 px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600">Qingxuan Workspace</p>
                <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950">选品体检</h1>
                <p className="mt-1 text-sm text-slate-500">这里是跨境商品利润测算入口。</p>
              </div>
              <Link
                href="/"
                className="inline-flex h-10 items-center rounded-full border border-teal-100 bg-white px-4 text-sm font-semibold text-teal-700 shadow-sm transition hover:border-teal-200 hover:text-teal-800"
              >
                ← 返回工作台
              </Link>
            </div>
            <WorkspaceMobileNav />
          </div>

          <section className="mb-6 overflow-hidden rounded-[32px] border border-white/80 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.07)]">
          <div className="border-b border-slate-100 px-6 py-6">
            <p className="text-sm font-semibold text-teal-700">新建商品分析</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">跨境商品利润测算</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              先用程序公式测算成本、售价、利润和风险提示。当前页面只是利润测算草稿，不会保存数据、
              不会调用 AI、不会自动上架；后续再接 AI 选品分析、上架文案和历史记录。
            </p>
          </div>
          <div className="grid gap-3 px-6 py-4 text-sm text-slate-600 sm:grid-cols-3">
            <div className="rounded-2xl border border-teal-100 bg-teal-50/70 px-4 py-3">
              <p className="font-semibold text-slate-900">程序公式优先</p>
              <p className="mt-1 leading-6">利润数字由本地函数计算，不交给 AI 猜。</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="font-semibold text-slate-900">不会保存数据</p>
              <p className="mt-1 leading-6">刷新页面后输入内容不会写入数据库。</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="font-semibold text-slate-900">不做自动上架</p>
              <p className="mt-1 leading-6">这里只辅助判断，最终仍由你人工确认。</p>
            </div>
          </div>
          </section>

          <ProductProfitForm />
        </div>
      </div>
    </main>
  );
}
