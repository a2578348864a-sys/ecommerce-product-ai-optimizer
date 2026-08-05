import "server-only";

import { createHash } from "node:crypto";
import type { AccessContext } from "@/lib/server/accessPassword";
import { mutateTaskResultJson, TaskResultJsonMutationError, type TaskResultJsonStorageVersionHash } from "@/lib/server/taskResultJsonMutation";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { buildImageInputFromCreativeHandoff, type ImageGenerationInput, type ImageVisualMode } from "@/lib/imageHandoff/imageGenerationInput";
import { buildImageHandoffBinding, parseImageHandoffBinding, computeImageStatus, type ImageHandoffBindingV1, type ImageStatus } from "@/lib/imageHandoff/imageBinding";
import { createMockImageProvider, type MockImageProvider } from "@/lib/imageHandoff/mockImageProvider";
import { buildImagePromptFromInput, assertImagePromptIsSafe } from "@/lib/imageHandoff/imagePrompt";
import { parseProductCreativeHandoff } from "@/lib/productCreativeHandoff";
import { getProductResearchRecord, getProductResearchVerification, verifyProductResearchHash } from "@/lib/productResearchRecord";
import { extractAiImageDraftSnapshot, type AiImageDraftSnapshot } from "@/lib/aiImageDraft";

export class ImageHandoffError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "ImageHandoffError";
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
  return createMockImageProvider();
}

export type ImageGenerationOptions = {
  provider?: MockImageProvider;
  providerOptions?: Parameters<MockImageProvider["generate"]>[1];
};

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
    providerResult = await provider.generate(generationInput, options.providerOptions);
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
    generationInputFingerprint: buildResult.generationInputFingerprint,
    visualReferenceFingerprint: generationInput.approvedVisualReferences[0]?.referenceFingerprint ?? null,
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
      const draftSnapshot = {
        ...(existingSnapshot ? { ...(existingSnapshot as unknown as Record<string, unknown>) } : {}),
        items: [
          ...(existingSnapshot?.items ?? []),
          { ...(rawDraft as Record<string, unknown>), id: itemSummary.id ?? "mock-image-draft" },
        ].slice(-50),
        updatedAt: binding.generatedAt,
        accessMode: context.mode === "demo" ? "visitor" : "owner",
      } as unknown as AiImageDraftSnapshot;

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
