/**
 * Phase 2 — 竞品 Evidence API（competitor-evidence.v1 合同）
 * GET  /api/tasks/[id]/competitor-evidence  读取竞品列表 + storageVersion
 * POST /api/tasks/[id]/competitor-evidence  人工添加（上限 5、去重）
 * DELETE /api/tasks/[id]/competitor-evidence 删除单条
 * 只允许人工维护；写入经 mutateTaskResultJson（writer 所有权 + 乐观并发）。
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  addCompetitorAsin,
  CompetitorEvidenceError,
  getCompetitorEvidence,
  readCompetitorEvidenceSnapshot,
  removeCompetitorAsin,
  type CompetitorEvidenceV1,
} from "@/lib/server/competitorEvidence";
import {
  assertBrowserUseOwnerOnly,
  isAllowedCollectorSourceUrl,
  marketplaceToAmazonTld,
  selectReliableSearchKeyword,
  type BrowserUseKeywordPreviewItem,
  resolveBrowserUseSeed,
  storeBrowserUsePreview,
  takeBrowserUsePreview,
} from "@/lib/server/browserUseResearch";
import { runSellerSpriteCollection } from "@/tools/collectors/browser-use/sellerSpriteCollector";
import { runAmazonCompetitorCollection, amazonCompetitorObservationToPreview } from "@/tools/collectors/browser-use/amazonCompetitorCollector";
import { getRuntimeMode } from "@/lib/server/runtimeMode";
import type { AccessContext } from "@/lib/server/accessPassword";

export const runtime = "nodejs";

type StorageVersion = { resultJsonHash: string; updatedAt: string };
type ApiResponse =
  | { ok: true; data: { evidence: CompetitorEvidenceV1; storageVersion: StorageVersion } }
  | { ok: true; data: { kind: "competitor"; preview: import("@/lib/server/browserUseResearch").BrowserUseResearchPreview; previewId: string; keywordPreviewId?: string; keywordCount?: number } }
  | { ok: true; data: { evidence: CompetitorEvidenceV1; storageVersion: StorageVersion; saved: string[]; skipped: { asin: string; code: string }[] } }
  | { ok: false; error: { code: string; message: string; detail?: string } };

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
  if (error instanceof CompetitorEvidenceError) {
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
    const snapshot = await readCompetitorEvidenceSnapshot(resolved.context, id);
    const evidence = await getCompetitorEvidence(resolved.context, id);
    return jsonResponse({
      ok: true,
      data: { evidence, storageVersion: toStorageVersion(snapshot) },
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
  if (action === "collect_browser_use" || action === "save_browser_use") {
    // 轮 9：Browser Use 自动采集竞品（仅 local owner；先预览、确认后保存）
    try {
      assertBrowserUseOwnerOnly(resolved.context);
      if (getRuntimeMode() !== "local_owner") {
        return jsonResponse({ ok: false, error: { code: "browser_use_local_env_required", message: "自动采集仅限本机环境使用。" } }, 403);
      }
      const snapshot = await readCompetitorEvidenceSnapshot(resolved.context, id);
      const record = (() => { try { const parsed = JSON.parse(snapshot.resultJson) as unknown; return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { return null; } })();
      const seed = resolveBrowserUseSeed(record);
      if (!seed) {
        return jsonResponse({ ok: false, error: { code: "browser_use_identity_unavailable", message: "该任务没有可验证的权威商品身份（批次/卖家精灵事实缺失或不完整），无法启动自动采集。" } }, 409);
      }
      if (action === "collect_browser_use") {
        // ① SellerSprite 关键词（复用已成功链路，只读）
        const kwRun = await runSellerSpriteCollection({
          kind: "keyword",
          seedAsin: seed.asin,
          marketplaceTld: marketplaceToAmazonTld(seed.marketplace),
          productUrl: seed.productUrl,
        });
        if (!kwRun.ok) {
          return jsonResponse({ ok: false, error: { code: "seller_sprite_keyword_failed", message: "SellerSprite 关键词采集失败：" + (kwRun.failureReason === "collector_unavailable" ? "采集引擎不可用（未启动或超时）。" : "未获得有效页面观察。") + " 不继续，也不改用它途。", detail: kwRun.failureReason } }, 502);
        }
        // ② 可靠搜索关键词：第一个非空、非纯品牌词（不做标题猜测）
        const keyword = selectReliableSearchKeyword(kwRun.preview.results as BrowserUseKeywordPreviewItem[]);
        if (!keyword) {
          return jsonResponse({ ok: false, error: { code: "no_reliable_search_keyword", message: "SellerSprite 关键词没有可用的非品牌查询词，已停止（不从标题瞎猜）。" } }, 409);
        }
        // ③ Amazon 搜索竞品发现（排除 seed/广告/重复/外站）
        const compRun = await runAmazonCompetitorCollection({
          seedAsin: seed.asin,
          marketplaceTld: marketplaceToAmazonTld(seed.marketplace),
          keyword,
        });
        if (!compRun.ok) {
          return jsonResponse({ ok: false, error: { code: "amazon_competitor_collect_failed", message: compRun.failureReason === "collector_unavailable" ? "浏览器采集引擎不可用（未启动或超时），请重试。" : "Amazon 搜索采集失败：未获得有效页面观察。", detail: compRun.failureReason } }, 502);
        }
        const preview = amazonCompetitorObservationToPreview(
          { seedAsin: seed.asin, marketplaceTld: marketplaceToAmazonTld(seed.marketplace), keyword },
          compRun.observation,
          kwRun.preview.collector.version,
        );
        const previewId = storeBrowserUsePreview(preview);
        // 轮 10 合并：同一次采集的关键词预览一并暂存，关键词证据区可直接消费（省一次浏览器采集）。
        const keywordPreviewId = storeBrowserUsePreview(kwRun.preview);
        return jsonResponse({ ok: true, data: { kind: "competitor", preview, previewId, keywordPreviewId, keywordCount: kwRun.preview.results.length } });
      }
      // save_browser_use
      const previewId = asString(bodyRecord.previewId);
      if (!previewId) return jsonResponse({ ok: false, error: { code: "preview_id_required", message: "缺少预览 ID。" } }, 400);
      const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
      if (expectedStorageVersion === null) {
        return jsonResponse({ ok: false, error: { code: "storage_version_required", message: "内容刚在其他位置更新，请刷新后重试。" } }, 400);
      }
      const preview = takeBrowserUsePreview(previewId);
      if (!preview) return jsonResponse({ ok: false, error: { code: "preview_not_found", message: "预览不存在或已过期，请重新采集。" } }, 400);
      if (preview.kind !== "competitor") return jsonResponse({ ok: false, error: { code: "preview_kind_mismatch", message: "预览类型与保存目标不一致。" } }, 400);
      if (preview.failureReason !== null) return jsonResponse({ ok: false, error: { code: "preview_not_collectable", message: "预览采集未成功（" + preview.failureReason + "），没有可保存的数据。" } }, 400);
      if (!isAllowedCollectorSourceUrl(preview.sourceUrl)) {
        return jsonResponse({ ok: false, error: { code: "forged_external_source_url", message: "采集来源不是 Amazon 官方页面，已拒绝保存。" } }, 400);
      }
      if (preview.seedAsin !== seed.asin) {
        return jsonResponse({ ok: false, error: { code: "seed_asin_mismatch", message: "当前任务的商品身份已变化，请重新采集后再确认。不做覆盖。" } }, 409);
      }
      const savedAsins: string[] = [];
      const skipped: { asin: string; code: string }[] = [];
      let currentVersion = expectedStorageVersion;
      for (const result of preview.results) {
        try {
          const detailBullets = Array.isArray(result.bullets) && result.bullets.length > 0
            ? {
                bullets: result.bullets.slice(0, 5),
                capturedAt: result.capturedAt || preview.capturedAt,
                sourceUrl: result.sourceUrl,
              }
            : null;
          await addCompetitorAsin({
            context: resolved.context,
            taskId: id,
            asin: result.asin,
            note: result.title.slice(0, 200) || undefined,
            autoProvenance: {
              collector: preview.collector,
              sourceUrl: preview.sourceUrl,
              capturedAt: result.capturedAt || preview.capturedAt,
              reasonCodes: ["browser_use_collected"],
            },
            expectedStorageVersion: currentVersion,
            ...(detailBullets ? { detailBullets } : {}),
          });
          savedAsins.push(result.asin);
          const after = await readCompetitorEvidenceSnapshot(resolved.context, id);
          currentVersion = toStorageVersion(after);
        } catch (error) {
          const code = error instanceof CompetitorEvidenceError ? error.code : "save_failed";
          skipped.push({ asin: result.asin, code });
          if (code === "task_result_conflict") break;
        }
      }
      const evidence = await getCompetitorEvidence(resolved.context, id);
      const finalSnapshot = await readCompetitorEvidenceSnapshot(resolved.context, id);
      return jsonResponse({ ok: true, data: { evidence, storageVersion: toStorageVersion(finalSnapshot), saved: savedAsins, skipped } });
    } catch (error) {
      if (error && typeof error === "object" && (error as { code?: unknown }).code === "browser_use_local_owner_only") {
        return jsonResponse({ ok: false, error: { code: "browser_use_local_owner_only", message: "Browser Use 自动采集仅限本机 Owner 使用。" } }, 403);
      }
      return errorResponse(error);
    }
  }

  const asin = asString(bodyRecord.asin);
  if (!asin) {
    return jsonResponse({ ok: false, error: { code: "invalid_asin", message: "缺少 ASIN。" } }, 400);
  }
  const note = bodyRecord.note === undefined ? undefined : asString(bodyRecord.note);
  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return jsonResponse({
      ok: false,
      error: { code: "storage_version_required", message: "内容刚在其他位置更新，请刷新后重试。" },
    }, 400);
  }

  try {
    const evidence = await addCompetitorAsin({
      context: resolved.context,
      taskId: id,
      asin,
      note,
      expectedStorageVersion,
    });
    const snapshot = await readCompetitorEvidenceSnapshot(resolved.context, id);
    return jsonResponse({
      ok: true,
      data: { evidence, storageVersion: toStorageVersion(snapshot) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
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

  const asin = asString(bodyRecord.asin);
  if (!asin) {
    return jsonResponse({ ok: false, error: { code: "invalid_asin", message: "缺少 ASIN。" } }, 400);
  }
  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return jsonResponse({
      ok: false,
      error: { code: "storage_version_required", message: "内容刚在其他位置更新，请刷新后重试。" },
    }, 400);
  }

  try {
    const evidence = await removeCompetitorAsin({
      context: resolved.context,
      taskId: id,
      asin,
      expectedStorageVersion,
    });
    const snapshot = await readCompetitorEvidenceSnapshot(resolved.context, id);
    return jsonResponse({
      ok: true,
      data: { evidence, storageVersion: toStorageVersion(snapshot) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
