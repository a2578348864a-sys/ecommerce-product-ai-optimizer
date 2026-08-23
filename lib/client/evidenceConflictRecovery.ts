"use client";

/**
 * 轮 12：保存/导入/确认共用的 CAS 冲突恢复决策（纯函数）。
 *
 * 语义（与任务书一致）：
 * - 首次冲突（409 或 code === task_result_conflict）→ retry: true：调用方必须保留用户预览/输入，
 *   触发版本刷新（onChanged），并在 storageVersion 变化后自动重试一次；
 * - 已重试过仍冲突 → retry: false + CONFLICT_RETRY_MESSAGE：显示简洁重试提示，绝不无限重试；
 * - 非冲突错误 → 不重试、无专用提示（由调用方展示错误信息）。
 *
 * 注意：此决策不放松 expectedStorageVersion，也不强制覆盖——CAS 仍严格。
 */

export const CONFLICT_RETRY_MESSAGE = "资料刚刚更新，请再试一次。";

export type EvidenceConflictRecovery = {
  /** true = 尚未重试过，允许在版本刷新后安全重试一次 */
  retry: boolean;
  /** 二次冲突时展示给用户的简洁重试提示（仅二次冲突非空） */
  message: string | null;
};

export function resolveEvidenceConflictRecovery(
  status: number,
  code: string | null,
  alreadyRetried: boolean,
): EvidenceConflictRecovery {
  const isConflict = status === 409 || code === "task_result_conflict";
  if (!isConflict) return { retry: false, message: null };
  if (alreadyRetried) return { retry: false, message: CONFLICT_RETRY_MESSAGE };
  return { retry: true, message: null };
}
