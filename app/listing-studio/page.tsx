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
  return (
    <main className="app-shell listing-studio-page">
      <div className="workspace-page workspace-layout listing-studio-frame">
        <WorkspaceSidebar />
        <div className="listing-studio-main min-w-0">
          <header className="workspace-header page-header listing-studio-header">
            <div className="studio-header-row">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">AI Content Workspace</p>
                <h1>Listing Studio</h1>
                <p>营销策略、Listing 草稿与安全复核。</p>
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
