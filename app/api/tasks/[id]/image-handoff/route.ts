import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  requireAuthenticated,
  requireOwnerOnly,
  guardDemoProviderAction,
  finalizeDemoProviderAction,
  markVisitorStandaloneStudioProviderStarted,
  type DemoProviderActionToken,
} from "@/lib/server/demoGuard";
import type { AccessContext } from "@/lib/server/accessPassword";
import { generateImageDraftFromHandoff, ImageHandoffError, imageDraftSafeSummaries, withDefaultImageProviderInterceptor } from "@/lib/imageHandoff/imageGenerationService";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { computeImageStatus, parseImageHandoffBinding, type ImageStatus } from "@/lib/imageHandoff/imageBinding";
import { mutateTaskResultJson, TaskResultJsonMutationError } from "@/lib/server/taskResultJsonMutation";
import { parseProductCreativeHandoff } from "@/lib/productCreativeHandoff";
import { classifyImageDraft, isFinalSelectableDraft } from "@/lib/imageHandoff/historicalDraftClassification";
import { evaluatePurposeRequirements } from "@/lib/imageHandoff/purposeRequirements";
import {
  buildTaskImageCreativeDescriptionContext,
  parseTaskImageCreativeDirection,
} from "@/lib/imageCreativeDescription";

const ALLOWED_GENERATE_FIELDS = new Set([
  "requestId", "expectedStorageVersion", "expectedHandoffRevision", "mode",
  "approvedVisualReferenceSelectionIds", "confirmed",
  "count", "primaryImagePurpose", "lifestyleScene", "customImagePurpose", "userCreativeDescription",
]);
const ALLOWED_SELECT_FIELDS = new Set([
  "selectedImageId", "expectedStorageVersion", "expectedHandoffRevision", "confirmed",
]);
const FORBIDDEN_KEYS = new Set([
  "creativeHandoff", "creativeHandoffRequestLedger", "imageHandoffBinding", "aiImageDraftSnapshot",
  "aiListingPackSnapshot", "listingHandoffBinding", "candidateId", "handoffId", "revision",
  "fingerprint", "requestKeyHash", "requestFingerprint", "resultJson", "writerKind",
  "ownedNamespaces", "createdBy", "confirmedBy", "approvedBy", "fact", "facts", "prompt",
  "provider", "model", "imageUrl", "imageBinary", "sourceRef", "visualReference",
  "__proto__", "constructor", "prototype",
]);

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** V3 Final Freeze：历史草稿安全投影（分类确定性来源：classifyImageDraft；不含图片字节） */
function buildDraftHistoryProjection(
  imageDraftRaw: unknown,
  currentCandidateIds: Array<string | null>,
): Array<{
  id: string;
  classification: ReturnType<typeof classifyImageDraft>;
  generatedAt: string | null;
  sourceHandoffRevision: number | null;
  approvedReferenceFingerprint: string | null;
  inCurrentCandidates: boolean;
}> {
  if (!isRecord(imageDraftRaw) || !Array.isArray(imageDraftRaw.items)) return [];
  const current = new Set(currentCandidateIds.filter((id): id is string => typeof id === "string"));
  return imageDraftRaw.items
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = safeString(item.id);
      if (!id) return null;
      return {
        id,
        classification: classifyImageDraft(item),
        generatedAt: safeString(item.createdAt),
        sourceHandoffRevision: typeof item.sourceHandoffRevision === "number"
          && Number.isSafeInteger(item.sourceHandoffRevision)
          ? item.sourceHandoffRevision
          : null,
        approvedReferenceFingerprint: typeof item.approvedReferenceFingerprint === "string"
          ? item.approvedReferenceFingerprint.slice(0, 16)
          : null,
        inCurrentCandidates: current.has(id),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function containsForbiddenKey(value: unknown, depth = 0): string | null {
  if (depth > 12) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = containsForbiddenKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) return key;
      if (key.startsWith("_")) return key;
    }
    for (const key of Object.keys(value)) {
      const hit = containsForbiddenKey(value[key], depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function parseStorageVersion(value: unknown): { resultJsonHash: string; updatedAt: string } | null {
  if (!isRecord(value) || Object.keys(value).length !== 2) return null;
  if (typeof value.resultJsonHash !== "string" || !/^[a-f0-9]{64}$/.test(value.resultJsonHash)) return null;
  if (typeof value.updatedAt !== "string" || !value.updatedAt) return null;
  const parsed = new Date(value.updatedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return { resultJsonHash: value.resultJsonHash, updatedAt: parsed.toISOString() };
}

function parseCurrentSelection(value: unknown, currentHandoffRevision: number | null) {
  if (!isRecord(value) || currentHandoffRevision === null) return null;
  if (typeof value.selectedImageId !== "string" || !value.selectedImageId) return null;
  if (value.sourceHandoffRevision !== currentHandoffRevision) return null;
  return value.selectedImageId;
}

type AuthResult = { ctx: AccessContext | null; error: NextResponse | null };

function getAuth(req: NextRequest, id: string, bodyRecord: Record<string, unknown>): AuthResult {
  if (isSandboxTaskId(id) || id.startsWith("demo-") || id.startsWith("sandbox-")) {
    const auth = requireAuthenticated(req, bodyRecord);
    if (!auth.ok) {
      return { ctx: null, error: errorResponse(auth.status, auth.code === "not_found" ? "task_not_found" : auth.code, auth.message) };
    }
    if (auth.context!.mode !== "demo") {
      return { ctx: null, error: errorResponse(404, "task_not_found", "任务不存在。") };
    }
    return { ctx: auth.context!, error: null };
  }
  const auth = requireOwnerOnly(req, bodyRecord);
  if (!auth.ok) {
    return { ctx: null, error: errorResponse(auth.status, auth.code === "not_found" ? "task_not_found" : auth.code, auth.message) };
  }
  return { ctx: auth.context!, error: null };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = getAuth(req, id, {});
  if (auth.error) return auth.error;
  const ctx = auth.ctx!;

  try {
    const gate = await checkCreativeHandoffGate(id, ctx);
    if (gate.reason === "legacy_not_supported" && gate.imageHandoffBindingRaw === undefined) {
      if (isSandboxTaskId(id) || id.startsWith("demo-") || id.startsWith("sandbox-")) {
        return errorResponse(404, "task_not_found", "任务不存在。");
      }
      return NextResponse.json({
        ok: true,
        data: {
          canGenerate: false,
          imageStatus: "legacy_unbound" as ImageStatus,
          mode: null,
          currentHandoffRevision: null,
          sourceHandoffRevision: null,
          staleReasonCode: null,
          humanReviewRequired: true,
          draft: null,
          candidates: [],
          selectedImageId: null,
          approvedVisualReferenceSummary: [],
          storageVersion: null,
          expectedHandoffRevision: null,
          allowedModes: [],
          creativeDescriptionContext: null,
        },
      });
    }
    const handoff = gate.currentHandoff;
    const researchRevision = gate.candidate?.sourceResearch.researchRevision ?? null;
    const bindingRaw = gate.imageHandoffBindingRaw;
    const storageVersion = gate.storageVersion;

    let binding = null;
    let draft = null;
    let candidates = [] as ReturnType<typeof imageDraftSafeSummaries>;
    let imageStatus: ImageStatus = "ready";

    if (gate.imageDraftRaw !== undefined) {
      candidates = imageDraftSafeSummaries(gate.imageDraftRaw, handoff?.currentRevision ?? null);
      draft = candidates[candidates.length - 1] ?? null;
    }

    if (bindingRaw !== undefined) {
      binding = parseImageHandoffBinding(bindingRaw);
      if (!binding) imageStatus = "invalid";
    }

    // 当前 Handoff 的视觉状态（决定 allowedModes）
    let mode: "composition_concept" | "product_visual_draft" | null = null;
    let approvedVisualReferenceSummary: Array<{ referenceFingerprint: string; summary: string }> = [];
    if (handoff && handoff.controlState === "active") {
      const version = handoff.versions[handoff.versions.length - 1];
      if (version) {
        const approvedRefs = version.visualReferences.filter((r) =>
          r.identityBound === true && r.humanApprovedForReference === true
          && typeof r.approvedAt === "string" && typeof r.approvedBy === "object"
          && typeof r.confirmationReference === "string");
        if (approvedRefs.length > 0) {
          mode = "product_visual_draft";
          approvedVisualReferenceSummary = approvedRefs.map((r) => ({
            referenceFingerprint: r.assetFingerprint.slice(0, 16),
            summary: `approved visual reference ${r.assetFingerprint.slice(0, 8)}`,
            // V2 Final Integration: 服务端确定性 selectionId（与 imageGenerationInput 编码一致；
            // Browser 只能提交该 selectionId，不能提交 Approval 对象/URL）
            selectionId: `visual-ref:${createHash("sha256").update(`${handoff.handoffId}:${handoff.currentRevision}:${r.assetFingerprint}`).digest("hex").slice(0, 24)}`,
          }));
        } else {
          mode = "composition_concept";
        }
      }
    }

    if (binding) {
      const statusInput = {
        binding,
        currentHandoff: handoff
          ? { handoffId: handoff.handoffId, currentRevision: handoff.currentRevision, controlState: handoff.controlState, stale: false }
          : null,
        researchRevision: researchRevision ?? 1,
        currentHandoffFingerprintHash: binding.sourceHandoffFingerprintHash,
        currentVisualReferenceFingerprint: binding.visualReferenceFingerprint,
        hasDraft: draft !== null,
      };
      imageStatus = computeImageStatus(statusInput);
      if (imageStatus === "stale" && handoff) {
        if (binding.sourceHandoffRevision !== handoff.currentRevision) imageStatus = "stale";
      }
    } else if (handoff) {
      imageStatus = handoff.controlState === "revoked" ? "revoked" : "ready";
    }

    const canGenerate = handoff?.controlState === "active"
      && imageStatus !== "revoked"
      && imageStatus !== "invalid";

    return NextResponse.json({
      ok: true,
      data: {
        canGenerate,
        imageStatus,
        mode,
        currentHandoffRevision: handoff?.currentRevision ?? null,
        sourceHandoffRevision: binding?.sourceHandoffRevision ?? null,
        staleReasonCode: imageStatus === "stale" ? "handoff_revision_changed" : null,
        humanReviewRequired: true,
        draft,
        candidates,
        selectedImageId: parseCurrentSelection(
          gate.imageStudioSelectionRaw,
          handoff?.currentRevision ?? null,
        ),
        approvedVisualReferenceSummary,
        // Visual Reference Closure：任务自有图片候选（candidate_fallback 修复后可用），
        // 浏览器仅获得 selectionId/sourceKind/approvable（不含 contentHash/dataUrl）
        visualReferenceCandidates: (gate.visualReferenceCandidates ?? []).map((candidate) => ({
          selectionId: candidate.selectionId,
          sourceKind: candidate.sourceKind,
          approvable: candidate.approvable === true,
          summary: candidate.summary,
        })),
        // V3 Final Freeze：历史草稿分类投影（仅 id/分类/时间/来源版本，不含图片字节与内部引用）
        draftHistory: buildDraftHistoryProjection(gate.imageDraftRaw, candidates.map((c) => c.id)),
        storageVersion,
        expectedHandoffRevision: handoff?.currentRevision ?? null,
        allowedModes: mode ? [mode] : [],
        creativeDescriptionContext: handoff
          ? buildTaskImageCreativeDescriptionContext(handoff)
          : null,
      },
    });
  } catch (err) {
    if (err instanceof ImageHandoffError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof TaskResultJsonMutationError) return errorResponse(err.status, err.code, err.message);
    throw err;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }
  if (!isRecord(body)) return errorResponse(400, "invalid_json", "请求格式无效。");

  const forbidden = containsForbiddenKey(body);
  if (forbidden) return errorResponse(400, "forbidden_field", `禁止字段: ${forbidden}`);

  for (const key of Object.keys(body)) {
    if (!ALLOWED_GENERATE_FIELDS.has(key)) return errorResponse(400, "unknown_field", `未知字段: ${key}`);
  }

  const requestId = body.requestId;
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 128) {
    return errorResponse(400, "invalid_request_id", "请求标识无效。");
  }
  const expectedStorageVersion = parseStorageVersion(body.expectedStorageVersion);
  if (!expectedStorageVersion) return errorResponse(400, "invalid_storage_version", "内容刚在其他位置更新，请刷新后重试。");
  const expectedHandoffRevision = body.expectedHandoffRevision;
  if (typeof expectedHandoffRevision !== "number" || !Number.isSafeInteger(expectedHandoffRevision) || expectedHandoffRevision < 1) {
    return errorResponse(400, "invalid_handoff_revision", "交接版本无效。");
  }
  const mode = body.mode;
  if (mode !== "composition_concept" && mode !== "product_visual_draft") {
    return errorResponse(400, "invalid_image_mode", "视觉模式无效。");
  }
  if (body.confirmed !== true) return errorResponse(400, "confirmation_required", "请确认后提交。");
  const count = body.count === 2 ? 2 : body.count === undefined || body.count === 1 ? 1 : null;
  if (!count) return errorResponse(400, "invalid_image_count", "图片候选数量必须为 1 或 2。");
  const approvedVisualReferenceSelectionIds = body.approvedVisualReferenceSelectionIds;
  if (approvedVisualReferenceSelectionIds !== undefined) {
    if (!Array.isArray(approvedVisualReferenceSelectionIds)
      || approvedVisualReferenceSelectionIds.some((v) => typeof v !== "string" || !v.trim() || v.length > 200)) {
      return errorResponse(400, "invalid_visual_reference_selection", "视觉参考选择无效。");
    }
  }

  const creativeDirection = parseTaskImageCreativeDirection({
    primaryImagePurpose: body.primaryImagePurpose ?? "white_studio",
    lifestyleScene: body.lifestyleScene ?? "none",
    customImagePurpose: body.customImagePurpose ?? "",
    userCreativeDescription: body.userCreativeDescription ?? "基于已确认商品资料制作清晰、可人工复核的商品图片。",
  });
  if (!creativeDirection.ok) {
    const messages = {
      invalid_primary_image_purpose: "图片主用途无效。",
      invalid_lifestyle_scene: "生活场景选择无效。",
      white_background_scene_conflict: "白底主图不使用生活场景，请改选其他主用途。",
      custom_image_purpose_required: "请填写自定义图片用途。",
      invalid_creative_description: "创作描述格式无效，且不得超过 1200 个字符。",
      unsafe_creative_description: "创作描述包含不安全指令，请删除后重试。",
    } as const;
    return errorResponse(400, creativeDirection.code, messages[creativeDirection.code]);
  }

  const { ctx, error } = getAuth(req, id, body);
  if (error) return error;


  // Visual Reference Gate（§32-35）：白底主图/产品细节特写/包装套装要求已确认商品参考图；
  // 无参考时阻止付费生成（BLOCKED_NEEDS_VISUAL_REFERENCE），不回落抽象轮廓冒充商品图。
  const REQUIRES_VISUAL_REFERENCE_PURPOSES = new Set(["white_studio", "detail_closeup", "packaging_bundle"]);
  const purpose = creativeDirection.data.primaryImagePurpose;
  const gateForPurpose = await checkCreativeHandoffGate(id, ctx!);
  if (REQUIRES_VISUAL_REFERENCE_PURPOSES.has(purpose) && !gateForPurpose.approvedReferenceImageDataUrl) {
    const messages: Record<string, string> = {
      white_studio: "白底商品图需要先确认商品参考图。请先批准商品参考图（创作资料 → 商品参考图）后重试。",
      detail_closeup: "产品细节特写需要已确认的商品参考图。请先批准商品参考图后重试。",
      packaging_bundle: "包装/套装展示需要已确认的商品参考图或包装事实。请先批准商品参考图后重试。",
    };
    return errorResponse(409, "blocked_needs_visual_reference", messages[purpose]);
  }

  // V3 Purpose Evidence Gates（全部用途 fail-closed，不静默降级；在 generation service / quota 之前执行）：
  // PACKAGING_SET → 包装证据；SIZE_SPEC → 尺寸证据（容量≠尺寸）；USAGE_STEPS → 使用方式证据；
  // SELLING_POINT_INFOGRAPHIC → 已确认卖点证据。只读 confirmedFacts（VOC/AI/描述文本不作权威）。
  {
    const latestVersion = gateForPurpose.currentHandoff?.versions?.[gateForPurpose.currentHandoff.versions.length - 1];
    const confirmedFacts = (latestVersion?.confirmedFacts ?? [])
      .map((fact) => ({ field: fact.field, label: fact.label, value: String(fact.value ?? "") }));
    const purposeGate = evaluatePurposeRequirements(purpose, confirmedFacts);
    if (!purposeGate.ok) {
      return errorResponse(409, purposeGate.code, purposeGate.message);
    }
  }

  // D1（Phase 2）：Image 生成统一 quota authority（§5：units = count；remaining < count 整体拒绝）。
  // 顺序（§6）：scope → IP backstop → guest quota + global cap（同事务原子预留）→ provider call → 结算。
  let providerToken: DemoProviderActionToken | null = null;
  let providerOptions: { provider?: unknown } = {};
  if (ctx!.mode === "demo") {
    const guarded = guardDemoProviderAction(ctx!, req, { kind: "image", requestId, units: count });
    if (!guarded.ok) return errorResponse(guarded.status, guarded.code, guarded.message);
    providerToken = guarded.token;
    if (guarded.token.reservation) {
      // Provider start 拦截器：每次真实 generate 前记账（成功/失败均计费；重放不触发）
      providerOptions = withDefaultImageProviderInterceptor(() => {
        markVisitorStandaloneStudioProviderStarted(ctx!, guarded.token!.reservation!);
      });
    }
  }

  try {
    const result = await generateImageDraftFromHandoff(id, ctx!, {
      requestId,
      expectedStorageVersion,
      expectedHandoffRevision,
      mode,
      count,
      approvedVisualReferenceSelectionIds,
      ...creativeDirection.data,
      confirmed: true,
    }, providerOptions as never);
    if (ctx!.mode === "demo") {
      finalizeDemoProviderAction(
        ctx!,
        providerToken,
        { kind: "image", requestId, units: count },
        !result.idempotentReplay,
      );
    }
    return NextResponse.json({
      ok: true,
      data: {
        imageStatus: result.imageStatus,
        currentHandoffRevision: result.currentHandoffRevision,
        sourceHandoffRevision: result.sourceHandoffRevision,
        idempotentReplay: result.idempotentReplay,
        humanReviewRequired: true,
        draft: result.draft,
        candidates: result.candidates,
      },
    });
  } catch (err) {
    // 失败路径：若 Provider 拦截器已记账则 release 为 no-op；否则回补预留（§7）
    if (ctx!.mode === "demo") {
      finalizeDemoProviderAction(ctx!, providerToken, { kind: "image", requestId, units: count }, false);
    }
    if (err instanceof ImageHandoffError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof TaskResultJsonMutationError) return errorResponse(err.status, err.code, err.message);
    throw err;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }
  if (!isRecord(body)) return errorResponse(400, "invalid_json", "请求格式无效。");
  const forbidden = containsForbiddenKey(body);
  if (forbidden) return errorResponse(400, "forbidden_field", `禁止字段: ${forbidden}`);
  for (const key of Object.keys(body)) {
    if (!ALLOWED_SELECT_FIELDS.has(key)) return errorResponse(400, "unknown_field", `未知字段: ${key}`);
  }
  if (body.confirmed !== true) return errorResponse(400, "confirmation_required", "请选择并确认一张候选图。");
  const selectedImageId = body.selectedImageId;
  if (typeof selectedImageId !== "string" || !selectedImageId.trim() || selectedImageId.length > 200) {
    return errorResponse(400, "invalid_image_selection", "图片选择无效。");
  }
  const expectedStorageVersion = parseStorageVersion(body.expectedStorageVersion);
  if (!expectedStorageVersion) return errorResponse(400, "invalid_storage_version", "内容刚在其他位置更新，请刷新后重试。");
  const expectedHandoffRevision = body.expectedHandoffRevision;
  if (typeof expectedHandoffRevision !== "number" || !Number.isSafeInteger(expectedHandoffRevision) || expectedHandoffRevision < 1) {
    return errorResponse(400, "invalid_handoff_revision", "创作资料版本无效。");
  }

  const { ctx, error } = getAuth(req, id, body);
  if (error) return error;
  try {
    const gate = await checkCreativeHandoffGate(id, ctx!);
    const handoff = gate.currentHandoff;
    if (!handoff || handoff.controlState !== "active") {
      return errorResponse(422, "handoff_required", "当前研究记录尚未准备好可用的创作资料。");
    }
    if (handoff.currentRevision !== expectedHandoffRevision) {
      return errorResponse(409, "handoff_revision_conflict", "创作资料已经更新，请刷新后重新选择。");
    }
    // V3 Final Freeze：历史草稿最终选择 Gate（fail-closed，不依赖前端隐藏按钮）。
    // 只允许 PRODUCT_VISUAL_DRAFT；历史异常 / 构图概念 / 无法分类一律拒绝。
    if (isRecord(gate.imageDraftRaw) && Array.isArray(gate.imageDraftRaw.items)) {
      const target = (gate.imageDraftRaw.items as unknown[]).find(
        (item) => isRecord(item) && item.id === selectedImageId,
      );
      if (target) {
        const classification = classifyImageDraft(target);
        if (classification === "invalid_product_identity") {
          return errorResponse(409, "invalid_product_identity_draft", "该图片属于历史异常结果（商品身份错误），不能作为正式商品图。");
        }
        if (!isFinalSelectableDraft(classification)) {
          return errorResponse(409, "concept_draft_not_final_asset", "构图概念或历史草稿不能作为正式商品图，请选择基于商品参考图生成的产品图片草稿。");
        }
      }
    }
    const currentCandidates = imageDraftSafeSummaries(gate.imageDraftRaw, handoff.currentRevision);
    if (!currentCandidates.some((candidate) => candidate.id === selectedImageId)) {
      return errorResponse(409, "image_selection_stale", "该候选图不属于当前创作资料版本，请重新生成后选择。");
    }

    const selectedAt = new Date().toISOString();
    await mutateTaskResultJson({
      context: ctx!,
      taskId: id,
      writer: "ai-image",
      expectedStorageVersion,
      mutate(current) {
        const currentHandoff = parseProductCreativeHandoff(current.creativeHandoff);
        if (!currentHandoff || currentHandoff.controlState !== "active"
          || currentHandoff.currentRevision !== expectedHandoffRevision) {
          throw new ImageHandoffError("handoff_revision_conflict", 409, "创作资料已经更新，请刷新后重新选择。");
        }
        const candidates = imageDraftSafeSummaries(current.aiImageDraftSnapshot, expectedHandoffRevision);
        if (!candidates.some((candidate) => candidate.id === selectedImageId)) {
          throw new ImageHandoffError("image_selection_stale", 409, "该候选图不属于当前创作资料版本，请重新生成后选择。");
        }
        return {
          result: {
            ...current,
            imageStudioSelection: {
              version: 1,
              selectedImageId,
              sourceHandoffRevision: expectedHandoffRevision,
              selectedAt,
            },
          },
          value: null,
        };
      },
    });

    return NextResponse.json({
      ok: true,
      data: { selectedImageId, sourceHandoffRevision: expectedHandoffRevision, selectedAt },
    });
  } catch (err) {
    if (err instanceof ImageHandoffError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof TaskResultJsonMutationError) return errorResponse(err.status, err.code, err.message);
    throw err;
  }
}