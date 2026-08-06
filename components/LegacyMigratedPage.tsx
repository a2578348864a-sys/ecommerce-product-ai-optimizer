import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

/**
 * R1: 遗留功能迁移提示页。
 * 旧流程页面（爆款拆解/素材/风险/货源/结论/利润试算）不再作为独立可操作流程；
 * 对应能力已并入商品研究主链。组件与后端能力保留，仅收敛用户入口。
 */
export function LegacyMigratedPage({
  pageName,
  description,
}: {
  pageName: string;
  description: string;
}) {
  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">已迁移</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                {pageName}
              </h1>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="surface-card p-5 sm:p-6">
            <p className="text-base font-semibold text-slate-800">该功能已并入商品研究主链</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              研究从发现商品开始，结论、风险与利润均在同一研究流程中完成，最终由人工确认后保存到研究历史。
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/opportunity-candidates"
                className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
              >
                前往商品研究池
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/tasks"
                className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
              >
                查看研究历史
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
