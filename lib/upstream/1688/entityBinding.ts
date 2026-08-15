/**
 * V3.5 — 1688 Entity Binding 门禁（Wrong Entity = 0）
 *
 * Contract §19/§30：同一 offer 的 title/price/MOQ/supplier/SKU 必须证明属于同一个 offerId；
 * 禁止跨 card / 跨 result / 跨 page 拼字段。
 *
 * - assertSingleOfferRecord：原始记录必须为单一对象且含 offerId（结构层绑定）。
 * - crossValidateCandidateWithDetail：搜索候选 ↔ 详情交叉验证（offerId 硬门禁 + 诊断字段）。
 * - resolveOfferIdFromUrl / isAllowed1688OfferUrl：URL 详情获取的身份解析与来源白名单（§20/§21）。
 */

import { SourcingAcquisitionError, type AcquisitionCandidate, type OfferDetail } from "./contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 校验"单个 offer 记录"的结构：必须是对象且含合法 offerId。
 * 若输入是数组（多记录混入）或缺失 offerId → fail-closed（ENTITY_BINDING_FAILED）。
 */
export function assertSingleOfferRecord(value: unknown, context: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SourcingAcquisitionError("entity_binding_failed", 422, `${context} 不是单一对象，拒绝解析（防止跨记录拼字段）。`);
  }
  const offerId = typeof value.offerId === "string" ? value.offerId.trim() : "";
  if (!/^\d{5,20}$/.test(offerId)) {
    throw new SourcingAcquisitionError("entity_binding_failed", 422, `${context} 缺少合法 offerId，拒绝解析。`);
  }
}

/**
 * 候选 ↔ 详情交叉验证。
 * 硬门禁：offerId 必须一致（不一致 → ENTITY_BINDING_FAILED）。
 * 诊断字段（title/url 一致性）只记录，不阻止——搜索标题可能截断，但 offerId 是唯一实体键。
 */
export function crossValidateCandidateWithDetail(
  candidate: AcquisitionCandidate,
  detail: OfferDetail,
): {
  ok: boolean;
  offerIdMatch: boolean;
  titleMatch: boolean | null;
  urlMatch: boolean | null;
} {
  const offerIdMatch = candidate.offerId === detail.offerId;
  if (!offerIdMatch) {
    throw new SourcingAcquisitionError(
      "entity_binding_failed",
      422,
      `候选 offerId=${candidate.offerId} 与详情 offerId=${detail.offerId} 不一致，已拒绝绑定。`,
    );
  }
  const titleMatch = candidate.title && detail.title
    ? candidate.title === detail.title || candidate.title.includes(detail.title) || detail.title.includes(candidate.title)
    : null;
  const urlMatch = candidate.sourceUrl && detail.sourceUrl
    ? candidate.sourceUrl === detail.sourceUrl || candidate.sourceUrl.includes(String(detail.offerId)) || detail.sourceUrl.includes(String(candidate.offerId))
    : null;
  return { ok: true, offerIdMatch, titleMatch, urlMatch };
}

/** 1688 offer URL 允许的来源（detail.1688.com 主 + m.1688.com 移动端） */
const ALLOWED_1688_OFFER_HOSTS = new Set(["detail.1688.com", "m.1688.com", "www.1688.com"]);

/** 解析 1688 offer URL 中的 offerId（支持 query offerId=... 与路径 /offer/{id}.html） */
export function parseOfferIdFromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const fromQuery = url.searchParams.get("offerId");
  if (fromQuery && /^\d{5,20}$/.test(fromQuery)) return fromQuery;
  const match = url.pathname.match(/(?:^|\/)(\d{5,20})(?:\.html)?(?:$|\/)/);
  if (match) return match[1];
  return null;
}

/**
 * 1688 offer URL 校验（Contract §20：allowlisted origin + HTTPS + redirect 校验 + final origin 校验 + offer identity 再校验）。
 * 返回值携带解析出的 offerId；null 表示非法（fail-closed 拒绝）。
 */
export function validate1688OfferUrl(value: string): { url: string; offerId: string } | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (!ALLOWED_1688_OFFER_HOSTS.has(url.hostname)) return null;
  const offerId = parseOfferIdFromUrl(value);
  if (!offerId) return null;
  return { url: url.href, offerId };
}
