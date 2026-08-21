import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { RunConsoleClient } from "@/components/v4/RunConsoleClient";
import { V4DisabledPlaceholder } from "@/components/v4/V4DisabledPlaceholder";
import { isV4GraphEnabled } from "@/lib/v4/featureFlag";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "V4 研究任务详情 - 轻选工作台",
  description: "查看单个 V4 研究任务的阶段总览、节点、下一步需要谁做什么、预算、错误与人工中断。",
};

type V4RunDetailPageProps = {
  params: Promise<{ runId: string }>;
};

export default async function V4RunDetailPage({ params }: V4RunDetailPageProps) {
  const { runId } = await params;
  const normalized = runId.trim().slice(0, 128);
  const enabled = isV4GraphEnabled();

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0">
          <div className="workspace-header page-header space-y-4">
            <header className="space-y-3">
              <p className="eyebrow">V4 研究任务 · Run Console</p>
              <div>
                <h1 className="section-title text-2xl sm:text-3xl">研究任务详情</h1>
                <p className="mt-2 text-sm text-slate-600">任务 {normalized} 的阶段总览、当前节点、下一步需要谁做什么、预算与人工中断。</p>
              </div>
            </header>
            <WorkspaceMobileNav />
          </div>
          <div className="mt-4">{enabled ? <RunConsoleClient runId={normalized} /> : <V4DisabledPlaceholder />}</div>
        </div>
      </div>
    </main>
  );
}
