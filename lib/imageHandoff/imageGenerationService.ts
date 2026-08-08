import "server-only";

import { createHash } from "node:crypto";
import type { AccessContext } from "@/lib/server/accessPassword";
import { mutateTaskResultJson, TaskResultJsonMutationError, type TaskResultJsonStorageVersionHash } from "@/lib/server/taskResultJsonMutation";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { buildImageInputFromCreativeHandoff, validateApprovedVisualSelection, type ImageGenerationInput, type ImageVisualMode } from "@/lib/imageHandoff/imageGenerationInput";
import { buildImageHandoffBinding, parseImageHandoffBinding, computeImageStatus, type ImageHandoffBindingV1, type ImageStatus } from "@/lib/imageHandoff/imageBinding";
import { createMockImageProvider, type MockImageProvider } from "@/lib/imageHandoff/mockImageProvider";
import { createImageProviderByMode, realImageProviderEnabled } from "@/lib/imageHandoff/realImageProvider";
import { buildImagePromptFromInput, assertImagePromptIsSafe } from "@/lib/imageHandoff/imagePrompt";
import { parseProductCreativeHandoff } from "@/lib/productCreativeHandoff";
import { getProductResearchRecord, getProductResearchVerification, verifyProductResearchHash } from "@/lib/productResearchRecord";
import { AI_IMAGE_DRAFT_DISCLAIMER, extractAiImageDraftSnapshot, type AiImageDraftSnapshot } from "@/lib/aiImageDraft";
import { AiImageProviderError } from "@/lib/server/openaiImageClient";

export class ImageHandoffError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "ImageHandoffError";
  }
}

/** 将 Provider 故障收敛为稳定且不会泄漏上游原文的公开错误合同。 */
export function mapImageHandoffProviderFailure(error: unknown): ImageHandoffError {
  if (!(error instanceof AiImageProviderError)) {
    return new ImageHandoffError("provider_unavailable", 502, "图片生成服务调用失败，请稍后重试。");
  }

  switch (error.code) {
    case "provider_auth_failed":
      return new ImageHandoffError("provider_auth_failed", 502, "图片生成服务认证失败，请检查服务端配置。");
    case "provider_quota":
      return new ImageHandoffError("provider_quota", 503, "图片生成服务额度不足，请补充额度后重试。");
    case "timeout":
      return new ImageHandoffError("provider_timeout", 504, "图片生成服务响应超时，请稍后重试。");
    case "provider_unavailable":
    case "rate_limited":
    case "empty_response":
    case "configuration_error":
    case "provider_error":
      return new ImageHandoffError("provider_unavailable", 503, "图片生成服务暂时不可用，请稍后重试。");
    case "network_error":
      return new ImageHandoffError("network_error", 502, "图片生成服务网络连接失败，请稍后重试。");
    default:
      return new ImageHandoffError("image_provider_failed", 422, "图片生成请求未能完成，请检查输入后重试。");
  }
}

export type ImageGenerateInput = {
  requestId: string;
  expectedStorageVersion: TaskResultJsonStorageVersionHash;
  expectedHandoffRevision: number;
  mode: ImageVisualMode;
  approvedVisualReferenceSelectionIds?: string[];
  confirmed: true;
};

export type ImageDraftSafeSummary = {
  id: string | null;
  mode: ImageVisualMode | null;
  compositionSummary: string | null;
  approvedReferenceFingerprint: string | null;
  generatedAt: string | null;
  humanReviewRequired: boolean;
};

export type ImageGenerateResult = {
  imageStatus: ImageStatus;
  currentHandoffRevision: number | null;
  sourceHandoffRevision: number | null;
  staleReasonCode?: string;
  idempotentReplay: boolean;
  imageSaved: boolean;
  draft: ImageDraftSafeSummary | null;
  handoffState: { controlState: string; stale: boolean } | null;
};

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function storageTime(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function snapshotVersionMatches(
  snapshot: { resultJson: string; updatedAt: Date | string },
  expected: TaskResultJsonStorageVersionHash,
): boolean {
  if (storageTime(snapshot.updatedAt) !== storageTime(expected.updatedAt)) return false;
  const hash = sha256(snapshot.resultJson);
  return hash === expected.resultJsonHash;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 从草稿提取安全摘要（不含视觉参考原始对象/内部引用） */
export function imageDraftSafeSummary(value: unknown): ImageDraftSafeSummary | null {
  if (!isRecord(value)) return null;
  const mode = value.handoffMode === "composition_concept" || value.handoffMode === "product_visual_draft"
    ? value.handoffMode as ImageVisualMode
    : null;
  if (!mode) return null;
  return {
    id: safeString(value.id),
    mode,
    compositionSummary: safeString(value.compositionSummary),
    approvedReferenceFingerprint: typeof value.approvedReferenceFingerprint === "string" ? value.approvedReferenceFingerprint.slice(0, 16) : null,
    generatedAt: safeString(value.createdAt),
    humanReviewRequired: true,
  };
}

/** 锁内快照语义：基于 CAS 快照重新验证 Handoff（无数据库读） */
function revalidateImageHandoffFromSnapshot(current: Record<string, unknown>, expectedHandoffRevision: number) {
  const handoffRaw = current.creativeHandoff;
  const handoff = handoffRaw !== undefined ? parseProductCreativeHandoff(handoffRaw) : null;
  if (!handoff || handoff.controlState !== "active") {
    throw new ImageHandoffError("handoff_stale", 409, "交接内容已经更新，请重新生成。");
  }
  if (handoff.currentRevision !== expectedHandoffRevision) {
    throw new ImageHandoffError("handoff_revision_conflict", 409, "交接内容已经更新，请重新生成。");
  }
  const record = getProductResearchRecord(current);
  const verification = getProductResearchVerification(current);
  if (!record || !verification || !verifyProductResearchHash(record, verification)) {
    throw new ImageHandoffError("handoff_stale", 409, "研究记录状态异常，请刷新后重新生成。");
  }
  const version = handoff.versions[handoff.versions.length - 1];
  if (!version || version.revision !== handoff.currentRevision) {
    throw new ImageHandoffError("handoff_stale", 409, "交接版本无效，请刷新后重新生成。");
  }
  return { handoff, version, researchRevision: record.revision };
}

let injectedImageProviderForTests: { provider: MockImageProvider } | null = null;

export function setImageProviderForTests(provider: MockImageProvider | null) {
  injectedImageProviderForTests = provider ? { provider } : null;
}

function defaultImageProvider(): MockImageProvider {
  if (injectedImageProviderForTests) return injectedImageProviderForTests.provider;
  // V2 Final Integration: Provider 模式由服务端环境决定（IMAGE_PROVIDER_MODE=mock|real，fail-closed）。
  // 测试默认 mock；生产候选配置 real。不重新实现 Service，仅替换阶段B Adapter。
  return createImageProviderByMode();
}

export type ImageGenerationOptions = {
  provider?: MockImageProvider;
  providerOptions?: Parameters<MockImageProvider["generate"]>[1];
};

export function buildImageHandoffDraftSnapshot(input: {
  existingSnapshot: AiImageDraftSnapshot | null;
  rawDraft: Record<string, unknown>;
  itemId: string;
  accessMode: "owner" | "visitor";
  updatedAt: string;
}): AiImageDraftSnapshot {
  return {
    version: 1,
    snapshotType: "ai_image_draft",
    provider: "openai_compatible_relay",
    accessMode: input.accessMode,
    humanReviewRequired: true,
    disclaimer: AI_IMAGE_DRAFT_DISCLAIMER,
    items: [
      ...(input.existingSnapshot?.items ?? []),
      { ...input.rawDraft, id: input.itemId },
    ].slice(-50),
    updatedAt: input.updatedAt,
  } as unknown as AiImageDraftSnapshot;
}

/**
 * PR2-3: 从 active Handoff 生成 Image Draft 并保存 Binding。
 * 阶段A（锁外）：Gate 验证 + 构造安全输入 + 幂等预检。
 * 阶段B（锁外）：Mock Provider（本轮仅 Mock；不联网；不持锁）。
 * 阶段C（锁内）：基于锁内快照二次验证（handoff active/revision/fingerprint/research）→
 *                幂等确认 → 输出验证 → 原子保存 aiImageDraftSnapshot + imageHandoffBinding。
 */
export async function generateImageDraftFromHandoff(
  taskId: string,
  context: AccessContext,
  input: ImageGenerateInput,
  options: ImageGenerationOptions = {},
): Promise<ImageGenerateResult> {
  const provider = options.provider ?? defaultImageProvider();

  // ── 阶段A：生成前快照（锁外验证）──
  const gateA = await checkCreativeHandoffGate(taskId, context);
  if (gateA.reason === "research_hash_invalid" || gateA.reason === "verification_invalid") {
    throw new ImageHandoffError("handoff_stale", 409, "研究记录状态已变化，请刷新后重新生成。");
  }
  if (gateA.handoffContractInvalid) {
    throw new ImageHandoffError("handoff_required", 422, "创作交接合同结构异常。");
  }
  if (gateA.ledgerInvalid) {
    throw new ImageHandoffError("handoff_required", 422, "创作交接状态异常。");
  }
  const handoffA = gateA.currentHandoff;
  if (!handoffA) {
    throw new ImageHandoffError("handoff_required", 422, "请先完成创作交接并进行人工确认。");
  }
  if (handoffA.controlState === "revoked") {
    throw new ImageHandoffError("handoff_revoked", 422, "创作交接已撤回，不能用于生成图片草稿。");
  }
  if (handoffA.currentRevision !== input.expectedHandoffRevision) {
    throw new ImageHandoffError("handoff_revision_conflict", 409, "创作交接版本已变化，请刷新后重新生成。");
  }
  if (!gateA.candidate) {
    throw new ImageHandoffError("handoff_required", 422, "创作交接证据缺失。");
  }
  const researchRevision = gateA.candidate.sourceResearch.researchRevision;
  const buildResult = buildImageInputFromCreativeHandoff(handoffA, researchRevision);
  if (!buildResult.ok) {
    throw new ImageHandoffError(buildResult.code, 422, buildResult.message);
  }
  const generationInput = buildResult.input;
  // Final Capability: product_visual_draft 真实参考图输入（从 gate 解析的批准参考图片；仅服务端）
  if (input.mode === "product_visual_draft" && gateA.approvedReferenceImageDataUrl) {
    generationInput.referenceImageDataUrl = gateA.approvedReferenceImageDataUrl;
  }

  // 模式门禁：composition_concept 不需要参考；product_visual_draft 必须有批准参考
  if (input.mode !== generationInput.mode) {
    // 浏览器请求模式必须与 Handoff 视觉状态一致
    if (input.mode === "product_visual_draft" && generationInput.mode !== "product_visual_draft") {
      throw new ImageHandoffError("image_visual_reference_required", 422, "当前交接没有已批准的产品视觉参考，只能生成构图概念。");
    }
    if (input.mode === "composition_concept" && generationInput.mode === "product_visual_draft") {
      throw new ImageHandoffError("image_visual_reference_invalid", 422, "当前交接存在已批准视觉参考，请选择产品视觉草稿模式。");
    }
  }

  // ── V2 Final Integration（规格九节）: approvedVisualReferenceSelectionIds 语义校验 ──
  // Handoff 批准参考 = 用户已批准集合；Browser 提交的 selectionIds = 本次草稿选择子集。
  // 未选择：composition 允许 / product_visual 拒绝；非当前/过期参考拒绝。
  const selectionCheck = validateApprovedVisualSelection(generationInput, input.approvedVisualReferenceSelectionIds);
  if (!selectionCheck.ok) {
    throw new ImageHandoffError(selectionCheck.code, 422, selectionCheck.message);
  }
  const selectedVisualReferences = selectionCheck.selected;

  // ── 幂等预检（阶段A，Provider 调用之前）──
  let idempotentPrefetchHit = false;
  const existingBindingRawA = gateA.imageHandoffBindingRaw;
  if (existingBindingRawA !== undefined) {
    const existingA = parseImageHandoffBinding(existingBindingRawA);
    if (existingA && existingA.requestIdHash === sha256(input.requestId)) {
      if (existingA.generationInputFingerprint === buildResult.generationInputFingerprint) {
        idempotentPrefetchHit = true;
      } else {
        throw new ImageHandoffError("image_idempotency_conflict", 409, "相同请求标识内容不一致。");
      }
    }
  }

  // ── 阶段B（锁外，不持锁）：Mock Provider（仅非重放请求）──
  const prompt = buildImagePromptFromInput(generationInput);
  if (!assertImagePromptIsSafe(prompt)) {
    throw new ImageHandoffError("image_input_empty", 422, "Prompt 构造安全检查失败。");
  }
  let providerResult: unknown = null;
  if (!idempotentPrefetchHit) {
    // V2 Final Integration: 真实 Provider 需持久化图片资产（accessMode/taskId 由服务传入；Mock 忽略 persist）
    const realPersist = realImageProviderEnabled() ? {
      accessMode: context.mode === "demo" ? ("visitor" as const) : ("owner" as const),
      visitorAccessId: (context as unknown as { demoAccessId?: string }).demoAccessId,
      taskId,
    } : undefined;
    try {
      providerResult = await provider.generate(
        generationInput,
        realPersist
          ? { ...(options.providerOptions ?? {}), persist: realPersist } as never
          : options.providerOptions,
      );
    } catch (providerError) {
      // 不自动重试；保留认证/额度/超时/可用性/网络的真实类别，同时隐藏上游原文。
      throw mapImageHandoffProviderFailure(providerError);
    }
  }
  const rawDraft = !idempotentPrefetchHit && isRecord(providerResult) ? providerResult : null;
  if (!idempotentPrefetchHit && !rawDraft) {
    throw new ImageHandoffError("image_schema_invalid", 422, "生成的图片草稿未通过结构校验。");
  }

  // ── 阶段C：保存前重新验证（锁内）──
  const binding = buildImageHandoffBinding({
    sourceHandoffId: handoffA.handoffId,
    sourceHandoffRevision: handoffA.currentRevision,
    sourceHandoffFingerprint: handoffA.versions[handoffA.versions.length - 1].handoffFingerprint,
    sourceResearchRevision: researchRevision,
    generationInputFingerprint: selectedVisualReferences.length > 0
      ? sha256(`${buildResult.generationInputFingerprint}:visual-selection:${selectedVisualReferences.map((r) => r.selectionId).sort().join(",")}`)
      : buildResult.generationInputFingerprint,
    visualReferenceFingerprint: selectedVisualReferences[0]?.referenceFingerprint ?? null,
    mode: generationInput.mode,
    generatedAt: new Date().toISOString(),
    model: provider.model,
    requestId: input.requestId,
  });

  const result = await mutateTaskResultJson<{ imageStatus: ImageStatus; idempotentReplay: boolean }>({
    context,
    taskId,
    writer: "ai-image",
    async mutate(current, snapshot) {
      // ── 锁内二次验证（快照内解析，无数据库读）──
      const validated = revalidateImageHandoffFromSnapshot(current, input.expectedHandoffRevision);
      const { handoff: handoffC, version: versionC } = validated;
      if (sha256(versionC.handoffFingerprint) !== binding.sourceHandoffFingerprintHash) {
        throw new ImageHandoffError("handoff_stale", 409, "交接内容已经更新，请重新生成。");
      }

      // ── 幂等检查（锁内，同 requestId 语义；先于 storageVersion 校验）──
      const existingRaw = current.imageHandoffBinding;
      let existing: ImageHandoffBindingV1 | null = null;
      if (existingRaw !== undefined) {
        existing = parseImageHandoffBinding(existingRaw);
        if (existing && existing.requestIdHash === binding.requestIdHash) {
          if (existing.generationInputFingerprint === binding.generationInputFingerprint) {
            return { result: current as Record<string, unknown>, value: { imageStatus: "active" as ImageStatus, idempotentReplay: true } };
          }
          throw new ImageHandoffError("image_idempotency_conflict", 409, "相同请求标识内容不一致。");
        }
        if (existing && existing.generationInputFingerprint === binding.generationInputFingerprint) {
          return { result: current as Record<string, unknown>, value: { imageStatus: "active" as ImageStatus, idempotentReplay: true } };
        }
      }

      // ── storageVersion 校验（非重放请求才执行）──
      if (!snapshotVersionMatches(snapshot, input.expectedStorageVersion)) {
        throw new TaskResultJsonMutationError("task_result_conflict", 409, "任务已在其他页面更新，请刷新后重试。");
      }

      // ── 新草稿：输出合同验证 ──
      // 1) 结构合法（复用现有 image-draft 合同 normalize）
      const existingSnapshot = extractAiImageDraftSnapshot(current);
      const itemSummary = imageDraftSafeSummary(rawDraft);
      if (!itemSummary) {
        throw new ImageHandoffError("image_schema_invalid", 422, "生成的图片草稿未通过结构校验。");
      }
      // 2) composition_concept 不得包含产品外观断言
      if (generationInput.mode === "composition_concept" && /(?:real product photo|exact colour and material|真实商品|实拍|产品主图已完成)/i.test(JSON.stringify(rawDraft))) {
        throw new ImageHandoffError("image_schema_invalid", 422, "构图概念草稿不得包含真实商品外观断言。");
      }
      // 3) product_visual_draft 必须有批准参考指纹
      if (generationInput.mode === "product_visual_draft" && !itemSummary.approvedReferenceFingerprint) {
        throw new ImageHandoffError("image_schema_invalid", 422, "产品视觉草稿必须基于已批准视觉参考。");
      }

      // ── 原子保存 aiImageDraftSnapshot + imageHandoffBinding ──
      const accessMode = context.mode === "demo" ? "visitor" : "owner";
      const draftSnapshot = buildImageHandoffDraftSnapshot({
        existingSnapshot,
        rawDraft: rawDraft as Record<string, unknown>,
        itemId: itemSummary.id ?? "mock-image-draft",
        accessMode,
        updatedAt: binding.generatedAt,
      });

      const status: ImageStatus = computeImageStatus({
        binding,
        currentHandoff: { handoffId: handoffC.handoffId, currentRevision: handoffC.currentRevision, controlState: handoffC.controlState, stale: false },
        researchRevision: validated.researchRevision,
        currentHandoffFingerprintHash: binding.sourceHandoffFingerprintHash,
        currentVisualReferenceFingerprint: binding.visualReferenceFingerprint,
        hasDraft: true,
      });

      return {
        result: {
          ...current,
          aiImageDraftSnapshot: draftSnapshot as unknown as Record<string, unknown>,
          imageHandoffBinding: binding as unknown as Record<string, unknown>,
        },
        value: { imageStatus: status, idempotentReplay: false },
      };
    },
  });

  const savedRaw = typeof result.resultJson === "string" ? JSON.parse(result.resultJson) : result.resultJson;
  const savedDraft = isRecord(savedRaw) ? imageDraftSafeSummary((savedRaw as Record<string, unknown>).aiImageDraftSnapshot) : null;

  return {
    imageStatus: result.value.imageStatus,
    currentHandoffRevision: handoffA.currentRevision,
    sourceHandoffRevision: binding.sourceHandoffRevision,
    idempotentReplay: result.value.idempotentReplay,
    imageSaved: !result.value.idempotentReplay,
    draft: savedDraft,
    handoffState: { controlState: handoffA.controlState, stale: false },
  };
}

/** 浏览器安全摘要（不含完整 Fingerprint/Hash） */
export function imageBindingSafeSummaryForBrowser(binding: ImageHandoffBindingV1) {
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
