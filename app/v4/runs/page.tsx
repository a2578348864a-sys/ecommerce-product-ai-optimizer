import type { Metadata } from "next";
import Link from "next/link";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { RunListClient } from "@/components/v4/RunListClient";
import { V4DisabledPlaceholder } from "@/components/v4/V4DisabledPlaceholder";
import { isV4GraphEnabled } from "@/lib/v4/featureFlag";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "研究记录 - 轻选工作台",
  description: "查看每次商品研究的当前状态、最重要缺口与下一步动作。",
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
              <p className="eyebrow">商品研究</p>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="section-title text-2xl sm:text-3xl">研究记录</h1>
                  <p className="mt-2 text-sm text-slate-600">每次研究的状态与下一步都在这里。</p>
                </div>
                <Link
                  href="/opportunity-candidates"
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
                >
                  <span aria-hidden>＋</span>
                  开始商品研究
                </Link>
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
