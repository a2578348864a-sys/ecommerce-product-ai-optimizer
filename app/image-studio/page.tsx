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
  const sourceLabel = taskId ? "来自商品决策记录" : "请先完成商品决策";

  return (
    <main className={`app-shell image-studio-page ${styles.page}`}>
      <div className={`${styles.frame} workspace-page workspace-layout`}>
        <WorkspaceSidebar />
        <div className={`image-studio-main min-w-0 ${styles.main}`}>
          <header className={`${styles.header} workspace-header page-header`}>
            <div className={styles.headerRow}>
              <div className={styles.titleBlock}>
                <p className={styles.headerEyebrow}>决策后续辅助工具</p>
                <div className={styles.titleMeta}>
                  <h1>Image Studio</h1>
                  <span className={styles.safeBadge}>{sourceLabel}</span>
                </div>
                <p className={styles.headerDescription}>
                  {taskId
                    ? "基于已通过决策的商品记录与视觉参考生成图片草稿；发布前需人工复核。"
                    : "决策完成后的辅助工具：需先在决策复盘确认推进开发，再进入图片生成。"}
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
