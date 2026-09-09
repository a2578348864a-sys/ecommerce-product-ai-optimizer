/**
 * V3 Final R9（§151）：从研究记录中解析"公网 HTTPS 商品主图 URL"，用于 1688 图片找货自动预填。
 *
 * - 纯客户端安全模块（无 node:* 依赖，可被客户端组件 import）；
 * - 只接受 https 公网 URL（拒绝 data: / 内网 / 相对路径——dataUrl 快照不可用于图搜）；
 * - 数据模型内 Task 主图通常为 dataUrl 快照（无公网 URL），此时返回 null（不预填，用户手动粘贴）；
 * - 候选来源：sourceMeta.productBatchSnapshot.imageUrl / sourceMeta.candidateSnapshot.imageUrl /
 *   productIdentity.image。新增来源需显式加入。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDataUrlImage(value: unknown): boolean {
  return typeof value === "string" && /^data:image\/[a-zA-Z0-9+.-]+;base64,/i.test(value.trim());
}

export function resolvePublicSourceImageUrl(
  result: unknown,
  taskId?: string | null,
  fallbackImage?: unknown,
): string | null {
  if (!isRecord(result)) {
    if (taskId && isDataUrlImage(fallbackImage)) {
      return `/api/tasks/${encodeURIComponent(taskId.trim())}/image`;
    }
    return null;
  }
  const sourceMeta = isRecord(result.sourceMeta) ? result.sourceMeta : null;
  const batchSnapshot = sourceMeta && isRecord(sourceMeta.productBatchSnapshot) ? sourceMeta.productBatchSnapshot : null;
  const candidateSnapshot = sourceMeta && isRecord(sourceMeta.candidateSnapshot) ? sourceMeta.candidateSnapshot : null;
  const identity = isRecord(result.productIdentity) ? result.productIdentity : null;
  const candidates: unknown[] = [
    batchSnapshot?.imageUrl,
    batchSnapshot?.mainImageUrl,
    candidateSnapshot?.imageUrl,
    identity?.image,
  ];

  // 1. 优先：https 公网图片
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (/^https:\/\/[^\s]+$/i.test(trimmed)) return trimmed;
  }

  // 2. 否则：存在 data:image Base64 快照，返回任务只读图片接口 /api/tasks/{taskId}/image
  if (taskId && typeof taskId === "string" && taskId.trim()) {
    const validTaskId = taskId.trim();
    // 检查候选图片字段中的 data:image
    for (const raw of candidates) {
      if (isDataUrlImage(raw)) {
        return `/api/tasks/${encodeURIComponent(validTaskId)}/image`;
      }
    }
    // 检查 snapshot 对象或 fallbackImage
    if (
      isDataUrlImage(batchSnapshot?.imageSnapshot) ||
      isDataUrlImage(batchSnapshot?.imageSnapshotJson) ||
      isDataUrlImage(candidateSnapshot?.productImageSnapshot) ||
      isDataUrlImage(candidateSnapshot?.image) ||
      isDataUrlImage(sourceMeta?.imageSnapshot) ||
      isDataUrlImage(fallbackImage) ||
      (isRecord(fallbackImage) && isDataUrlImage((fallbackImage as Record<string, unknown>).dataUrl))
    ) {
      return `/api/tasks/${encodeURIComponent(validTaskId)}/image`;
    }
    // 检查 candidateAnalysisContext / candidateToTask 线索（来自 Excel / 候选商品快照）
    const candidateAnalysisContext = isRecord(result.candidateAnalysisContext) ? result.candidateAnalysisContext : null;
    const facts = candidateAnalysisContext && isRecord(candidateAnalysisContext.facts) ? candidateAnalysisContext.facts : null;
    if (facts?.productBatchItemId || result.candidateToTask) {
      return `/api/tasks/${encodeURIComponent(validTaskId)}/image`;
    }
  }

  return null;
}
