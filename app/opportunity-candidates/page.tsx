import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { CandidatePoolPanel } from "@/components/cross-border/CandidatePoolView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "商品研究 - 轻选工作台",
  description: "待研判商品候选池，挑选高潜标的进入商品决策研判。",
};

export default async function OpportunityCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[]; view?: string | string[]; candidateId?: string | string[] }>;
}) {
  const params = await searchParams;
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  const candidateId = Array.isArray(params.candidateId) ? params.candidateId[0] : params.candidateId;

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0">
          <header className="workspace-header page-header">
            <p className="eyebrow">核心流程 02 · 商品研究队列</p>
            <h1 className="section-title mt-2 text-2xl sm:text-3xl">商品研究</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              待研判候选商品池。挑选高潜标的进入四阶段研判，系统聚合需求、供应链与风险证据以辅助拍板；决策完成后方可生成后续资产。
            </p>
            <WorkspaceMobileNav />
          </header>
          <div className="mt-4">
            <CandidatePoolPanel manualMode={mode === "manual"} startableOnly={view === "startable"} focusCandidateId={candidateId?.trim() || null} />
          </div>
        </div>
      </div>
    </main>
  );
}
