import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { readBrowserEvidenceTaskAsin } from "@/lib/server/browserEvidence";
import { browserEvidenceSubjectKey, collectBrowserEvidencePreview } from "@/lib/server/browserEvidenceCollect";
import { buildAmazonFactEnrichmentPreview } from "@/lib/server/amazonFactEnrichment/service";
import {
  amazonFactEnrichmentKey,
  bindAmazonPreviewSelectionIds,
  clearAmazonFactEnrichmentInFlight,
  findAmazonFactEnrichmentPreview,
  getAmazonFactEnrichmentInFlight,
  getAmazonFactEnrichmentPreview,
  putAmazonFactEnrichmentPreview,
  setAmazonFactEnrichmentInFlight,
  type AmazonFactEnrichmentResult,
} from "@/lib/server/amazonFactEnrichment/previewStore";

export const runtime = "nodejs";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id?: string }> }) {
  const auth = requireAuthenticated(req);
  if (!auth.ok) return response({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  const { id } = await ctx.params;
  if (!id) return response({ ok: false, error: { code: "invalid_task_id", message: "缺少有效 task id。" } }, 400);
  const asin = await readBrowserEvidenceTaskAsin(auth.context, id);
  if (!asin) return response({ ok: false, error: { code: "task_asin_unbound", message: "当前任务缺少权威 Amazon ASIN。" } }, 400);
  const evidenceId = new URL(req.url).searchParams.get("evidenceId");
  if (!evidenceId) {
    const found = findAmazonFactEnrichmentPreview({ subjectKey: browserEvidenceSubjectKey(auth.context), taskId: id, asin });
    return response({ ok: true, data: { status: found ? "pending" : "empty", asin, preview: found?.preview ?? null, ...(found ? { evidenceId: found.evidenceId } : {}) } });
  }
  try {
    const preview = getAmazonFactEnrichmentPreview({
      evidenceId,
      subjectKey: browserEvidenceSubjectKey(auth.context),
      taskId: id,
      asin,
    });
    return response({ ok: true, data: { status: "pending", asin, preview, evidenceId } });
  } catch {
    return response({ ok: true, data: { status: "empty", asin, preview: null } });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id?: string }> }) {
  const auth = requireAuthenticated(req);
  if (!auth.ok) return response({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  const { id } = await ctx.params;
  if (!id) return response({ ok: false, error: { code: "invalid_task_id", message: "缺少有效 task id。" } }, 400);
  const asin = await readBrowserEvidenceTaskAsin(auth.context, id);
  if (!asin) return response({ ok: false, error: { code: "task_asin_unbound", message: "当前任务缺少权威 Amazon ASIN。" } }, 400);

  const subjectKey = browserEvidenceSubjectKey(auth.context);
  const key = amazonFactEnrichmentKey(auth.context, id, asin);
  const requestedEvidenceId = new URL(req.url).searchParams.get("evidenceId");
  if (requestedEvidenceId) {
    try {
      const preview = getAmazonFactEnrichmentPreview({ evidenceId: requestedEvidenceId, subjectKey, taskId: id, asin });
      return response({ ok: true, data: { status: "reused", preview, evidenceId: requestedEvidenceId } });
    } catch {
      // 过期/不匹配的预览不能阻断重新采集。
    }
  }
  const existing = findAmazonFactEnrichmentPreview({ subjectKey, taskId: id, asin });
  if (existing) return response({ ok: true, data: { status: "reused", preview: existing.preview, evidenceId: existing.evidenceId } });
  const running = getAmazonFactEnrichmentInFlight(key);
  if (running) {
    const result = await running;
    return response({ ok: true, data: { status: "reused", preview: result.preview, evidenceId: result.evidenceId } });
  }

  const operation: Promise<AmazonFactEnrichmentResult> = (async () => {
    const collectedAt = new Date().toISOString();
    const browser = await collectBrowserEvidencePreview({ asin, capturedAt: collectedAt });
    if (!browser.extraction.entityBound) throw new Error("wrong_asin");
    const preview = await buildAmazonFactEnrichmentPreview({
      taskId: id,
      asin,
      blocks: browser.sellerContent || [],
      structured: browser.productInfo?.canonicalFacts || {},
      collectedAt,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    const evidenceId = randomUUID();
    const boundPreview = bindAmazonPreviewSelectionIds(preview, { subjectKey, evidenceId });
    putAmazonFactEnrichmentPreview({ evidenceId, subjectKey, preview: boundPreview });
    return { preview: boundPreview, evidenceId };
  })();
  setAmazonFactEnrichmentInFlight(key, operation);
  try {
    const result = await operation;
    return response({ ok: true, data: { status: "collected", preview: result.preview, evidenceId: result.evidenceId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Amazon 富化采集失败";
    const wrongAsin = message === "wrong_asin";
    return response({
      ok: false,
      error: {
        code: wrongAsin ? "wrong_asin" : "enrichment_unavailable",
        message: wrongAsin
          ? "Amazon 页面实体与任务绑定 ASIN 不一致，已停止富化。"
          : message.includes("验证码") ? message : "Amazon 商品补充资料暂时不可用，不影响 Listing 主流程。",
      },
    }, wrongAsin ? 422 : 502);
  } finally {
    clearAmazonFactEnrichmentInFlight(key);
  }
}

