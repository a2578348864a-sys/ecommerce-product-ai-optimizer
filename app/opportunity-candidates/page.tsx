import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { CandidatePoolPanel } from "@/components/cross-border/CandidatePoolView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "商品研究池 - 轻选工作台",
  description: "查看当前身份下已保存的 Candidate，并恢复商品研究。",
};

export default async function OpportunityCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const params = await searchParams;
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0">
          <header className="workspace-header page-header">
            <p className="eyebrow">商品身份保持 · 人工决定</p>
            <h1 className="section-title mt-2 text-2xl sm:text-3xl">商品研究池</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              这里展示当前登录身份的服务端 Candidate，是导入后恢复研究的统一入口。
            </p>
            <WorkspaceMobileNav />
          </header>
          <div className="mt-4">
            <CandidatePoolPanel manualMode={mode === "manual"} />
          </div>
        </div>
      </div>
    </main>
  );
}
