import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import type { AccessContext } from "@/lib/server/accessPassword";
import { generateImageDraftFromHandoff, ImageHandoffError, imageDraftSafeSummaries } from "@/lib/imageHandoff/imageGenerationService";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { computeImageStatus, parseImageHandoffBinding, type ImageStatus } from "@/lib/imageHandoff/imageBinding";
import { mutateTaskResultJson, TaskResultJsonMutationError } from "@/lib/server/taskResultJsonMutation";
import { parseProductCreativeHandoff } from "@/lib/productCreativeHandoff";
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
  if (!expectedStorageVersion) return errorResponse(400, "invalid_storage_version", "缺少或无效的存储版本。");
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
    });
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
  if (!expectedStorageVersion) return errorResponse(400, "invalid_storage_version", "缺少或无效的存储版本。");
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
