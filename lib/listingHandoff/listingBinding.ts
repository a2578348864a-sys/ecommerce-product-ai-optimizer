import { createHash } from "node:crypto";

/**
 * PR2-2: Listing Handoff Binding 内部合同（resultJson.listingHandoffBinding）
 *
 * 由 Listing Writer（ai-listing）拥有，与 aiListingPackSnapshot 在同一 CAS/Store 锁内原子保存。
 * 不修改 ai_listing_pack v1 公开语义；浏览器只返回安全摘要（完整 Fingerprint/Hash 不返回）。
 */

export const LISTING_HANDOFF_BINDING_SCHEMA = "listing-handoff-binding.v1" as const;

export type ListingHandoffBindingV1 = {
  schema: typeof LISTING_HANDOFF_BINDING_SCHEMA;
  sourceHandoffId: string;
  sourceHandoffRevision: number;
  sourceHandoffFingerprintHash: string; // sha256（内部，不返回浏览器）
  sourceResearchRevision: number;
  generationInputFingerprint: string;
  generatedAt: string;
  model: string;
  generationSource: "creative_handoff";
  humanReviewRequired: true;
  requestIdHash: string; // sha256（幂等，不返回浏览器）
};

export type ListingStatus = "ready" | "active" | "stale" | "revoked" | "legacy_unbound" | "invalid";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HASH_64 = /^[a-f0-9]{64}$/;

export function parseListingHandoffBinding(value: unknown): ListingHandoffBindingV1 | null {
  if (!isRecord(value)) return null;
  if (value.schema !== LISTING_HANDOFF_BINDING_SCHEMA) return null;
  if (typeof value.sourceHandoffId !== "string" || !value.sourceHandoffId) return null;
  if (!Number.isSafeInteger(value.sourceHandoffRevision) || (value.sourceHandoffRevision as number) < 1) return null;
  if (typeof value.sourceHandoffFingerprintHash !== "string" || !HASH_64.test(value.sourceHandoffFingerprintHash)) return null;
  if (!Number.isSafeInteger(value.sourceResearchRevision) || (value.sourceResearchRevision as number) < 1) return null;
  if (typeof value.generationInputFingerprint !== "string" || !HASH_64.test(value.generationInputFingerprint)) return null;
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) return null;
  if (typeof value.model !== "string" || !value.model.trim()) return null;
  if (value.generationSource !== "creative_handoff") return null;
  if (value.humanReviewRequired !== true) return null;
  if (typeof value.requestIdHash !== "string" || !HASH_64.test(value.requestIdHash)) return null;
  return value as ListingHandoffBindingV1;
}

export function buildListingHandoffBinding(input: {
  sourceHandoffId: string;
  sourceHandoffRevision: number;
  sourceHandoffFingerprint: string;
  sourceResearchRevision: number;
  generationInputFingerprint: string;
  generatedAt: string;
  model: string;
  requestId: string;
}): ListingHandoffBindingV1 {
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  return {
    schema: LISTING_HANDOFF_BINDING_SCHEMA,
    sourceHandoffId: input.sourceHandoffId,
    sourceHandoffRevision: input.sourceHandoffRevision,
    sourceHandoffFingerprintHash: sha(input.sourceHandoffFingerprint),
    sourceResearchRevision: input.sourceResearchRevision,
    generationInputFingerprint: input.generationInputFingerprint,
    generatedAt: input.generatedAt,
    model: input.model,
    generationSource: "creative_handoff",
    humanReviewRequired: true,
    requestIdHash: sha(input.requestId),
  };
}

export type ListingStatusInput = {
  binding: ListingHandoffBindingV1 | null;
  currentHandoff: { handoffId: string; currentRevision: number; controlState: string; stale: boolean } | null;
  researchRevision: number;
};

/**
 * 动态计算 Listing 草稿状态（服务端，浏览器不可提交）。
 * fail-closed：解析失败/身份不一致 → invalid；无 Handoff → legacy_unbound（历史草稿）。
 */
export function computeListingStatus(input: ListingStatusInput): ListingStatus {
  const { binding, currentHandoff, researchRevision } = input;
  if (!binding) {
    if (!currentHandoff) return "legacy_unbound";
    if (currentHandoff.controlState === "revoked") return "revoked";
    return "ready";
  }
  if (!currentHandoff) return "invalid";
  if (binding.sourceHandoffId !== currentHandoff.handoffId) return "invalid";
  if (currentHandoff.controlState === "revoked") return "revoked";
  if (binding.sourceHandoffRevision !== currentHandoff.currentRevision) return "stale";
  if (currentHandoff.stale) return "stale";
  if (binding.sourceResearchRevision !== researchRevision) return "stale";
  return "active";
}

/** 手写版本化草稿的最小形态（仅防覆盖；完整校验在生成服务内执行） */
export function isHandoffListedDraftShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return typeof value.source === "string"
    && value.humanReviewRequired === true
    && typeof value.generatedAt === "string"
    && Array.isArray(value.titles)
    && Array.isArray(value.bullets);
}
