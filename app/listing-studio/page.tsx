import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ListingStudioV5Client } from "@/components/listing-v5/ListingStudioV5Client";

type ListingStudioPageProps = {
  searchParams?: Promise<{ taskId?: string | string[] }>;
};

/**
 * Primary Listing Studio. Since the V5 cutover this route renders the single V5
 * experience; `/listing-studio-v5` redirects here so only one implementation
 * ships. The previous implementation remains available at
 * `/listing-studio-legacy` for rollback.
 */
export default async function ListingStudioPage({ searchParams }: ListingStudioPageProps) {
  const params = await searchParams;
  const raw = Array.isArray(params?.taskId) ? params.taskId[0] : params?.taskId;
  const taskId = raw?.trim().slice(0, 200) || "";
  const sourceLabel = taskId ? "来自商品决策记录" : "独立准备";

  return (
    <main className="app-shell listing-studio-page">
      <div className="workspace-page workspace-layout listing-studio-frame">
        <WorkspaceSidebar />
        <div className="listing-studio-main min-w-0">
          <header className="workspace-header page-header listing-studio-header">
            <div className="studio-header-row">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  决策后续辅助工具
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">Listing Studio</h1>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-xs font-bold text-emerald-700">
                    {sourceLabel}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {taskId
                    ? "基于已通过决策的商品记录与研判事实生成 Listing 草稿，发布前需人工复核。"
                    : "决策完成后的辅助工具：输入并确认商品资料，生成 Listing 草稿；不替代商品决策。"}
                </p>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>
          <ListingStudioV5Client taskId={taskId} />
        </div>
      </div>
    </main>
  );
}
