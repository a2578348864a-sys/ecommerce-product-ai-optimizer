import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { ImageStudioClient } from "@/components/image-studio/ImageStudioClient";
import styles from "@/components/image-studio/ImageStudioPolish.module.css";

type ImageStudioPageProps = {
  searchParams?: Promise<{ taskId?: string | string[] }>;
};

export default async function ImageStudioPage({ searchParams }: ImageStudioPageProps) {
  const params = await searchParams;
  const taskId = Array.isArray(params?.taskId) ? params.taskId[0] : params?.taskId;

  return (
    <main className={`app-shell image-studio-page ${styles.page}`}>
      <div className={`${styles.frame} workspace-page workspace-layout`}>
        <WorkspaceSidebar />
        <div className={`image-studio-main ${styles.main}`}>
          <header className={`${styles.header} workspace-header page-header`}>
            <div className={styles.headerRow}>
              <div className={styles.titleBlock}>
                <p className={styles.headerEyebrow}>AI Visual Workspace</p>
                <div className={styles.titleMeta}>
                  <h1>AI Product Image Studio</h1>
                  <span className={styles.safeBadge}>Mock 默认 · Real 受控</span>
                </div>
                <p className={styles.headerDescription}>
                  将商品事实转化为可比较、可复核的跨境电商图片方案；默认 Mock，不触发真实 AI。
                </p>
              </div>
              <ol className={`${styles.flow} studio-flow`} aria-label="图片生产流程">
                {["商品信息", "图片策略", "生成结果", "质量检查"].map((label, index) => (
                  <li key={label} aria-current={index === 0 ? "step" : undefined}>
                    <span className={styles.flowNumber}>{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.flowLabel}>{label}</span>
                  </li>
                ))}
              </ol>
            </div>
            <WorkspaceMobileNav />
          </header>
          <ImageStudioClient taskId={taskId} />
        </div>
      </div>
    </main>
  );
}
