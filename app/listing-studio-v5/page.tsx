import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ListingStudioV5Client } from "@/components/listing-v5/ListingStudioV5Client";

export default async function ListingStudioV5Page({ searchParams }: { searchParams?: Promise<{ taskId?: string | string[] }> }) {
  const params = await searchParams;
  const raw = Array.isArray(params?.taskId) ? params.taskId[0] : params?.taskId;
  const taskId = raw?.trim().slice(0, 200) || "";
  return <main className="app-shell listing-studio-page"><div className="workspace-page workspace-layout listing-studio-frame"><WorkspaceSidebar /><div className="listing-studio-main min-w-0"><header className="workspace-header page-header listing-studio-header"><div className="studio-header-row"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">AI Content Workspace · V5 Preview</p><h1>Listing Studio V5</h1><p>营销策略、Listing 草稿与安全复核。</p></div></div><WorkspaceMobileNav /></header><ListingStudioV5Client taskId={taskId} /></div></div></main>;
}
