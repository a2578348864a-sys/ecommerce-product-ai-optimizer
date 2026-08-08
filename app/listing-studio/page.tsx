import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ListingStudioClient } from "@/components/listing-studio/ListingStudioClient";
import styles from "@/components/listing-studio/ListingStudioPolish.module.css";

type ListingStudioPageProps = {
  searchParams?: Promise<{ taskId?: string | string[] }>;
};

export default async function ListingStudioPage({ searchParams }: ListingStudioPageProps) {
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
                <p className={styles.headerEyebrow}>AI Content Workspace</p>
                <div className="flex flex-wrap items-center gap-3">
                  <h1>Listing Studio</h1>
                  <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
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
          <ListingStudioClient taskId={taskId} />
        </div>
      </div>
    </main>
  );
}
