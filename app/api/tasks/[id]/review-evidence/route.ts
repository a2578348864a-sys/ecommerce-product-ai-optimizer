/**
 * V3.4 — Review Evidence API（review-evidence.v1 + voc-analysis.v1）
 * GET  /api/tasks/[id]/review-evidence  读取 dataset + vocAnalysis + storageVersion + taskAsin
 * POST /api/tasks/[id]/review-evidence  action=import：人工导入 Review 样本（规范化/去重/bounded/实体绑定）
 * POST /api/tasks/[id]/review-evidence  action=analyze：AI VOC 分析（quota gate + run trace + evidenceRefs 硬门禁）
 * POST /api/tasks/[id]/review-evidence  action=clear：清空 dataset（同步清除旧分析）
 * POST /api/tasks/[id]/review-evidence  action=collect：半自动采集 Preview（隔离浏览器提取 Top Reviews 片段，不写入）
 * POST /api/tasks/[id]/review-evidence  action=collect-confirm：人工确认后把 Preview 选中项写入（browser 绑定 + 去重）
 *
 * 安全：requireAuthenticated / subject binding / task binding / expectedStorageVersion /
 * schema validation / payload limit / namespace writer ownership；不开放任意 JSON 写入。
 * collect-confirm 的字段值全部由服务端从 Preview 缓存重建（客户端只传 previewId + 选中索引），
 * 与 browser-evidence save 的 Preview 取回机制一致。
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { consumeDemoAiCalls, ensureDemoAiQuota, requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  clearReviews,
  getReviewEvidence,
  importReviews,
  readReviewEvidenceSnapshot,
  ReviewEvidenceError,
  REVIEW_DATASET_MAX_REVIEWS,
  REVIEW_DATASET_MAX_PER_ASIN,
  buildReviewDuplicateKey,
  buildReviewContentHash,
  type ReviewEvidenceV1,
  type ReviewImportInput,
  type ReviewSourceProductRole,
} from "@/lib/server/reviewEvidence";
import {
  analyzeVoc,
  getVocAnalysis,
  VocAnalysisError,
  type VocAnalysisV1,
} from "@/lib/server/vocAnalysis";
import {
  REVIEW_COLLECTOR_VERSION,
  ReviewCollectorError,
  assertReviewCollectRequest,
  createReviewCollectPreview,
  takeReviewCollectPreview,
  reviewCollectSubjectKey,
  buildSnippetPreviewDedupeKey,
} from "@/lib/server/reviewCollector";
import { readBrowserEvidenceTaskAsin } from "@/lib/server/browserEvidence";
import type { AccessContext } from "@/lib/server/accessPassword";
import {
  acquisitionGateError,
  REVIEW_LOCAL_ENV_REQUIRED_MESSAGE,
  browserUnavailableMessage,
  resolveBrowserAcquisitionCapability,
  type AcquisitionCapability,
} from "@/lib/server/acquisitionCapability";

export const runtime = "nodejs";

type StorageVersion = { resultJsonHash: string; updatedAt: string };
type ApiResponse =
  | { ok: true; data: { evidence: ReviewEvidenceV1 | null; analysis: VocAnalysisV1 | null; storageVersion: StorageVersion; taskAsin: string | null; capability: AcquisitionCapability } }
  | { ok: true; data: { outcome: { kind: string; importedCount: number; duplicateCount: number; rejectedCount: number }; evidence: ReviewEvidenceV1; storageVersion: StorageVersion } }
  | { ok: true; data: { analysis: VocAnalysisV1; unverified: number; gateResult: string; storageVersion: StorageVersion } }
  | { ok: true; data: { cleared: boolean; storageVersion: StorageVersion } }
  | {
      ok: true;
      data: {
        preview: {
          previewId: string;
          items: Array<{
            asin: string;
            role: ReviewSourceProductRole;
            rating: number | null;
            date: string | null;
            title: string;
            duplicate: boolean;
          }>;
          pageResults: Array<{ asin: string; status: string; note: string | null; extractedCount: number }>;
          capturedAt: string;
        };
        storageVersion: StorageVersion;
      };
    }
  | { ok: true; data: { confirmed: boolean; storageVersion: StorageVersion } }
  | { ok: false; error: { code: string; message: string } };

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function toStorageVersion(snapshot: { resultJson: string; updatedAt: Date | string }): StorageVersion {
  return {
    resultJsonHash: createHash("sha256").update(snapshot.resultJson, "utf8").digest("hex"),
    updatedAt: snapshot.updatedAt instanceof Date
      ? snapshot.updatedAt.toISOString()
      : String(snapshot.updatedAt),
  };
}

function parseStorageVersionInput(value: unknown): StorageVersion | null {
  if (!isRecord(value)) return null;
  const hash = asString(value.resultJsonHash);
  const updatedAt = asString(value.updatedAt);
  if (!/^[a-f0-9]{64}$/.test(hash) || !updatedAt) return null;
  return { resultJsonHash: hash, updatedAt };
}

function parseImportInputs(value: unknown): ReviewImportInput[] | null {
  if (!isRecord(value) || !Array.isArray(value.reviews)) return null;
  if (value.reviews.length === 0 || value.reviews.length > REVIEW_DATASET_MAX_REVIEWS) return null;
  const parsed: ReviewImportInput[] = [];
  for (const raw of value.reviews) {
    if (!isRecord(raw)) return null;
    const role = raw.sourceProductRole;
    if (role !== "current_candidate" && role !== "competitor") return null;
    const rating = raw.rating === null || raw.rating === undefined ? null : raw.rating;
    if (rating !== null && (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5)) return null;
    parsed.push({
      asin: asString(raw.asin),
      sourceProductRole: role as ReviewSourceProductRole,
      reviewText: typeof raw.reviewText === "string" ? raw.reviewText : "",
      rating: rating as number | null,
      reviewTitle: raw.reviewTitle === undefined ? undefined : asString(raw.reviewTitle, "") || undefined,
      reviewId: raw.reviewId === undefined ? undefined : asString(raw.reviewId, "") || undefined,
      reviewDate: raw.reviewDate === undefined ? undefined : asString(raw.reviewDate, "") || undefined,
      verifiedPurchase: raw.verifiedPurchase === null || raw.verifiedPurchase === undefined ? undefined : raw.verifiedPurchase === true,
      locale: raw.locale === undefined ? undefined : asString(raw.locale, "") || undefined,
      language: raw.language === undefined ? undefined : asString(raw.language, "") || undefined,
      sourceUrl: raw.sourceUrl === undefined ? undefined : asString(raw.sourceUrl, "") || undefined,
      sourceRef: raw.sourceRef === undefined ? undefined : asString(raw.sourceRef, "") || undefined,
      bindingNote: raw.bindingNote === undefined ? undefined : asString(raw.bindingNote, "") || undefined,
    });
  }
  return parsed;
}

async function resolveContext(
  request: NextRequest,
  taskId: string,
  bodyRecord?: Record<string, unknown>,
): Promise<{ ok: true; context: AccessContext } | { ok: false; response: NextResponse }> {
  if (isSandboxTaskId(taskId)) {
    const auth = requireAuthenticated(request, bodyRecord);
    if (!auth.ok) {
      return { ok: false, response: NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status }) };
    }
    if (auth.context.mode !== "demo") {
      return { ok: false, response: jsonResponse({ ok: false, error: { code: "not_found", message: "未找到该任务。" } }, 404) };
    }
    return { ok: true, context: auth.context };
  }
  const auth = requireOwnerOnly(request, bodyRecord);
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status }) };
  }
  return { ok: true, context: auth.context };
}

async function getId(context: { params: Promise<{ id: string }> }): Promise<string | null> {
  try {
    const { id } = await context.params;
    return id || null;
  } catch {
    return null;
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ReviewEvidenceError || error instanceof VocAnalysisError || error instanceof ReviewCollectorError) {
    return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, error.status);
  }
  return jsonResponse({ ok: false, error: { code: "server_error", message: "服务器错误，请稍后重试。" } }, 500);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = await getId(context);
  if (!id) return jsonResponse({ ok: false, error: { code: "invalid_id", message: "缺少有效 task id。" } }, 400);
  const resolved = await resolveContext(request, id);
  if (!resolved.ok) return resolved.response;
  try {
    const [snapshot, evidence, analysis, taskAsin] = await Promise.all([
      readReviewEvidenceSnapshot(resolved.context, id),
      getReviewEvidence(resolved.context, id),
      getVocAnalysis(resolved.context, id),
      readBrowserEvidenceTaskAsin(resolved.context, id),
    ]);
    return jsonResponse({
      ok: true,
      data: { evidence, analysis, storageVersion: toStorageVersion(snapshot), taskAsin, capability: resolveBrowserAcquisitionCapability() },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }
  const id = await getId(context);
  if (!id) return jsonResponse({ ok: false, error: { code: "invalid_id", message: "缺少有效 task id。" } }, 400);
  const bodyRecord = isRecord(body) ? body : {};
  const resolved = await resolveContext(request, id, bodyRecord);
  if (!resolved.ok) return resolved.response;

  const action = asString(bodyRecord.action);
  if (action === "import") return importAction(resolved.context, id, bodyRecord);
  if (action === "analyze") return analyzeAction(resolved.context, id, bodyRecord);
  if (action === "clear") return clearAction(resolved.context, id, bodyRecord);
  if (action === "collect") return collectAction(resolved.context, id, bodyRecord);
  if (action === "collect-confirm") return collectConfirmAction(resolved.context, id, bodyRecord);
  return jsonResponse({ ok: false, error: { code: "invalid_action", message: "缺少或非法的 action（import / analyze / clear / collect / collect-confirm）。" } }, 400);
}

async function importAction(
  context: AccessContext,
  taskId: string,
  bodyRecord: Record<string, unknown>,
): Promise<NextResponse> {
  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return jsonResponse({
      ok: false,
      error: { code: "storage_version_required", message: "内容刚在其他位置更新，请刷新后重试。" },
    }, 400);
  }
  const inputs = parseImportInputs(bodyRecord);
  if (inputs === null) {
    return jsonResponse({
      ok: false,
      error: {
        code: "invalid_import_payload",
        message: `导入数据格式无效：需要 reviews 数组（每条含 asin/sourceProductRole/reviewText/rating），单次不超过 ${REVIEW_DATASET_MAX_REVIEWS} 条。`,
      },
    }, 400);
  }
  try {
    const outcome = await importReviews({ context, taskId, expectedStorageVersion, reviews: inputs });
    const snapshotAfter = await readReviewEvidenceSnapshot(context, taskId);
    return jsonResponse({
      ok: true,
      data: {
        outcome: {
          kind: outcome.kind,
          importedCount: outcome.importedCount,
          duplicateCount: outcome.duplicateCount,
          rejectedCount: outcome.rejectedCount,
        },
        evidence: outcome.evidence,
        storageVersion: toStorageVersion(snapshotAfter),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function analyzeAction(
  context: AccessContext,
  taskId: string,
  bodyRecord: Record<string, unknown>,
): Promise<NextResponse> {
  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return jsonResponse({
      ok: false,
      error: { code: "storage_version_required", message: "内容刚在其他位置更新，请刷新后重试。" },
    }, 400);
  }
  // Visitor AI 配额门禁（Owner 直通）；VOC 不新增独立额度
  const quota = ensureDemoAiQuota(context, 1);
  if (!quota.ok) {
    return jsonResponse({ ok: false, error: { code: quota.code, message: quota.message } }, quota.status);
  }
  try {
    const result = await analyzeVoc({ context, taskId, expectedStorageVersion });
    consumeDemoAiCalls(context, 1);
    const snapshotAfter = await readReviewEvidenceSnapshot(context, taskId);
    return jsonResponse({
      ok: true,
      data: {
        analysis: result.analysis,
        unverified: result.unverified.length,
        gateResult: result.gateResult,
        storageVersion: toStorageVersion(snapshotAfter),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function clearAction(
  context: AccessContext,
  taskId: string,
  bodyRecord: Record<string, unknown>,
): Promise<NextResponse> {
  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return jsonResponse({
      ok: false,
      error: { code: "storage_version_required", message: "内容刚在其他位置更新，请刷新后重试。" },
    }, 400);
  }
  try {
    const cleared = await clearReviews({ context, taskId, expectedStorageVersion });
    const snapshotAfter = await readReviewEvidenceSnapshot(context, taskId);
    return jsonResponse({
      ok: true,
      data: { cleared: cleared.cleared, storageVersion: toStorageVersion(snapshotAfter) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 半自动采集 Preview（不写入）：隔离浏览器逐 ASIN 提取详情页公开 Top Reviews 片段 */
async function collectAction(
  context: AccessContext,
  taskId: string,
  bodyRecord: Record<string, unknown>,
): Promise<NextResponse> {
  // Acquisition Capability Gate（§30/§43）：VOC 自动采集复用 Amazon 浏览器采集能力
  const capability = resolveBrowserAcquisitionCapability();
  const gate = acquisitionGateError(capability, browserUnavailableMessage(capability.reasonCategory));
  if (gate) {
    const message = capability.state === "local_env_required"
      ? REVIEW_LOCAL_ENV_REQUIRED_MESSAGE
      : browserUnavailableMessage(capability.reasonCategory);
    return jsonResponse({ ok: false, error: { code: gate.code, message } }, gate.status);
  }
  let asins;
  try {
    asins = assertReviewCollectRequest(bodyRecord.asins);
  } catch (error) {
    if (error instanceof ReviewCollectorError) {
      return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    throw error;
  }
  try {
    const preview = await createReviewCollectPreview({ context, taskId, asins });
    // 重复标记：与现有 dataset 的 duplicateKey 比对（reviewId 缺失时 asin+hash+rating+date）
    const existing = await getReviewEvidence(context, taskId);
    const existingKeys = new Set((existing?.dataset.reviews ?? []).map((review) => review.duplicateKey));
    const items = preview.items.map((item) => {
      const duplicateKey = buildReviewDuplicateKey({
        reviewId: null,
        asin: item.asin,
        contentHash: buildReviewContentHash(item.title),
        rating: item.rating,
        reviewDate: item.date,
      });
      return { ...item, duplicate: existingKeys.has(duplicateKey) };
    });
    return jsonResponse({
      ok: true,
      data: {
        preview: {
          previewId: preview.previewId,
          items,
          pageResults: preview.pageResults,
          capturedAt: preview.capturedAt,
        },
        storageVersion: await readReviewEvidenceSnapshot(context, taskId).then((snapshot) => toStorageVersion(snapshot)),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 人工确认后写入：字段值全部由服务端从 Preview 缓存重建（客户端只传 previewId + 选中索引） */
async function collectConfirmAction(
  context: AccessContext,
  taskId: string,
  bodyRecord: Record<string, unknown>,
): Promise<NextResponse> {
  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return jsonResponse({
      ok: false,
      error: { code: "storage_version_required", message: "内容刚在其他位置更新，请刷新后重试。" },
    }, 400);
  }
  const previewId = asString(bodyRecord.previewId);
  if (!previewId) {
    return jsonResponse({ ok: false, error: { code: "preview_required", message: "缺少采集预览标识。" } }, 400);
  }
  const selectedRaw = bodyRecord.selectedIndices;
  if (!Array.isArray(selectedRaw) || selectedRaw.length === 0 || selectedRaw.length > 20) {
    return jsonResponse({ ok: false, error: { code: "invalid_selection", message: "请选择要确认的评论（1-20 条）。" } }, 400);
  }
  const selectedIndices = selectedRaw
    .map((value) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : -1))
    .filter((value) => value >= 0);
  if (selectedIndices.length === 0) {
    return jsonResponse({ ok: false, error: { code: "invalid_selection", message: "请选择要确认的评论。" } }, 400);
  }
  // Preview 取回（跨主体/跨任务 fail-closed；取回即失效，防止重复确认）
  const preview = takeReviewCollectPreview(previewId, {
    subjectKey: reviewCollectSubjectKey(context),
    taskId,
  });
  if (!preview) {
    return jsonResponse({
      ok: false,
      error: { code: "preview_expired", message: "采集预览已失效（可能已确认或超时），请重新采集。" },
    }, 400);
  }
  try {
    const uniqueIndices = [...new Set(selectedIndices)];
    const selected: Array<{ index: number; item: (typeof preview.items)[number] }> = [];
    for (const index of uniqueIndices) {
      if (index >= 0 && index < preview.items.length) selected.push({ index, item: preview.items[index] });
    }
    if (selected.length === 0) {
      return jsonResponse({ ok: false, error: { code: "invalid_selection", message: "所选评论不在预览范围内。" } }, 400);
    }
    const reviews: ReviewImportInput[] = selected.map(({ item }) => ({
      asin: item.asin,
      sourceProductRole: item.role,
      reviewText: item.title,
      rating: item.rating,
      reviewDate: item.date ?? undefined,
      sourceUrl: item.sourceUrl,
      sourceRef: item.sourceUrl,
      bindingNote: item.bindingNote,
      sourceType: "browser",
      bindingKind: "browser_verified",
      collectorVersion: REVIEW_COLLECTOR_VERSION,
    }));
    await importReviews({ context, taskId, expectedStorageVersion, reviews });
    const snapshotAfter = await readReviewEvidenceSnapshot(context, taskId);
    return jsonResponse({
      ok: true,
      data: { confirmed: true, storageVersion: toStorageVersion(snapshotAfter) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
