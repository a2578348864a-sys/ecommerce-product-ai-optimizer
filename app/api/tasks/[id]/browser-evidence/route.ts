/**
 * V3.3 — Browser Evidence API（browser-evidence.v1 合同）
 * GET  /api/tasks/[id]/browser-evidence  读取已保存证据 + storageVersion + 任务绑定 ASIN
 * POST /api/tasks/[id]/browser-evidence  action=collect：受控浏览器导航任务绑定 ASIN 单页 → 提取 → 返回 Preview（不保存）
 * POST /api/tasks/[id]/browser-evidence  action=save：凭 evidenceId 取回服务端 Preview → ASIN 三一致硬门禁 → 写入（confirmed:true）
 *
 * 安全：不读 Cookie/Token；不绕 CAPTCHA（fail-closed 明确错误）；不保存完整 HTML；
 * Preview 服务端生成并短暂缓存，客户端回传的字段值不被信任。
 */
import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  BrowserEvidenceError,
  readBrowserEvidence,
  readBrowserEvidenceSnapshot,
  readBrowserEvidenceTaskAsin,
  saveBrowserEvidence,
  type BrowserEvidenceV1,
} from "@/lib/server/browserEvidence";
import {
  BrowserEvidenceCollectError,
  browserEvidenceSubjectKey,
  buildConfirmedSnapshot,
  collectBrowserEvidencePreview,
  storeBrowserEvidencePreview,
  takeBrowserEvidencePreview,
  type BrowserEvidenceCollectPreview,
} from "@/lib/server/browserEvidenceCollect";
import type { AccessContext } from "@/lib/server/accessPassword";

export const runtime = "nodejs";

type StorageVersion = { resultJsonHash: string; updatedAt: string };
type ApiResponse =
  | { ok: true; data: { evidence: BrowserEvidenceV1 | null; storageVersion: StorageVersion; taskAsin: string | null } }
  | { ok: true; data: { preview: BrowserEvidenceCollectPreview; evidenceId: string } }
  | { ok: true; data: { kind: "saved" | "duplicate"; evidence: BrowserEvidenceV1; storageVersion: StorageVersion } }
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
  if (error instanceof BrowserEvidenceError || error instanceof BrowserEvidenceCollectError) {
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
    const [snapshot, evidence, taskAsin] = await Promise.all([
      readBrowserEvidenceSnapshot(resolved.context, id),
      readBrowserEvidence(resolved.context, id),
      readBrowserEvidenceTaskAsin(resolved.context, id),
    ]);
    return jsonResponse({
      ok: true,
      data: { evidence, storageVersion: toStorageVersion(snapshot), taskAsin },
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
  if (action === "collect") {
    return collectAction(resolved.context, id);
  }
  if (action === "save") {
    return saveAction(resolved.context, id, bodyRecord);
  }
  return jsonResponse({ ok: false, error: { code: "invalid_action", message: "缺少或非法的 action（collect / save）。" } }, 400);
}

/** collect：受控浏览器导航任务绑定 ASIN 单页 → 提取 → 服务端缓存 Preview（不保存） */
async function collectAction(context: AccessContext, taskId: string): Promise<NextResponse> {
  try {
    const taskAsin = await readBrowserEvidenceTaskAsin(context, taskId);
    if (!taskAsin) {
      return jsonResponse({
        ok: false,
        error: {
          code: "task_asin_unbound",
          message: "当前任务缺少 Amazon 商品身份信息（productUrl / ASIN），无法确定采集目标。请返回候选商品补充 Amazon 商品来源（SellerSprite 导入应自动继承），再重新开始研究。",
        },
      }, 400);
    }
    const capturedAt = new Date().toISOString();
    const preview = await collectBrowserEvidencePreview({ asin: taskAsin, capturedAt });
    const evidenceId = randomUUID();
    storeBrowserEvidencePreview({
      evidenceId,
      preview,
      capturedAt,
      expiresAt: Date.now() + 15 * 60 * 1000,
      subjectKey: browserEvidenceSubjectKey(context),
      taskId,
      asin: taskAsin,
    });
    return jsonResponse({ ok: true, data: { preview, evidenceId } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** save：取回服务端 Preview → ASIN 三一致硬门禁 → 构建快照 → 写入（confirmed:true + dedupe） */
async function saveAction(
  context: AccessContext,
  taskId: string,
  bodyRecord: Record<string, unknown>,
): Promise<NextResponse> {
  const evidenceId = asString(bodyRecord.evidenceId);
  if (!evidenceId || !/^[a-z0-9-]{8,64}$/i.test(evidenceId)) {
    return jsonResponse({ ok: false, error: { code: "invalid_evidence_id", message: "缺少有效的证据采集编号（evidenceId）。" } }, 400);
  }
  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return jsonResponse({
      ok: false,
      error: { code: "storage_version_required", message: "缺少或非法的 expectedStorageVersion（并发保护）。" },
    }, 400);
  }
  const stored = takeBrowserEvidencePreview(evidenceId, {
    subjectKey: browserEvidenceSubjectKey(context),
    taskId,
  });
  if (!stored) {
    return jsonResponse({
      ok: false,
      error: {
        code: "preview_expired",
        message: "采集预览已失效（过期或已被保存）。请重新点击「采集页面证据」后再确认保存。",
      },
    }, 409);
  }
  try {
    const taskAsin = await readBrowserEvidenceTaskAsin(context, taskId);
    if (!taskAsin) {
      return jsonResponse({
        ok: false,
        error: { code: "task_asin_unbound", message: "任务缺少 Amazon 商品身份信息（productUrl / ASIN），无法保存浏览器证据。请返回候选商品补充 Amazon 商品来源后重新开始研究。" },
      }, 400);
    }
    const snapshot = buildConfirmedSnapshot({
      preview: stored.preview,
      taskAsin,
      capturedAt: stored.capturedAt,
      context,
    });
    const outcome = await saveBrowserEvidence({
      context,
      taskId,
      expectedStorageVersion,
      snapshot,
    });
    const snapshotAfter = await readBrowserEvidenceSnapshot(context, taskId);
    return jsonResponse({
      ok: true,
      data: {
        kind: outcome.kind,
        evidence: outcome.evidence,
        storageVersion: toStorageVersion(snapshotAfter),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
