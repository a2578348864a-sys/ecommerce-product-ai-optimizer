import { NextRequest } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { getAuthoritativeCandidate } from "@/lib/server/candidateAuthority";
import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
import { prisma } from "@/lib/server/db";
import { getProductResearchRecord } from "@/lib/productResearchRecord";
import { readCandidateProductImageSnapshotDual } from "@/lib/productResearchImage";
import { decodeVisualReferenceImage } from "@/lib/visualReferenceImage";
import { buildVisualSelectionId } from "@/lib/server/visualReferenceCandidates";

export const runtime = "nodejs";

/**
 * Secure Visual Reference Preview — 安全商品图片读取。
 *
 * 允许 Creative Handoff 视觉参考候选图片流（Owner / 所属 Visitor）。
 * 绑定基于「服务端确定性重建的 selectionId」——与 Preview DTO / 浏览器提交
 * 使用同一 selectionId 规范（buildVisualSelectionId），候选图片与请求完全一致
 * 时才返回字节流。
 *
 * 安全边界（全部在服务端强制，绝不信任浏览器参数）：
 *  - 用户鉴权：requireAuthenticated（未登录 401）
 *  - Candidate 归属：getAuthoritativeCandidate（Owner 查 DB / Visitor 查 Sandbox，
 *    跨身份/不存在一律 null → 404）
 *  - Task 绑定：候选必须已转换到本任务（convertedTaskId === taskId），
 *    否则视为未授权（Pre-Create 视觉候选同样只对已转换任务可见）
 *  - 图片校验：快照经 parseProductImageSnapshot 严格验证（sha256 重算 / magic bytes /
 *    ≤2MiB），Route 再次字节级解码并断言 contentHash
 *  - 缓存：private + immutable（内容按 contentHash 寻址不可变，绝不共享缓存跨身份）
 *  - 响应只含图片字节流：content-type / content-length / ETag(contentHash 前缀)；
 *    不返回原始 URL、完整 hash、内部路径、dataUrl、base64
 */

type RouteContext = { params: Promise<{ id?: string }> };

function jsonError(code: string, message: string, status: number) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

/** 请求快照：仅接受确定性重建的视觉参考内容（visual: 24 位 hex） */
function parseRequestedVisualRef(value: string | null): { selectionId: string } | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 80);
  if (!/^visual:[a-f0-9]{24}$/u.test(trimmed)) return null;
  return { selectionId: trimmed };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const taskId = typeof params.id === "string" ? params.id.trim().slice(0, 128) : "";
  if (!taskId) return jsonError("invalid_id", "任务标识无效。", 400);

  const auth = await requireAuthenticated(request);
  if (!auth.ok) {
    return jsonError(auth.code, auth.message, auth.status);
  }

  const requestedVisual = parseRequestedVisualRef(new URL(request.url).searchParams.get("ref"));
  if (!requestedVisual) return jsonError("invalid_reference", "视觉参考标识无效。", 400);

  // ── 归属校验 1：Task 归属 + 研究绑定（Owner=DB / Visitor=Sandbox，跨身份一律 404）──
  // 候选由任务 researchRecord 绑定的 candidateId 决定；不信任任何查询参数中的
  // candidateId（拒绝伪造）。selectionId（ref）最终经服务端重建比对。
  const task = await loadOwnedTask(taskId, auth.context);
  if (!task) return jsonError("task_not_found", "图片不存在或无权访问。", 404);
  const candidateIdFromTask = task.candidateId;
  if (!candidateIdFromTask) return jsonError("task_not_found", "图片不存在或无权访问。", 404);

  const candidate = await getAuthoritativeCandidate(auth.context, candidateIdFromTask);
  if (!candidate) return jsonError("task_not_found", "图片不存在或无权访问。", 404);

  // ── 归属校验 2：候选必须已绑定本任务（未转换/跨任务一律 404，防枚举与复用）──
  if (candidate.convertedTaskId !== taskId) {
    return jsonError("task_not_found", "图片不存在或无权访问。", 404);
  }

  // ── 图片读取：双层快照 → 字节级校验（contentHash 断言）──
  const snapshot = readCandidateProductImageSnapshotDual(
    candidate.sourceMetaJson,
    candidate.analysisJson,
  );
  const image = decodeVisualReferenceImage(snapshot, snapshot?.contentHash);
  if (!image) return jsonError("task_not_found", "图片不存在或无权访问。", 404);

  // ── 归属校验 3：selectionId 确定性重建——请求 ref 必须与当前状态重建一致 ──
  const subjectKind = auth.context.mode === "owner" ? "owner" : "visitor";
  const researchRevision = task.researchRevision ?? 1;
  const rebuilt = buildVisualSelectionId({
    subjectKind,
    taskId,
    candidateId: candidateIdFromTask,
    researchRevision,
    contentHash: image.contentHash,
  });
  if (rebuilt !== requestedVisual.selectionId) {
    return jsonError("task_not_found", "图片不存在或无权访问。", 404);
  }

  return new Response(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      "content-type": image.mimeType,
      "content-length": String(image.bytes.length),
      "cache-control": "private, max-age=3600, immutable",
      "etag": `"${image.contentHash.slice(0, 24)}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'",
      "content-disposition": `inline; filename="visual-ref-${image.contentHash.slice(0, 8)}.${image.mimeType === "image/jpeg" ? "jpg" : "png"}"`,
    },
  });
}

/**
 * 任务归属读取（Owner=DB / Visitor=Sandbox）+ 研究候选绑定提取。
 * 返回 null 表示任务不存在或无权访问（统一 404）。
 */
async function loadOwnedTask(taskId: string, context: { mode: "owner" | "demo"; demoAccessId?: string }) {
  const sandboxLike = isSandboxTaskId(taskId) || taskId.startsWith("demo-") || taskId.startsWith("sandbox-");
  if (sandboxLike) {
    if (context.mode !== "demo" || !context.demoAccessId) return null;
    const sandbox = getSandboxTask(context.demoAccessId, taskId);
    if (!sandbox) return null;
    const record = getProductResearchRecord(parseRecord(sandbox.resultJson));
    if (!record) return null;
    return { candidateId: record.candidateId || null, researchRevision: record.revision };
  }

  if (context.mode !== "owner") return null;
  const db = await prisma.viralAnalysisRecord.findUnique({ where: { id: taskId } });
  if (!db) return null;
  const record = getProductResearchRecord(parseRecord(db.resultJson));
  if (!record) return null;
  return { candidateId: record.candidateId || null, researchRevision: record.revision };
}

function parseRecord(raw: string | null | undefined) {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
