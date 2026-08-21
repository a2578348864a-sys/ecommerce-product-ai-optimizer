/**
 * V4 门禁 7：内容导出资产级校验（纯函数，无 IO）。
 *
 * 原则：Listing blocked 或图片视觉检查存在失败项（overallStatus=blocked / 任一 pass=false）
 * 时，任何 approv_export 路径都必须被拒绝（content/review 与 resume 共用同一守卫，防绕过）。
 *
 * 允许语义：Listing 通过 + 图片阻断 是合法中间态；禁止 run 级 approve_export 掩盖资产失败。
 */

export type ExportBlocker = { code: "content_blocked"; message: string };

export function exportBlocker(contentJson: string | null | undefined): ExportBlocker | null {
  if (!contentJson) return null;
  let content: unknown;
  try {
    content = JSON.parse(contentJson);
  } catch {
    return null;
  }
  if (!content || typeof content !== "object") return null;
  const c = content as {
    listing?: { blocked?: boolean };
    images?: { checks?: { checks?: { pass?: boolean }[]; overallStatus?: string } };
  };
  const visualBlocked =
    c.images?.checks?.overallStatus === "blocked" ||
    (c.images?.checks?.checks?.some((chk) => chk.pass === false) ?? false);
  if (c.listing?.blocked === true || visualBlocked) {
    return {
      code: "content_blocked",
      message: "存在阻断项（Listing blocked 或视觉检查失败），不可导出。",
    };
  }
  return null;
}
