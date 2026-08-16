import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import { TaskResultJsonMutationError } from "@/lib/server/taskResultJsonMutation";
import {
  generateCreativeHandoffPreview,
  getCreativeHandoffDetail,
} from "@/lib/server/productCreativeHandoffPreview";
import {
  createOrAppendCreativeHandoff,
  revokeCreativeHandoffAction,
  CreativeHandoffPersistenceError,
} from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import type { ProductCreativeHandoffCandidate } from "@/lib/productCreativeHandoff";
import { ProductCreativeHandoffError } from "@/lib/productCreativeHandoff";
import {
  isManualFactField,
  normalizeManualFactValue,
  type ManualFactInput,
} from "@/lib/server/manualFactConfirmation";

// ─── 常量 ────────────────────────────────────────────────

const MAX_BODY_BYTES = 128 * 1024; // 128 KiB
const MAX_SELECTION_ITEMS = 256;
const MAX_SELECTION_ITEM_LENGTH = 256;
const MAX_CREATIVE_PREFERENCES_BYTES = 16 * 1024; // 16 KiB
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_ACTIONS = new Set(["create", "revoke"]);
const VALID_REVOKE_REASONS = new Set([
  "explicit_user_revoke",
  "decision_changed",
  "identity_invalid",
  "verification_invalid",
]);

// 顶层允许字段白名单（按 action 分派）
const CREATE_TOP_LEVEL_FIELDS = new Set([
  "action",
  "requestId",
  "expectedResearchRevision",
  "expectedCurrentHandoffRevision",
  "expectedStorageVersion",
  "selectedFactCandidateIds",
  "selectedVisualReferenceCandidateIds",
  "manualConfirmedFacts",
  "confirmed",
  "creativePreferences",
]);
const REVOKE_TOP_LEVEL_FIELDS = new Set([
  "action",
  "requestId",
  "expectedCurrentHandoffRevision",
  "expectedStorageVersion",
  "revokeReasonCode",
]);

// 禁止输入字段（任意层级检测的关键字）
const FORBIDDEN_KEYS = new Set([
  "creativeHandoff",
  "creativeHandoffRequestLedger",
  "candidateId",
  "handoffId",
  "revision",
  "fingerprint",
  "requestKeyHash",
  "requestFingerprint",
  "resultJson",
  "writerKind",
  "ownedNamespaces",
  "createdBy",
  "confirmedBy",
  "approvedBy",
  "createdAt",
  "confirmedAt",
  "controlState",
  "effectiveStatus",
  "__proto__",
  "constructor",
  "prototype",
]);

// ─── 错误响应 ────────────────────────────────────────────

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 递归检测禁止字段（含嵌套与原型污染）。 */
function containsForbiddenKey(value: unknown, depth = 0): string | null {
  if (depth > 16) return null;
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
      if (key.startsWith("_")) return key; // 内部下划线字段一律拒绝
    }
    for (const key of Object.keys(value)) {
      const hit = containsForbiddenKey(value[key], depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  return null;
}

function parseStorageVersion(value: unknown): { resultJsonHash: string; updatedAt: string } | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).length !== 2) return null;
  if (typeof value.resultJsonHash !== "string" || !/^[a-f0-9]{64}$/.test(value.resultJsonHash)) return null;
  if (typeof value.updatedAt !== "string" || !value.updatedAt) return null;
  const parsed = new Date(value.updatedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return { resultJsonHash: value.resultJsonHash, updatedAt: parsed.toISOString() };
}

function parseSelectionIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SELECTION_ITEMS) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_SELECTION_ITEM_LENGTH) return null;
    out.push(item);
  }
  if (new Set(out).size !== out.length) return null; // 重复拒绝
  return out;
}

function parseCreativePreferences(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || Object.keys(value).length === 0) return null;
  const allowed = new Set(["targetMarket", "language", "tone", "targetAudiencePreference", "imageStyle", "backgroundPreference", "compositionPreference", "additionalRequirements"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return null;
    const item = value[key];
    if (typeof item !== "string") return null;
    const limit = key === "additionalRequirements" ? 200 : 300;
    if (item.length > limit) return null;
  }
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > MAX_CREATIVE_PREFERENCES_BYTES) return null;
  return { ...value };
}

/** 零候选兜底：解析手工确认事实（受控字段白名单；value 限长；重复 field 拒绝） */
function parseManualConfirmedFacts(value: unknown): ManualFactInput[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return null;
  const seen = new Set<string>();
  const seenOtherValues = new Set<string>();
  const out: ManualFactInput[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (Object.keys(item).length !== 2) return null;
    const { field, value: rawValue } = item as { field?: unknown; value?: unknown };
    if (!isManualFactField(field)) return null;
    // Quality.1：other 允许重复（多个功能/其他事实）；非 other 字段去重
    if (field !== "other") {
      if (seen.has(field)) return null;
      seen.add(field);
    }
    const normalized = normalizeManualFactValue(rawValue);
    if (!normalized) return null;
    if (field === "other") {
      if (seenOtherValues.has(normalized)) return null;
      seenOtherValues.add(normalized);
    }
    out.push({ field, value: normalized });
  }
  return out;
}

function parseRequestId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return null;
  if (!UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function parseExpectedRevision(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

// ─── Auth ────────────────────────────────────────────────

function getAuth(req: NextRequest, id: string, bodyRecord: Record<string, unknown>) {
  if (isSandboxTaskId(id) || id.startsWith("demo-") || id.startsWith("sandbox-")) {
    const auth = requireAuthenticated(req, bodyRecord);
    if (!auth.ok) {
      return { auth: null, ctx: null as unknown, error: NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status }) };
    }
    if (auth.context!.mode !== "demo") {
      return { auth: null, ctx: null as unknown, error: NextResponse.json({ ok: false, error: { code: "not_found", message: "未找到该任务。" } }, { status: 404 }) };
    }
    return { auth, ctx: auth.context!, error: null };
  }
  const auth = requireOwnerOnly(req, bodyRecord);
  if (!auth.ok) {
    return { auth: null, ctx: null as unknown, error: NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status }) };
  }
  return { auth, ctx: auth.context!, error: null };
}

// ─── GET ─────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { ctx, error } = getAuth(req, id, {});
  if (error) return error;

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");
    if (mode === "preview") {
      const { preview, gate } = await generateCreativeHandoffPreview(id, ctx);
      // R4/R6：跨身份/不存在资源统一 404（不泄露 legacy_not_supported 等业务状态）；
      // 同一 actor 可访问但业务不可用 → 200 + gateReason（UI 显示准确状态，不伪装"不存在"）
      if (!gate.allowed && gate.taskAccessible === false) {
        return errorResponse(404, "task_not_found", "任务不存在。");
      }
      return NextResponse.json({ preview, gateReason: gate.reason });
    }
    const { detail, gate } = await getCreativeHandoffDetail(id, ctx);
    if (!gate.allowed && gate.taskAccessible === false) {
      return errorResponse(404, "task_not_found", "任务不存在。");
    }
    return NextResponse.json({ detail, gateReason: gate.reason });
  } catch (err) {
    if (err instanceof CreativeHandoffPersistenceError) {
      // Micro-Gate: 统一不存在错误码 — 不泄露资源存在性
      const code = err.code === "not_found" ? "task_not_found" : err.code;
      return errorResponse(err.status, code, err.message);
    }
    if (err instanceof TaskResultJsonMutationError) {
      const code = err.code === "not_found" ? "task_not_found" : err.code;
      return errorResponse(err.status, code, err.message);
    }
    throw err;
  }
}

// ─── POST ─────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // ── 请求体大小预检（Content-Length）──
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return errorResponse(413, "request_too_large", "请求体过大。");
  }

  let rawBody: string;
  try {
    const buffer = await req.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, "request_too_large", "请求体过大。");
    }
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return errorResponse(413, "request_too_large", "请求体过大。");
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }
  if (!isRecord(body)) {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }

  const { ctx, error } = getAuth(req, id, body);
  if (error) return error;

  // ── 禁止字段检测（任意层级）──
  const forbidden = containsForbiddenKey(body);
  if (forbidden) {
    return errorResponse(400, "forbidden_field", `禁止字段: ${forbidden}`);
  }

  // ── action ──
  const action = body.action;
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    return errorResponse(400, "invalid_action", "不支持的操作类型。");
  }

  // ── 顶层未知字段白名单（按 action）──
  const allowedTopLevel = action === "create" ? CREATE_TOP_LEVEL_FIELDS : REVOKE_TOP_LEVEL_FIELDS;
  for (const key of Object.keys(body)) {
    if (!allowedTopLevel.has(key)) {
      return errorResponse(400, "unknown_field", `未知字段: ${key}`);
    }
  }

  // ── requestId ──
  const requestId = parseRequestId(body.requestId);
  if (!requestId) {
    return errorResponse(400, "invalid_request_id", "请求标识必须是有效的 UUID。");
  }

  // ── expectedStorageVersion（必填，Fix.2 P1-1）──
  const expectedStorageVersion = parseStorageVersion(body.expectedStorageVersion);
  if (!expectedStorageVersion) {
    return errorResponse(400, "invalid_storage_version", "内容刚在其他位置更新，请刷新后重试。");
  }

  // ── REVOKE ──
  if (action === "revoke") {
    const reasonCode = body.revokeReasonCode;
    if (typeof reasonCode !== "string" || !VALID_REVOKE_REASONS.has(reasonCode)) {
      return errorResponse(400, "invalid_revoke_reason", "撤回原因无效。");
    }
    const expectedCurrentHandoffRevision = parseExpectedRevision(body.expectedCurrentHandoffRevision);
    if (expectedCurrentHandoffRevision === null || expectedCurrentHandoffRevision < 1) {
      return errorResponse(400, "invalid_handoff_revision", "交接版本无效。");
    }

    try {
      const result = await revokeCreativeHandoffAction(id, ctx, {
        requestId,
        revokeReasonCode: reasonCode as "explicit_user_revoke",
        expectedStorageVersion,
      });

      return NextResponse.json({
        handoffId: result.handoff.handoffId,
        controlState: result.handoff.controlState,
        idempotentReplay: result.idempotentReplay,
      });
    } catch (err) {
      // Micro-Gate: 统一不存在错误码 — 不泄露资源存在性
      if (err instanceof CreativeHandoffPersistenceError) {
        const code = err.code === "not_found" ? "task_not_found" : err.code;
        return errorResponse(err.status, code, err.message);
      }
      if (err instanceof TaskResultJsonMutationError) {
        const code = err.code === "not_found" ? "task_not_found" : err.code;
        return errorResponse(err.status, code, err.message);
      }
      throw err;
    }
  }

  // ── CREATE ──
  const expectedResearchRevision = parseExpectedRevision(body.expectedResearchRevision);
  if (expectedResearchRevision === null || expectedResearchRevision < 1) {
    return errorResponse(400, "invalid_research_revision", "研究版本无效。");
  }
  const expectedCurrentHandoffRevision = parseExpectedRevision(body.expectedCurrentHandoffRevision);
  if (expectedCurrentHandoffRevision === null) {
    return errorResponse(400, "invalid_handoff_revision", "交接版本无效。");
  }
  if (body.confirmed !== true) {
    return errorResponse(400, "confirmation_required", "请确认创作交接内容后提交。");
  }
  const selectedFactCandidateIds = parseSelectionIds(body.selectedFactCandidateIds);
  if (selectedFactCandidateIds === null) {
    return errorResponse(400, "invalid_selection", "选择的商品事实无效。");
  }
  let creativePreferences: Record<string, unknown> | undefined;
  if (body.creativePreferences !== undefined) {
    const parsedPrefs = parseCreativePreferences(body.creativePreferences);
    if (parsedPrefs === null) {
      return errorResponse(400, "invalid_creative_preferences", "创作偏好无效。");
    }
    creativePreferences = parsedPrefs;
  }

  try {
    // Get latest server preview for candidate building
    const { gate } = await generateCreativeHandoffPreview(id, ctx);
    // Fail-closed: 已存在但解析失败的 Handoff 不得当作 null 覆盖
    if (gate.handoffContractInvalid) {
      return errorResponse(500, "handoff_contract_invalid", "创作交接合同结构异常，已阻止覆盖。");
    }
    // Fix.5: no_confirmed_facts 是合法研究状态（来源层可见，可提交 confirmable selectionId），
    // 由锁内确认转换决定成败；其他拒绝状态才阻断。
    if (!gate.allowed && gate.reason !== "no_confirmed_facts") {
      // Micro-Gate: 跨身份/不存在资源统一 404 — 不泄露 legacy_not_supported 等业务状态
      if (gate.reason === "legacy_not_supported") {
        return errorResponse(404, "task_not_found", "任务不存在。");
      }
      return errorResponse(422, "research_gate_failed", "当前研究状态不允许创建创作交接。");
    }
    if (!gate.candidate) {
      return errorResponse(422, "research_gate_failed", "当前研究状态不允许创建创作交接。");
    }

    // Fix.4: 浏览器只提交 confirmable selectionIds；候选匹配/确认转换在锁内由服务端完成。
    // 预检：候选或手工事实至少一项（与 Persistence 锁内校验一致，此处仅提前拒绝）
    const manualConfirmedFacts = parseManualConfirmedFacts(body.manualConfirmedFacts);
    if (manualConfirmedFacts === null) {
      return errorResponse(400, "invalid_manual_fact", "手工商品事实无效。");
    }
    // V2 Final Integration: 视觉参考候选选择（用户勾选「批准作为产品视觉参考」；未提供=空=不批准）
    const selectedVisualReferenceIds = body.selectedVisualReferenceCandidateIds === undefined
      ? []
      : parseSelectionIds(body.selectedVisualReferenceCandidateIds);
    if (selectedVisualReferenceIds === null) {
      return errorResponse(400, "invalid_visual_reference_selection", "视觉参考选择无效。");
    }

    // 纯视觉参考批准（无新事实）合法 — 与 Persistence 锁内 visualApprovalOnly 分支一致
    // （继承当前 Handoff 的 confirmedFacts；若尚无 Handoff 则无事实可继承 → 拒绝）
    if (selectedFactCandidateIds.length < 1 && manualConfirmedFacts.length < 1 && selectedVisualReferenceIds.length < 1) {
      return errorResponse(400, "no_facts_selected", "请至少选择一项或填写一项可用的商品事实。");
    }

    const requestFingerprint = buildRequestFingerprint({
      action: "create",
      selectedFactIds: selectedFactCandidateIds,
      selectedVisualReferenceIds: selectedVisualReferenceIds,
      ...(manualConfirmedFacts.length > 0 ? { manualConfirmedFacts } : {}),
      creativePreferences,
      expectedStorageVersion,
      expectedResearchRevision,
      expectedCurrentHandoffRevision,
      confirmed: true,
    });

    const result = await createOrAppendCreativeHandoff(id, ctx, {
      requestId,
      expectedResearchRevision,
      expectedCurrentHandoffRevision,
      expectedStorageVersion,
      selectedFactCandidateIds,
      selectedVisualReferenceCandidateIds: selectedVisualReferenceIds,
      ...(manualConfirmedFacts.length > 0 ? { manualConfirmedFacts } : {}),
      ...(creativePreferences && Object.keys(creativePreferences).length > 0
        ? { creativePreferences: creativePreferences as Record<string, string> }
        : {}),
      requestFingerprint,
    });

    return NextResponse.json({
      handoffId: result.handoff.handoffId,
      currentRevision: result.handoff.currentRevision,
      isNewRevision: result.isNewRevision,
      idempotentReplay: result.idempotentReplay,
    }, { status: result.isNewRevision && !result.idempotentReplay ? 201 : 200 });
  } catch (err) {
    if (err instanceof CreativeHandoffPersistenceError) {
      // Micro-Gate: 统一不存在错误码 — 不泄露资源存在性
      const code = err.code === "not_found" ? "task_not_found" : err.code;
      return errorResponse(err.status, code, err.message);
    }
    if (err instanceof TaskResultJsonMutationError) {
      const code = err.code === "not_found" ? "task_not_found" : err.code;
      return errorResponse(err.status, code, err.message);
    }
    if (err instanceof ProductCreativeHandoffError && err.code === "invalid_handoff_candidate") {
      // P1-2 门禁协调：候选投影失败（如 blocking issue）→ 稳定业务错误 422，
      // 不再是意外 500；前端可读 code 提示研究状态不允许创建。
      return errorResponse(422, "invalid_handoff_candidate", "当前研究状态不允许创建创作交接。");
    }
    if (err instanceof ProductCreativeHandoffError && err.code === "handoff_revoked") {
      // 撤回后的创作资料是终态，不允许继续追加新版本（服务端分类保持不变，
      // 仅对外返回用户可理解的产品语言，不再暴露内部英文 message）。
      return errorResponse(409, "handoff_revoked", "该创作资料已撤回，无法继续编辑。如需重新整理商品资料，请创建新的创作资料。");
    }
    throw err;
  }
}
