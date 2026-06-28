export const LISTING_PACK_ANCHOR_ID = "listing-pack";
export const LISTING_PACK_SHORTCUT_LABEL = "查看 Listing 包";

type AiListingPackSnapshotMeta = {
  snapshotType: "ai_listing_pack";
  source?: unknown;
  version?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getAiListingPackSnapshot(result: unknown): AiListingPackSnapshotMeta | null {
  if (!isRecord(result)) return null;
  const snapshot = result.aiListingPackSnapshot;
  if (!isRecord(snapshot)) return null;
  if (snapshot.snapshotType !== "ai_listing_pack") return null;
  return snapshot as AiListingPackSnapshotMeta;
}

export function buildListingPackBadges(result: unknown): string[] {
  const snapshot = getAiListingPackSnapshot(result);
  if (!snapshot) return [];

  const badges = ["已保存 Listing 包"];
  if (snapshot.source === "real_ai_draft") badges.push("真实 AI draft");
  if (snapshot.source === "mock_ai_draft") badges.push("模拟草稿");
  return badges;
}

export function shouldShowListingPackShortcut(result: unknown) {
  return Boolean(getAiListingPackSnapshot(result));
}

export function buildTaskDeleteConfirmationMessage({
  title,
  result,
}: {
  title?: string;
  result: unknown;
}) {
  const trimmedTitle = title?.trim();
  if (!getAiListingPackSnapshot(result)) {
    return trimmedTitle
      ? `确定删除「${trimmedTitle}」这条任务记录吗？删除后无法恢复。`
      : "确定删除这条任务记录吗？删除后无法恢复。";
  }

  const prefix = trimmedTitle ? `该任务「${trimmedTitle}」` : "该任务";
  return `${prefix}包含已保存的 Listing 包。删除任务后，Listing 包也会一并删除，无法在任务详情中继续查看。确定删除吗？`;
}

export function buildBatchDeleteConfirmationMessage({
  count,
  hasListingPackSnapshot,
}: {
  count: number;
  hasListingPackSnapshot: boolean;
}) {
  if (!hasListingPackSnapshot) {
    return `确认删除选中的 ${count} 条任务？此操作不可恢复。`;
  }
  return `选中的任务中包含已保存的 Listing 包。删除任务后，Listing 包也会一并删除，无法在任务详情中继续查看。确认删除选中的 ${count} 条任务吗？`;
}
