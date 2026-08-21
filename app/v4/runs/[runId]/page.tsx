import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { RunConsoleClient } from "@/components/v4/RunConsoleClient";
import { V4DisabledPlaceholder } from "@/components/v4/V4DisabledPlaceholder";
import { isV4GraphEnabled } from "@/lib/v4/featureFlag";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "候选商品研究 - 轻选工作台",
  description: "查看候选商品的研究结论、市场与评论、货源与商品信息、成本与风险、Listing 与图片，以及操作记录。",
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
              <p className="eyebrow">V4 研究任务</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                候选商品研究：查看研究结论、市场与评论、货源与商品信息、成本与风险、Listing 与图片与操作记录。
              </p>
            </header>
            <WorkspaceMobileNav />
          </div>
          <div className="mt-4">{enabled ? <RunConsoleClient runId={normalized} /> : <V4DisabledPlaceholder />}</div>
        </div>
      </div>
    </main>
  );
}
