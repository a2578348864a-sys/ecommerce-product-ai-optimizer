import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { RunListClient } from "@/components/v4/RunListClient";
import { V4DisabledPlaceholder } from "@/components/v4/V4DisabledPlaceholder";
import { isV4GraphEnabled } from "@/lib/v4/featureFlag";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "V4 研究任务 - 轻选工作台",
  description: "查看 V4 研究任务列表、当前节点、下一步人工动作、预算与中断恢复。",
};

export default function V4RunsPage() {
  const enabled = isV4GraphEnabled();

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0">
          <div className="workspace-header page-header space-y-4">
            <header className="space-y-3">
              <p className="eyebrow">V4 研究任务 · 运行状态</p>
              <div>
                <h1 className="section-title text-2xl sm:text-3xl">研究任务</h1>
                <p className="mt-2 text-sm text-slate-600">查看各次 V4 研究任务的状态、当前节点、下一步人工动作、预算与人工中断。</p>
              </div>
            </header>
            <WorkspaceMobileNav />
          </div>
          <div className="mt-4">{enabled ? <RunListClient /> : <V4DisabledPlaceholder />}</div>
        </div>
      </div>
    </main>
  );
}
