import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

export const metadata: Metadata = {
  title: "商品研究已迁移 - 轻选 Agent",
  description: "商品研究入口已迁移到商品研究池，从这里开始三阶段商品研究。",
};

/**
 * R1: 旧 Agent 能力页归档。研究入口统一收敛到商品研究池候选详情页。
 */
export default function AgentPage() {
  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">已迁移</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                商品研究已迁移
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                商品研究现在从商品研究池开始：选择候选商品，依次完成商品理解、市场研究和创作准备。
              </p>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="surface-card p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="linear-icon size-10 shrink-0 rounded-xl bg-teal-50 text-teal-600">
                <Sparkles className="size-5" />
              </span>
              <div>
                <p className="text-base font-semibold text-slate-800">
                  旧版 Agent 路线图已停止维护
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  AI 只负责整理与建议，不代替供应商、成本、合规核验，最终决定始终由人工完成。
                  所有 AI 结论必须人工复核后保存。
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/opportunity-candidates"
                className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
              >
                前往商品研究池
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/"
                className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
              >
                返回工作台
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
