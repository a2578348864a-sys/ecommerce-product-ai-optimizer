import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ListingStudioClient } from "@/components/listing-studio/ListingStudioClient";
import styles from "@/components/listing-studio/ListingStudioPolish.module.css";

type ListingStudioPageProps = {
  searchParams?: Promise<{ taskId?: string | string[] }>;
};

export default async function ListingStudioPage({ searchParams }: ListingStudioPageProps) {
  const params = await searchParams;
  const taskId = Array.isArray(params?.taskId) ? params.taskId[0] : params?.taskId;

  return (
    <main className="app-shell listing-studio-page">
      <div className="workspace-page workspace-layout listing-studio-frame">
        <WorkspaceSidebar />
        <div className="listing-studio-main">
          <header className="workspace-header page-header listing-studio-header">
            <div className={`studio-header-row ${styles.header}`}>
              <div className={styles.headerCopy}>
                <p className={styles.headerEyebrow}>AI Content Workspace</p>
                <h1>AI Listing Studio</h1>
                <p>输入商品事实，生成可审核、可优化的商品文案。</p>
              </div>
              <ol
                className={`listing-stage-chip ${styles.workflowRail}`}
                aria-label="Listing 工作流程：商品信息、Listing 生成、质量审核、优化输出"
              >
                {["商品信息", "Listing 生成", "质量审核", "优化输出"].map((label, index) => (
                  <li key={label} className={styles.workflowStep}>
                    <span className={styles.workflowNumber}>{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.workflowLabel}>{label}</span>
                  </li>
                ))}
              </ol>
            </div>
            <WorkspaceMobileNav />
          </header>
          <ListingStudioClient taskId={taskId} />
        </div>
      </div>
    </main>
  );
}
