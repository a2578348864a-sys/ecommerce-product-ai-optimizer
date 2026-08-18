/**
 * V3.5 — Sourcing Acquisition API（Search Results → Preview → Human Confirm → Sourcing Evidence）
 *
 * GET  /api/tasks/[id]/sourcing                 读取已保存证据 + storageVersion + 工具/登录状态
 * POST action=search  {keyword}                 关键词搜索 → 服务端调用只读 CLI → Preview（不保存）
 * POST action=url     {url}                     1688 offer URL → 白名单校验 → 详情 → Preview（不保存）
 * POST action=detail  {offerId}                 单 offer 详情（Preview 面板补充展示，不入 Preview Store）
 * POST action=save    {previewId, selectedOfferIds, expectedStorageVersion}
 *                                               人工确认后保存 Formal Sourcing Evidence（服务端 revalidate）
 *
 * 安全：
 * - 客户端只传 identity + selection，字段值全部服务端重建（Contract §69）。
 * - Preview Store 绑定 subjectKey + taskId，跨主体/跨任务取用 fail-closed（§42/§44）。
 * - save 时对选中候选逐个拉详情并做 Entity Binding 交叉验证（Wrong Entity = 0，§30）。
 * - 写命令（inquiry/cart/order/...）在本 Route 无任何代码路径（§12/§25）。
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import type { AccessContext } from "@/lib/server/accessPassword";
import {
  SourcingEvidenceError,
  createSourcingPreview,
  getSourcingEvidence,
  readSourcingEvidenceSnapshot,
  saveSourcingEvidence,
  takeSourcingPreview,
} from "@/lib/server/sourcingEvidence";
import {
  SOURCING_CLI_DRIVER_VERSION,
  begin1688KeywordLogin,
  buildCliLoginHint,
  checkCliLogin,
  getOfferDetailById,
  searchOffersByKeyword,
} from "@/lib/server/sourcingAcquisition";
import {
  acquireByImage,
  normalizeImageAcquisitionError,
} from "@/lib/server/sourcingImageAcquisition";
import {
  SourcingAcquisitionError,
  type AcquisitionCandidate,
  type AcquisitionMethod,
  type AcquisitionRunTrace,
} from "@/lib/upstream/1688/contracts";
import { crossValidateCandidateWithDetail, validate1688OfferUrl } from "@/lib/upstream/1688/entityBinding";
import { getSharedBridge, NATIVE_1688_HELPER_SW_VERSION } from "@/lib/server/native1688BridgeClient";
import {
  isLocalAcquisitionEnabled,
  resolveSourcingAcquisitionCapabilities,
  SOURCING_LOCAL_ENV_REQUIRED_MESSAGE,
  type AcquisitionCapability,
} from "@/lib/server/acquisitionCapability";
import {
  DEMO_ACQUISITION_EVIDENCE_ID,
  DEMO_SOURCING_EVIDENCE_SAMPLE,
} from "@/lib/server/demoAcquisitionSamples";

export const runtime = "nodejs";

const MAX_DETAIL_ENRICH = 3;
const MAX_SELECTED = 20;

type StorageVersion = { resultJsonHash: string; updatedAt: string };

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ ok: false, error: { code, message } }, status);
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
      return { ok: false, response: jsonResponse({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status) };
    }
    if (auth.context.mode !== "demo") {
      return { ok: false, response: errorResponse(404, "not_found", "未找到该任务。") };
    }
    return { ok: true, context: auth.context };
  }
  const auth = requireOwnerOnly(request, bodyRecord);
  if (!auth.ok) {
    return { ok: false, response: jsonResponse({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status) };
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

function errorResponseFrom(error: unknown): NextResponse {
  if (error instanceof SourcingEvidenceError || error instanceof SourcingAcquisitionError) {
    return errorResponse(error.status, error.code, error.message);
  }
  return errorResponse(500, "server_error", "服务器错误，请稍后重试。");
}

/** 构造单候选（URL 获取路径：详情 → 候选，method=url） */
function candidateFromDetail(detail: Awaited<ReturnType<typeof getOfferDetailById>>["detail"]): AcquisitionCandidate {
  return {
    schema: "acquisition-candidate.v1",
    source: "1688",
    offerId: detail.offerId,
    sourceUrl: detail.sourceUrl,
    capturedAt: detail.capturedAt,
    acquisitionMethod: "url",
    sourceProductRole: "candidate",
    title: detail.title,
    images: detail.mainImages,
    displayedPrice: detail.displayedPrice,
    priceRange: detail.priceRange,
    priceTiers: detail.priceTiers,
    displayedMoq: detail.displayedMoq,
    skuSpecs: detail.skuSpecs,
    sellerClaims: detail.sellerClaims,
    platformMetadata: detail.platformMetadata,
    supplierDisplayName: detail.supplierDisplayName,
    matchState: null,
  };
}

/** save 前详情补全（增强，非强制）：对选中候选逐个拉详情 + Entity Binding 交叉验证（Wrong Entity = 0）。
 *  详情拉取失败（风控/网络/超时）→ 降级保存服务端 search 候选并加可追溯标记（§69 revalidate 对象是 preview 候选，
 *  enrich 不阻断落盘；UI 显示"页面未显示"与标记，用户可后续查看详情）。 */
async function enrichCandidates(
  candidates: AcquisitionCandidate[],
  selectedOfferIds: string[],
): Promise<AcquisitionCandidate[]> {
  const byOfferId = new Map(candidates.map((candidate) => [candidate.offerId, candidate]));
  const enriched: AcquisitionCandidate[] = [];
  for (const offerId of selectedOfferIds.slice(0, MAX_DETAIL_ENRICH)) {
    const candidate = byOfferId.get(offerId);
    if (!candidate) continue;
    try {
      const { detail } = await getOfferDetailById({ offerId });
      const binding = crossValidateCandidateWithDetail(candidate, detail); // offerId 不一致即抛
      if (!binding.ok) continue;
      enriched.push({
        ...candidate,
        displayedPrice: detail.displayedPrice ?? candidate.displayedPrice,
        priceRange: detail.priceRange ?? candidate.priceRange,
        priceTiers: detail.priceTiers.length > 0 ? detail.priceTiers : candidate.priceTiers,
        displayedMoq: detail.displayedMoq ?? candidate.displayedMoq,
        skuSpecs: detail.skuSpecs.length > 0 ? detail.skuSpecs : candidate.skuSpecs,
        sellerClaims: detail.sellerClaims.length > 0 ? detail.sellerClaims : candidate.sellerClaims,
        platformMetadata: [...candidate.platformMetadata, ...detail.platformMetadata].slice(0, 40),
        supplierDisplayName: detail.supplierDisplayName || candidate.supplierDisplayName,
      });
    } catch {
      // 降级：保留服务端 search 候选（同实体绑定已由结构层保证），标记详情未补全
      enriched.push({
        ...candidate,
        platformMetadata: [
          ...candidate.platformMetadata,
          { name: "detailEnrichmentFailed", value: "true", evidenceClass: "platform_metadata" as const },
        ].slice(0, 40),
      });
    }
  }
  return enriched;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = await getId(context);
  if (!id) return errorResponse(400, "invalid_id", "缺少有效 task id。");
  const resolved = await resolveContext(request, id);
  if (!resolved.ok) return resolved.response;
  try {
    const evidence = await getSourcingEvidence(resolved.context, id);
    const snapshot = await readSourcingEvidenceSnapshot(resolved.context, id);
    // Acquisition Capability（§16/§17）：非本地 runtime 直接返回 local_env_required，
    // 不触发 CLI/bridge 探测（避免公网反复 spawn/探测）；已保存证据仍正常读取。
    if (!isLocalAcquisitionEnabled()) {
      const noTool: AcquisitionCapability = { state: "local_env_required", reasonCategory: "local_environment_required" };
      return jsonResponse({
        ok: true,
        data: {
          evidence,
          storageVersion: toStorageVersion(snapshot),
          toolStatus: {
            loggedIn: false,
            toolAvailable: false,
            cli: { loggedIn: false, toolAvailable: false },
            image: { extensionAvailable: false, versionCompatible: false, extensionSwVersion: null, reasonCode: "local_environment_required" },
            loginHint: null,
            checkedAt: new Date().toISOString(),
          },
          capabilities: { keyword: noTool, image: noTool, detail: noTool },
        },
      });
    }
    const login = await checkCliLogin();
    // F3：分能力 readiness（顶层字段向后兼容；image 能力独立于 CLI）
    const imageCapability = await probeImageCapability();
    // D1：登录引导——工具可用但未登录时，给出固定登录命令（仅 UI 展示，业务层不执行 login）
    const loginHint = login.toolAvailable && !login.loggedIn ? buildCliLoginHint() : null;
    // R1：重新检测反馈——本次检测时间戳（UI 显示"刚刚检测：HH:MM"）
    const checkedAt = new Date().toISOString();
    return jsonResponse({
      ok: true,
      data: {
        evidence,
        storageVersion: toStorageVersion(snapshot),
        toolStatus: {
          ...login,
          cli: login,
          image: imageCapability,
          loginHint,
          checkedAt,
        },
        capabilities: resolveSourcingAcquisitionCapabilities({
          cliToolAvailable: login.toolAvailable,
          cliLoggedIn: login.loggedIn,
          imageExtensionAvailable: imageCapability.extensionAvailable,
          imageVersionCompatible: imageCapability.versionCompatible,
        }),
      },
    });
  } catch (error) {
    return errorResponseFrom(error);
  }
}

/** 实时采集 action → 公网（非本地 runtime）能力 Gate：统一 409 local_environment_required（§30/§31）。
 *  本地 runtime 放行给原逻辑（自带 fail-closed 与本地诊断，§19/§21/§38）。 */
function sourcingActionCapabilityGate(action: string): { code: string; message: string } | null {
  if (isLocalAcquisitionEnabled()) return null;
  const realtimeActions = ["begin-keyword-login", "search", "url", "image", "detail"];
  if (!realtimeActions.includes(action)) return null;
  return { code: "local_environment_required", message: SOURCING_LOCAL_ENV_REQUIRED_MESSAGE };
}

/** 图片找货能力探测：扩展是否已通过 bridge 心跳（与 1688-cli 登录完全无关）。
 *  V3 Final R13（§195-197）：readiness 必须含 Protocol Handshake——
 *  connected + 扩展 SW 版本与期望协议版本一致（extensionSwVersion === NATIVE_1688_HELPER_SW_VERSION）；
 *  版本不匹配 → extension_version_mismatch（UI 显示"浏览器助手需要更新"，不假绿）。 */
async function probeImageCapability(): Promise<{
  extensionAvailable: boolean;
  versionCompatible: boolean;
  extensionSwVersion: string | null;
  reasonCode: string;
}> {
  try {
    const bridge = getSharedBridge();
    await Promise.race([
      bridge.start(process.env),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
    const status = await bridge.getStatus();
    if (!status.extensionSeen) {
      return { extensionAvailable: false, versionCompatible: false, extensionSwVersion: null, reasonCode: "extension_not_seen" };
    }
    const swVersion = status.extensionSwVersion ?? null;
    const versionCompatible = swVersion === NATIVE_1688_HELPER_SW_VERSION;
    return {
      extensionAvailable: true,
      versionCompatible,
      extensionSwVersion: swVersion,
      reasonCode: versionCompatible ? "extension_seen" : "extension_version_mismatch",
    };
  } catch {
    return { extensionAvailable: false, versionCompatible: false, extensionSwVersion: null, reasonCode: "bridge_unavailable" };
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = await getId(context);
  if (!id) return errorResponse(400, "invalid_id", "缺少有效 task id。");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "请求体不是合法 JSON。");
  }
  const bodyRecord = isRecord(body) ? body : {};
  const action = asString(bodyRecord.action);
  const resolved = await resolveContext(request, id, bodyRecord);
  if (!resolved.ok) return resolved.response;

  // ── Acquisition Capability Gate（§30/§44）：本地实时采集动作在非本地 runtime 一律 409 typed ──
  // Demo 模式（公网 Visitor 采集体验回放）：本地采集能力不可用（非本地 runtime）时，
  // 用预置真实 1688 供应线索样本回放 search/url/image/detail → save 全链；
  // 结果带 demo 标记，前端必须展示“演示数据”，不伪装实时采集。
  const demoReplayActions = ["search", "url", "image", "detail"];
  if (resolved.context.mode === "demo" && !isLocalAcquisitionEnabled() && demoReplayActions.includes(action)) {
    try {
      const query = action === "search"
        ? asString(bodyRecord.keyword)
        : action === "url" ? asString(bodyRecord.url) : asString(bodyRecord.offerId);
      const runTrace: AcquisitionRunTrace = {
        source: "1688",
        method: action as AcquisitionMethod,
        query,
        timestamp: new Date().toISOString(),
        driverVersion: "demo-replay.v1",
        resolverVersion: null,
        success: true,
        failClosedReason: null,
      };
      const preview = createSourcingPreview({
        context: resolved.context,
        taskId: id,
        method: action as "keyword" | "url" | "image",
        query,
        runTrace,
        candidates: DEMO_SOURCING_EVIDENCE_SAMPLE.candidates,
      });
      return jsonResponse({
        ok: true,
        data: {
          preview: {
            previewId: preview.previewId,
            method: preview.method,
            query: preview.query,
            candidates: preview.candidates,
            expiresAt: preview.expiresAt,
          },
          trace: preview.runTrace,
          demo: true,
        },
      });
    } catch (error) {
      return errorResponseFrom(error);
    }
  }
  const sourcingGate = sourcingActionCapabilityGate(action);
  if (sourcingGate) {
    return errorResponse(409, sourcingGate.code, sourcingGate.message);
  }

  // ── action=begin-keyword-login：R1——固定安全登录 capability（打开 1688 登录窗口）──
  if (action === "begin-keyword-login") {
    try {
      await begin1688KeywordLogin();
      return jsonResponse({
        ok: true,
        data: { started: true, hint: "已在电脑上打开 1688 登录窗口，请完成扫码；完成后点击「重新检测」确认登录。" },
      });
    } catch (error) {
      return errorResponseFrom(error);
    }
  }

  // ── action=search：关键词搜索（只读 CLI）→ Preview ──
  if (action === "search") {
    const keyword = asString(bodyRecord.keyword);
    if (!keyword) return errorResponse(400, "invalid_query", "缺少搜索关键词。");
    try {
      const { candidates, trace } = await searchOffersByKeyword({ keyword });
      const runTrace: AcquisitionRunTrace = {
        source: "1688",
        method: "keyword",
        query: keyword,
        timestamp: new Date().toISOString(),
        driverVersion: trace.driverVersion,
        resolverVersion: null,
        success: true,
        failClosedReason: null,
      };
      const preview = createSourcingPreview({
        context: resolved.context,
        taskId: id,
        method: "keyword",
        query: keyword,
        runTrace,
        candidates,
      });
      return jsonResponse({
        ok: true,
        data: {
          preview: {
            previewId: preview.previewId,
            method: preview.method,
            query: preview.query,
            candidates: preview.candidates,
            expiresAt: preview.expiresAt,
          },
          trace: preview.runTrace,
        },
      });
    } catch (error) {
      return errorResponseFrom(error);
    }
  }

  // ── action=url：1688 offer URL → 白名单校验 → 详情 → Preview ──
  if (action === "url") {
    const url = asString(bodyRecord.url);
    if (!url) return errorResponse(400, "invalid_url", "缺少 1688 offer URL。");
    const validated = validate1688OfferUrl(url);
    if (!validated) return errorResponse(400, "invalid_url", "仅支持 detail.1688.com / m.1688.com 的合法 offer 链接。");
    try {
      const { detail, trace } = await getOfferDetailById({ offerId: validated.offerId });
      const candidate = candidateFromDetail(detail);
      const runTrace: AcquisitionRunTrace = {
        source: "1688",
        method: "url",
        query: validated.url,
        timestamp: new Date().toISOString(),
        driverVersion: trace.driverVersion,
        resolverVersion: null,
        success: true,
        failClosedReason: null,
      };
      const preview = createSourcingPreview({
        context: resolved.context,
        taskId: id,
        method: "url",
        query: validated.url,
        runTrace,
        candidates: [candidate],
      });
      return jsonResponse({
        ok: true,
        data: {
          preview: {
            previewId: preview.previewId,
            method: preview.method,
            query: preview.query,
            candidates: preview.candidates,
            expiresAt: preview.expiresAt,
          },
          trace: preview.runTrace,
        },
      });
    } catch (error) {
      return errorResponseFrom(error);
    }
  }

  // ── action=image：候选图片 → 1688 原生图搜 → Preview ──
  if (action === "image") {
    const imageUrl = asString(bodyRecord.imageUrl);
    if (!imageUrl) return errorResponse(400, "invalid_image_url", "缺少候选图片链接。");
    if (imageUrl.length > 2_048) return errorResponse(400, "invalid_image_url", "图片链接过长。");
    try {
      // §48：job 绑定 actor 的任务与候选身份（candidateId 由任务派生）
      const { candidates, trace } = await acquireByImage({
        imageUrl,
        taskId: id,
        candidateId: `task:${id}`,
      });
      const runTrace: AcquisitionRunTrace = {
        source: "1688",
        method: "image",
        query: imageUrl,
        timestamp: new Date().toISOString(),
        driverVersion: trace.driverVersion,
        resolverVersion: trace.resolverVersion,
        success: trace.success,
        failClosedReason: trace.failClosedReason,
      };
      const preview = createSourcingPreview({
        context: resolved.context,
        taskId: id,
        method: "image",
        query: imageUrl,
        runTrace,
        candidates,
      });
      return jsonResponse({
        ok: true,
        data: {
          preview: {
            previewId: preview.previewId,
            method: preview.method,
            query: preview.query,
            candidates: preview.candidates,
            expiresAt: preview.expiresAt,
          },
          trace: preview.runTrace,
        },
      });
    } catch (error) {
      const normalized = normalizeImageAcquisitionError(error);
      return errorResponse(normalized.status, normalized.code, normalized.message);
    }
  }

  // ── action=detail：单 offer 详情（Preview 面板补充；不创建 Preview） ──
  if (action === "detail") {
    const offerId = asString(bodyRecord.offerId);
    if (!/^\d{5,20}$/.test(offerId)) return errorResponse(400, "invalid_offer_id", "offerId 非法。");
    try {
      const { detail } = await getOfferDetailById({ offerId });
      return jsonResponse({ ok: true, data: { detail } });
    } catch (error) {
      return errorResponseFrom(error);
    }
  }

  // ── action=save：Human Confirm 后保存 Formal Evidence ──
  if (action === "save") {
    const previewId = asString(bodyRecord.previewId);
    if (!previewId) return errorResponse(400, "preview_required", "缺少 previewId。");
    const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
    if (expectedStorageVersion === null) {
      return errorResponse(400, "storage_version_required", "内容刚在其他位置更新，请刷新后重试。");
    }
    if (!Array.isArray(bodyRecord.selectedOfferIds)) {
      return errorResponse(400, "invalid_selection", "缺少确认的 offer 列表。");
    }
    const selectedOfferIds = bodyRecord.selectedOfferIds
      .map((value) => asString(value))
      .filter((offerId) => /^\d{5,20}$/.test(offerId));
    if (selectedOfferIds.length === 0) {
      return errorResponse(400, "no_confirmed_candidates", "没有人工确认的候选。");
    }
    if (selectedOfferIds.length > MAX_SELECTED) {
      return errorResponse(400, "too_many_selected", `单次最多确认 ${MAX_SELECTED} 个候选。`);
    }
    const preview = takeSourcingPreview(previewId, {
      subjectKey: resolved.context.mode === "demo" ? `visitor:${resolved.context.demoAccessId}` : "owner:v1",
      taskId: id,
    });
    if (!preview) {
      return errorResponse(410, "preview_expired", "预览已过期或不属于当前任务，请重新搜索。");
    }
    const selectedSet = new Set(selectedOfferIds);
    const confirmedCandidates = preview.candidates.filter((candidate) => selectedSet.has(candidate.offerId));
    if (confirmedCandidates.length !== selectedSet.size) {
      return errorResponse(400, "candidate_mismatch", "确认列表与预览候选不一致，已拒绝保存。");
    }
    try {
      // 详情补全 + Entity Binding 交叉验证（服务端重新验证，不信任客户端字段）。
      // Demo 回放（公网演示环境）：预览来自预置样本（driverVersion=demo-replay.v1），
      // 跳过真实详情拉取；候选字段为历史真实采集样本，保存链与正式一致。
      const isDemoReplay = resolved.context.mode === "demo"
        && preview.runTrace.driverVersion === "demo-replay.v1";
      const enriched = isDemoReplay
        ? confirmedCandidates
        : await enrichCandidates(confirmedCandidates, selectedOfferIds);
      const evidence = await saveSourcingEvidence({
        context: resolved.context,
        taskId: id,
        method: preview.method,
        query: preview.query,
        runTrace: preview.runTrace,
        candidates: enriched,
        confirmedOfferIds: selectedOfferIds,
        expectedStorageVersion,
      });
      const snapshot = await readSourcingEvidenceSnapshot(resolved.context, id);
      return jsonResponse({
        ok: true,
        data: { evidence, storageVersion: toStorageVersion(snapshot) },
      });
    } catch (error) {
      return errorResponseFrom(error);
    }
  }

  // V3 Final R13（§210/§211）：未知 action 用户文案不泄漏内部 operation 列表；
  // 原始 action 只进服务端日志（诊断用）。
   
  console.error("[sourcing] unknown action", { action });
  return errorResponse(400, "invalid_action", "操作无法识别，请刷新页面后重试。");
}
