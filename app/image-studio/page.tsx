import { redirect } from "next/navigation";

/**
 * R1: Image Studio 已收敛。独立生成流程不再作为用户入口；
 * 产品图片草稿统一在任务详情「AI 生成图片草稿」区生成（基于创作交接与批准的视觉参考）。
 * 旧 URL 带 taskId 时重定向到对应任务详情，否则回到研究历史。
 * 独立 /api/image-studio 后端能力保留，但不再有页面入口。
 */
type ImageStudioPageProps = {
  searchParams?: Promise<{ taskId?: string | string[] }>;
};

export default async function ImageStudioPage({ searchParams }: ImageStudioPageProps) {
  const params = await searchParams;
  const taskId = Array.isArray(params?.taskId) ? params.taskId[0] : params?.taskId;
  const normalized = taskId?.trim().slice(0, 120);

  if (normalized) {
    redirect(`/tasks/${encodeURIComponent(normalized)}`);
  }
  redirect("/tasks");
}
