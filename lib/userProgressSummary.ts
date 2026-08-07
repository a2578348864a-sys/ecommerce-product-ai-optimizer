/**
 * 用户进度摘要派生（组件层工具，不新增状态机，不改核心合同）。
 *
 * 严格按真实推进顺序表达缺口与下一步：
 *   研究未完成 → 完成商品研究
 *   研究完成、人工决定未完成 → 完成人工决定
 *   人工决定继续、Handoff 未完成 → 进入创作交接
 *   Handoff 完成、Listing 未生成 → 生成 Listing 草稿
 *   Listing 已生成、图片未生成 → 生成产品图片
 *   Listing + 图片完成 → 人工复核最终内容
 *
 * 文案区分"已有准备信息"与"真正生成"：
 *   - listing_draft artifact 只代表有 Listing 准备信息（不是已生成 Listing）
 *   - image_plan artifact 只代表有图片创作参考（不是已生成图片）
 *   - 真正生成以 result.listingHandoffBinding / result.aiImageDraftSnapshot 为准
 */
export type UserProgressSummary = {
  status: string;
  completed: string;
  missing: string;
  next: string;
};

export type UserProgressInput = {
  stageLabel: string;
  artifactKeys: ReadonlyArray<string>;
  decisionStatus: string;
  result: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasImageGenerated(result: Record<string, unknown>): boolean {
  const snapshot = result.aiImageDraftSnapshot;
  return isRecord(snapshot)
    && Array.isArray(snapshot.items)
    && (snapshot.items as unknown[]).length > 0;
}

export function deriveUserProgressSummary(input: UserProgressInput): UserProgressSummary {
  const result = isRecord(input.result) ? input.result : {};
  const keys = new Set(input.artifactKeys);
  const hasResearch = keys.has("market_analysis");
  const hasHumanConclusion = keys.has("human_conclusion") || input.decisionStatus === "continue";
  // Handoff/Listing 判断基于浏览器 DTO 可得的字段：
  // - aiListingPackSnapshot 是 listing-handoff 的落库产物（DTO 已投影）
  // - 存在 aiListingPackSnapshot 即隐含创作交接已完成（Listing 生成依赖 Handoff）
  const hasListingGenerated = Boolean(result.aiListingPackSnapshot);
  const hasHandoff = hasListingGenerated || Boolean(result.creativeHandoff);
  const hasImage = hasImageGenerated(result);

  // 已完成（按真实产物，区分准备信息与已生成）
  const completedParts: string[] = [];
  if (hasResearch) completedParts.push("研究结论");
  if (hasHandoff) completedParts.push("创作交接");
  if (hasListingGenerated) completedParts.push("Listing 草稿已生成");
  else if (keys.has("listing_draft")) completedParts.push("已有 Listing 准备信息");
  if (hasImage) completedParts.push("产品图片已生成");
  else if (keys.has("image_plan")) completedParts.push("已有图片创作参考");
  if (hasHumanConclusion) completedParts.push("人工决定");
  const completed = completedParts.length ? completedParts.join("、") : "尚未保存研究结论";

  // 还缺 + 下一步（严格顺序，与 actions 解耦避免提前提示）
  let missing: string;
  let next: string;
  if (!hasResearch) {
    missing = "完成商品研究";
    next = "完成商品研究";
  } else if (!hasHumanConclusion) {
    missing = "完成人工决定";
    next = "完成人工决定";
  } else if (!hasHandoff) {
    missing = "进入创作交接确认事实与视觉参考";
    next = "进入创作交接";
  } else if (!hasListingGenerated) {
    missing = "生成 Listing 草稿";
    next = "生成 Listing 草稿";
  } else if (!hasImage) {
    missing = "生成产品图片";
    next = "生成产品图片";
  } else {
    missing = "人工复核最终内容";
    next = "人工复核最终内容";
  }

  return { status: input.stageLabel, completed, missing, next };
}
