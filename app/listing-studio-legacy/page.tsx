import Link from "next/link";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ListingStudioClient } from "@/components/listing-studio/ListingStudioClient";
import styles from "@/components/listing-studio/ListingStudioPolish.module.css";

/**
 * Legacy Listing Studio (V4). Kept reachable as a low-cost rollback target after
 * the V5 cutover. Not linked from the workspace navigation.
 *
 * Deliberately NOT deleted: the rollback target must stay usable. It is marked
 * deprecated in the UI (2026-09 closeout) so a direct URL visit cannot be mistaken
 * for the supported product path, which runs through the V5 chain.
 */

type ListingStudioLegacyPageProps = {
  searchParams?: Promise<{ taskId?: string | string[] }>;
};

export default async function ListingStudioLegacyPage({ searchParams }: ListingStudioLegacyPageProps) {
  const params = await searchParams;
  const taskIdValue = Array.isArray(params?.taskId) ? params.taskId[0] : params?.taskId;
  const taskId = taskIdValue?.trim().slice(0, 200) || "";
  const sourceLabel = taskId ? "来自研究记录" : "独立创作";

  return (
    <main className="app-shell listing-studio-page">
      <div className="workspace-page workspace-layout listing-studio-frame">
        <WorkspaceSidebar />
        <div className="listing-studio-main min-w-0">
          <header className="workspace-header page-header listing-studio-header">
            <div className={`studio-header-row ${styles.header}`}>
              <div className={styles.headerCopy}>
                <p className={styles.headerEyebrow}>AI Content Workspace · Legacy</p>
                <div className="flex flex-wrap items-center gap-3">
                  <h1>Listing Studio (Legacy)</h1>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                    {sourceLabel}
                  </span>
                </div>
                <p>
                  {taskId
                    ? "基于服务端重新核验的研究事实生成 Listing 草稿。"
                    : "输入并确认商品资料，生成可审核、可优化的 Listing 草稿。"}
                </p>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>
          <div
            data-testid="listing-studio-legacy-deprecated"
            className="mx-4 mt-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:mx-6"
          >
            <div className="min-w-0">
              <p className="font-semibold">已弃用（Deprecated）· V4 旧版编辑器，仅供回滚与历史对照</p>
              <p className="mt-1 text-xs leading-5">
                此页面不经过 V5 的 Validator、证据绑定与人工复核门禁，生成结果不代表当前产品链路的交付质量。
                正式使用请前往新版 Listing Studio。
              </p>
            </div>
            <Link
              href={taskId ? `/listing-studio?taskId=${encodeURIComponent(taskId)}` : "/listing-studio"}
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
            >
              前往新版 Listing Studio →
            </Link>
          </div>
          <ListingStudioClient taskId={taskId} />
        </div>
      </div>
    </main>
  );
}
