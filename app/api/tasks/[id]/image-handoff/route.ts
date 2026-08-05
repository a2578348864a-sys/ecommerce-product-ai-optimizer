import { NextRequest, NextResponse } from "next/server";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import type { AccessContext } from "@/lib/server/accessPassword";
import { generateImageDraftFromHandoff, ImageHandoffError, imageDraftSafeSummary } from "@/lib/imageHandoff/imageGenerationService";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { computeImageStatus, parseImageHandoffBinding, type ImageStatus } from "@/lib/imageHandoff/imageBinding";
import { TaskResultJsonMutationError } from "@/lib/server/taskResultJsonMutation";

const ALLOWED_GENERATE_FIELDS = new Set([
  "requestId", "expectedStorageVersion", "expectedHandoffRevision", "mode",
  "approvedVisualReferenceSelectionIds", "confirmed",
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
          approvedVisualReferenceSummary: [],
          storageVersion: null,
          expectedHandoffRevision: null,
          allowedModes: [],
        },
      });
    }
    const handoff = gate.currentHandoff;
    const researchRevision = gate.candidate?.sourceResearch.researchRevision ?? null;
    const bindingRaw = gate.imageHandoffBindingRaw;
    const storageVersion = gate.storageVersion;

    let binding = null;
    let draft = null;
    let imageStatus: ImageStatus = "ready";

    if (gate.imageDraftRaw !== undefined) {
      const snap = isRecord(gate.imageDraftRaw) ? (gate.imageDraftRaw as Record<string, unknown>).items : null;
      const lastItem = Array.isArray(snap) && snap.length > 0 ? snap[snap.length - 1] : null;
      draft = lastItem ? imageDraftSafeSummary(lastItem) : null;
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
        approvedVisualReferenceSummary,
        storageVersion,
        expectedHandoffRevision: handoff?.currentRevision ?? null,
        allowedModes: mode ? [mode] : [],
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
  const approvedVisualReferenceSelectionIds = body.approvedVisualReferenceSelectionIds;
  if (approvedVisualReferenceSelectionIds !== undefined) {
    if (!Array.isArray(approvedVisualReferenceSelectionIds)
      || approvedVisualReferenceSelectionIds.some((v) => typeof v !== "string" || !v.trim() || v.length > 200)) {
      return errorResponse(400, "invalid_visual_reference_selection", "视觉参考选择无效。");
    }
  }

  const { ctx, error } = getAuth(req, id, body);
  if (error) return error;

  try {
    const result = await generateImageDraftFromHandoff(id, ctx!, {
      requestId,
      expectedStorageVersion,
      expectedHandoffRevision,
      mode,
      approvedVisualReferenceSelectionIds,
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
      },
    });
  } catch (err) {
    if (err instanceof ImageHandoffError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof TaskResultJsonMutationError) return errorResponse(err.status, err.code, err.message);
    throw err;
  }
}
