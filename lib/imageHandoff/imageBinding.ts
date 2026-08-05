import { createHash } from "node:crypto";

/**
 * PR2-3 Image Handoff Binding（image-handoff-binding.v1）。
 *
 * 每份新 Image Draft 必须绑定当前 Handoff：
 * - sourceHandoffId / sourceHandoffRevision / sourceHandoffFingerprintHash
 * - sourceResearchRevision / generationInputFingerprint / visualReferenceFingerprint
 * - mode / generatedAt / model / generationSource=creative_handoff / humanReviewRequired=true
 * - requestIdHash（幂等）
 *
 * 由 Image Writer（ai-image）拥有，与 aiImageDraftSnapshot 在同一 CAS/Store 锁内原子保存。
 * 不修改 image-draft 公开语义；Browser 只返回安全摘要。
 */

export const IMAGE_HANDOFF_BINDING_SCHEMA = "image-handoff-binding.v1";

export type ImageHandoffBindingV1 = {
  schema: typeof IMAGE_HANDOFF_BINDING_SCHEMA;
  sourceHandoffId: string;
  sourceHandoffRevision: number;
  sourceHandoffFingerprintHash: string;
  sourceResearchRevision: number;
  generationInputFingerprint: string;
  visualReferenceFingerprint: string | null;
  mode: "composition_concept" | "product_visual_draft";
  generatedAt: string;
  model: string;
  generationSource: "creative_handoff";
  humanReviewRequired: true;
  requestIdHash: string;
};

const HASH_64 = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseImageHandoffBinding(value: unknown): ImageHandoffBindingV1 | null {
  if (!isRecord(value)) return null;
  if (value.schema !== IMAGE_HANDOFF_BINDING_SCHEMA) return null;
  if (typeof value.sourceHandoffId !== "string" || !value.sourceHandoffId) return null;
  if (!Number.isSafeInteger(value.sourceHandoffRevision) || (value.sourceHandoffRevision as number) < 1) return null;
  if (typeof value.sourceHandoffFingerprintHash !== "string" || !HASH_64.test(value.sourceHandoffFingerprintHash)) return null;
  if (!Number.isSafeInteger(value.sourceResearchRevision) || (value.sourceResearchRevision as number) < 1) return null;
  if (typeof value.generationInputFingerprint !== "string" || !HASH_64.test(value.generationInputFingerprint)) return null;
  if (value.visualReferenceFingerprint !== null && typeof value.visualReferenceFingerprint !== "string") return null;
  if (value.mode !== "composition_concept" && value.mode !== "product_visual_draft") return null;
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) return null;
  if (typeof value.model !== "string" || !value.model.trim()) return null;
  if (value.generationSource !== "creative_handoff") return null;
  if (value.humanReviewRequired !== true) return null;
  if (typeof value.requestIdHash !== "string" || !HASH_64.test(value.requestIdHash)) return null;
  return value as ImageHandoffBindingV1;
}

export function buildImageHandoffBinding(input: {
  sourceHandoffId: string;
  sourceHandoffRevision: number;
  sourceHandoffFingerprint: string;
  sourceResearchRevision: number;
  generationInputFingerprint: string;
  visualReferenceFingerprint: string | null;
  mode: "composition_concept" | "product_visual_draft";
  generatedAt: string;
  model: string;
  requestId: string;
}): ImageHandoffBindingV1 {
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  return {
    schema: IMAGE_HANDOFF_BINDING_SCHEMA,
    sourceHandoffId: input.sourceHandoffId,
    sourceHandoffRevision: input.sourceHandoffRevision,
    sourceHandoffFingerprintHash: sha(input.sourceHandoffFingerprint),
    sourceResearchRevision: input.sourceResearchRevision,
    generationInputFingerprint: input.generationInputFingerprint,
    visualReferenceFingerprint: input.visualReferenceFingerprint,
    mode: input.mode,
    generatedAt: input.generatedAt,
    model: input.model,
    generationSource: "creative_handoff",
    humanReviewRequired: true,
    requestIdHash: sha(input.requestId),
  };
}

// ─── Image 动态状态模型 ─────────────────────────────────

export type ImageStatus =
  | "ready"
  | "active"
  | "stale"
  | "revoked"
  | "concept_only"
  | "legacy_unbound"
  | "invalid";

export function computeImageStatus(input: {
  binding: ImageHandoffBindingV1 | null;
  currentHandoff: { handoffId: string; currentRevision: number; controlState: string; stale: boolean } | null;
  researchRevision: number;
  currentHandoffFingerprintHash: string | null;
  currentVisualReferenceFingerprint: string | null;
  hasDraft: boolean;
}): ImageStatus {
  // 无 binding → legacy_unbound（历史草稿）或 ready（无草稿）
  if (!input.binding) {
    if (!input.hasDraft) return input.currentHandoff?.controlState === "active" ? "ready" : "ready";
    return "legacy_unbound";
  }
  // Parser 失败由调用方标记 invalid（fail-closed）
  if (input.currentHandoff?.controlState === "revoked") return "revoked";
  if (!input.currentHandoff) return "stale";
  if (input.binding.sourceHandoffId !== input.currentHandoff.handoffId) return "stale";
  if (input.binding.sourceHandoffRevision !== input.currentHandoff.currentRevision) return "stale";
  if (input.binding.sourceHandoffFingerprintHash !== input.currentHandoffFingerprintHash) return "stale";
  if (input.binding.sourceResearchRevision !== input.researchRevision) return "stale";
  if (input.currentHandoff.stale) return "stale";
  // 视觉参考变化 → stale
  if (input.binding.visualReferenceFingerprint !== input.currentVisualReferenceFingerprint) return "stale";
  // active（concept_only 标记 composition 模式）
  if (input.binding.mode === "composition_concept") return "concept_only";
  return "active";
}

/** 浏览器安全摘要（不含完整 Fingerprint/Hash） */
export function imageBindingSafeSummary(binding: ImageHandoffBindingV1) {
  return {
    sourceHandoffRevision: binding.sourceHandoffRevision,
    sourceResearchRevision: binding.sourceResearchRevision,
    mode: binding.mode,
    generatedAt: binding.generatedAt,
    model: binding.model,
    humanReviewRequired: binding.humanReviewRequired,
    generationSource: binding.generationSource,
  };
}
