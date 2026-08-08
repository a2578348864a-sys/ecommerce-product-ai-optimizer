import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ImageStudioClient } from "@/components/image-studio/ImageStudioClient";
import styles from "@/components/image-studio/ImageStudioPolish.module.css";

type ImageStudioPageProps = {
  searchParams?: Promise<{ taskId?: string | string[] }>;
};

export default async function ImageStudioPage({ searchParams }: ImageStudioPageProps) {
  const params = await searchParams;
  const taskIdValue = Array.isArray(params?.taskId) ? params.taskId[0] : params?.taskId;
  const taskId = taskIdValue?.trim().slice(0, 200) || "";
  const sourceLabel = taskId ? "来自研究记录" : "独立创作";

  return (
    <main className={`app-shell image-studio-page ${styles.page}`}>
      <div className={`${styles.frame} workspace-page workspace-layout`}>
        <WorkspaceSidebar />
        <div className={`image-studio-main min-w-0 ${styles.main}`}>
          <header className={`${styles.header} workspace-header page-header`}>
            <div className={styles.headerRow}>
              <div className={styles.titleBlock}>
                <p className={styles.headerEyebrow}>AI Visual Workspace</p>
                <div className={styles.titleMeta}>
                  <h1>Image Studio</h1>
                  <span className={styles.safeBadge}>{sourceLabel}</span>
                </div>
                <p className={styles.headerDescription}>
                  {taskId
                    ? "基于服务端核验的研究资料和已批准视觉参考生成候选草稿。"
                    : "上传并批准参考图，或生成只表示构图与场景方向的概念候选。"}
                </p>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>
          <ImageStudioClient taskId={taskId} />
        </div>
      </div>
    </main>
  );
}
