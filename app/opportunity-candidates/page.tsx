import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { CandidatePoolPanel } from "@/components/cross-border/CandidatePoolView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "待研究商品 - 轻选工作台",
  description: "查看当前身份下已加入研究的商品，并继续商品研究。",
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
            <p className="eyebrow">商品身份保持 · 人工决定</p>
            <h1 className="section-title mt-2 text-2xl sm:text-3xl">待研究商品</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              这里展示当前登录身份下已加入研究的商品。你可以继续研究，或查看已保存的研究记录。
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
