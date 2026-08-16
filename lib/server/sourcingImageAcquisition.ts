/**
 * V3.5 — 1688 Image Acquisition 业务层（Native1688ExtensionDriver 门面；R1 正式替换）
 *
 * Contract §42（R1 Amendment）+ §31/§37/§77：
 * - 图片来源：已知 Candidate image（SSRF 守卫下载）或用户明确选择的本地图片；不读取任意本机文件。
 * - 图搜执行：Authenticated Loopback Bridge → Qingxuan 1688 Narrow Extension → 普通 Chrome（无 debugger）。
 * - CDP 旧驱动 LEGACY_DISABLED：本模块不再调用 tools/collectors/1688（诊断/历史保留）；
 *   NO_AUTOMATIC_FALLBACK_TO_CDP = TRUE（扩展失败 → 明确错误或 Manual Fallback）。
 * - 图搜结果 = Candidate Discovery（AcquisitionCandidate，matchState=unknown，role=similar），
 *   不自动成为 Evidence（Preview → Human Confirm 不变）。
 * - 前台窗口约束（FULLY_AUTOMATED_IN_ACTIVE_FOREGROUND_BROWSER_SESSION）：页面/窗口需在前台
 *   （后台 tab 定时器节流会导致心跳稀疏；扩展层已做 visibilitychange/focus 补发）。
 */

import "server-only";

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidTargetUrl } from "@/lib/server/ssrfGuard";
import { SourcingAcquisitionError, type AcquisitionCandidate } from "@/lib/upstream/1688/contracts";
import type { ImageAcquisitionRunTrace } from "@/tools/collectors/1688/image-search-contract";
import {
  NATIVE_1688_BRIDGE_VERSION,
  NATIVE_1688_EXTENSION_DRIVER_VERSION,
  Native1688BridgeClient,
  getSharedBridge,
  type BridgeCommandType,
} from "@/lib/server/native1688BridgeClient";

export const IMAGE_ACQUISITION_DRIVER_VERSION = NATIVE_1688_EXTENSION_DRIVER_VERSION;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);
const UPLOAD_RETRIES = 3;
const RESULT_PAGE_WAIT_MS = 45_000;

function fail(code: string, status: number, message: string): never {
  throw new SourcingAcquisitionError(code, status, message);
}

/** 下载候选图片到临时目录（SSRF 守卫 + 类型/大小限制） */
async function downloadCandidateImage(imageUrl: string): Promise<{ path: string; contentType: string }> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    fail("invalid_image_url", 400, "候选图片链接非法。");
  }
  if (url.protocol !== "https:") fail("invalid_image_url", 400, "候选图片仅支持 https 链接。");
  const safe = await isValidTargetUrl(url);
  if (!safe) fail("invalid_image_url", 400, "候选图片链接未通过安全校验（禁止内网/本地地址）。");

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!response.ok) fail("image_download_failed", 502, "候选图片下载失败。");
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    fail("invalid_image_url", 400, `候选图片类型不支持（${contentType || "unknown"}）。`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) {
    fail("invalid_image_url", 400, "候选图片大小超出限制（≤30MB）。");
  }
  const dir = await mkdtemp(join(tmpdir(), "v35-1688-image-"));
  const path = join(dir, "candidate-image.bin");
  await writeFile(path, bytes);
  return { path, contentType };
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep) => {
    const timer = setTimeout(resolveSleep, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolveSleep();
      }, { once: true });
    }
  });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) fail("timeout", 504, "图片获取已取消。");
}

/** 扩展/桥错误归一化（§25/§26/§27 状态语义） */
function mapBridgeFailure(code: string, status: { extensionSeen: boolean; lastExtensionSeenAt: number }): never {
  if (!status.extensionSeen) {
    fail("extension_not_installed", 503, "未检测到轻选 1688 扩展，请先在普通 Chrome 中加载扩展并打开 1688 页面。");
  }
  fail("extension_disconnected", 503, "轻选 1688 扩展连接中断，请检查 Chrome 窗口与扩展状态后重试。");
}

/** getState 结果解析（结构校验 fail-closed） */
type PageState = {
  ok: boolean;
  pageKind?: string;
  pageUrl?: string;
  uploadTarget?: { found?: boolean; unique?: boolean };
  preview?: { confirmed?: boolean; srcLength?: number };
  resultPage?: { resultsReady?: boolean };
  code?: string;
};

function parsePageState(value: Record<string, unknown>): PageState {
  const isRecord = (item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item);
  return {
    ok: value.ok === true,
    pageKind: typeof value.pageKind === "string" ? value.pageKind : undefined,
    pageUrl: typeof value.pageUrl === "string" ? value.pageUrl : undefined,
    uploadTarget: isRecord(value.uploadTarget) ? value.uploadTarget as PageState["uploadTarget"] : undefined,
    preview: isRecord(value.preview) ? value.preview as PageState["preview"] : undefined,
    resultPage: isRecord(value.resultPage) ? value.resultPage as PageState["resultPage"] : undefined,
    code: typeof value.code === "string" ? value.code : undefined,
  };
}

/**
 * 图片找货（正式驱动）：候选图片 → 1688 原生图搜（无 debugger）→ AcquisitionCandidate[]（+ trace）。
 * 错误码（§53 扩展）：extension_not_installed / extension_disconnected / auth_required /
 * risk_control_required / page_identity_unknown / upload_target_not_found / upload_not_confirmed /
 * search_trigger_not_confirmed / image_results_insufficient / timeout。
 */
export async function acquireByImage(input: {
  imageUrl?: string;
  localImagePath?: string;
  taskId: string;
  candidateId: string;
  capturedAt?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** 测试注入：自定义桥客户端（默认 Native1688BridgeClient） */
  bridgeFactory?: () => Pick<Native1688BridgeClient, "start" | "getStatus" | "registerJob" | "enqueue" | "waitResult">;
}): Promise<{ candidates: AcquisitionCandidate[]; trace: ImageAcquisitionRunTrace }> {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const startedAt = Date.now();
  const signal = input.signal;

  // 1) 图片来源（§13/§77：仅授权候选图或用户明确选择）
  let imageBytes: Buffer;
  let contentType: string;
  let tempDir = "";
  if (input.localImagePath) {
    if (!existsSync(input.localImagePath)) fail("invalid_image_url", 400, "候选图片文件不存在。");
    const size = statSync(input.localImagePath).size;
    if (size < 1 || size > MAX_IMAGE_BYTES) fail("invalid_image_url", 400, "本地图片大小超出限制（≤30MB）。");
    const ext = input.localImagePath.split(".").pop()?.toLowerCase() ?? "";
    contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
    if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) fail("invalid_image_url", 400, `本地图片类型不支持（${ext}）。`);
    imageBytes = Buffer.from(await readFile(input.localImagePath));
  } else if (input.imageUrl) {
    const downloaded = await downloadCandidateImage(input.imageUrl);
    tempDir = downloaded.path.split("candidate-image.bin")[0];
    imageBytes = Buffer.from(await readFile(downloaded.path));
    contentType = downloaded.contentType;
  } else {
    fail("invalid_image_url", 400, "缺少候选图片（imageUrl 或 localImagePath）。");
  }

  try {
    assertNotAborted(signal);
    // 2) 桥与扩展状态（进程级共享单例；测试可注入）
    const bridge = input.bridgeFactory ? input.bridgeFactory() : getSharedBridge();
    await bridge.start(input.env);
    // 等待扩展 SW 通过心跳连接 bridge（刚刷新扩展/页面恢复前台时需要时间；最长 10s）
    let status = await bridge.getStatus();
    const extensionSeenDeadline = Date.now() + 10_000;
    while (!status.extensionSeen && Date.now() < extensionSeenDeadline) {
      assertNotAborted(signal);
      await sleep(500, signal);
      status = await bridge.getStatus();
    }
    if (!status.extensionSeen) {
      mapBridgeFailure("extension_not_installed", status);
    }

    // 3) 注册 job（§13/§48：taskId/candidateId/imageHash 绑定）
    const jobId = await bridge.registerJob({
      imageBase64: imageBytes.toString("base64"),
      meta: {
        taskId: input.taskId,
        candidateId: input.candidateId,
        imageHash: sha256Hex(imageBytes),
        contentType,
      },
    });

    // 4) getState：页面身份（§26 AUTH_REQUIRED / §27 RISK_CONTROL / §16 上传入口 proof）
    await bridge.enqueue(jobId, { type: "getState" });
    let state = parsePageState(await bridge.waitResult(jobId, 30_000));
    assertNotAborted(signal);
    if (!state.ok) mapBridgeFailure(String(state.code ?? "timeout"), await bridge.getStatus());
    if (state.pageKind === "login_wall") {
      fail("auth_required", 401, "1688 未登录或会话过期，请在普通 Chrome 中正常登录 1688 后重试。");
    }
    if (state.pageKind === "risk_control") {
      fail("risk_control_required", 403, "1688 触发了验证，请在页面完成验证后重试（系统不会绕过）。");
    }
    if (state.pageKind !== "upload_page" || !state.uploadTarget?.found || !state.uploadTarget?.unique) {
      fail("page_identity_unknown", 422, "1688 图搜页面未就绪（请确认 s.1688.com 图搜页已打开且扩展已加载）。");
    }

    // 5) upload + Upload Identity Proof（§15；重试 ≤3）
    let uploadOk = false;
    for (let attempt = 1; attempt <= UPLOAD_RETRIES && !uploadOk; attempt++) {
      assertNotAborted(signal);
      await bridge.enqueue(jobId, { type: "upload" });
      const upload = await bridge.waitResult(jobId, 60_000);
      if (!upload.ok) {
        if (attempt < UPLOAD_RETRIES) {
          await sleep(3_000, signal);
          continue;
        }
        fail("upload_not_confirmed", 422, "1688 图片上传失败（上传入口不可用或页面状态异常）。");
      }
      await sleep(3_000, signal);
      await bridge.enqueue(jobId, { type: "getState" });
      state = parsePageState(await bridge.waitResult(jobId, 30_000));
      const preview = state.preview ?? {};
      const localBase64Len = Math.ceil(imageBytes.length / 3) * 4;
      const identityOk = preview.confirmed === true
        && typeof preview.srcLength === "number"
        && Math.abs(preview.srcLength - localBase64Len) <= Math.max(256, localBase64Len * 0.01);
      if (identityOk) {
        uploadOk = true;
      } else if (attempt < UPLOAD_RETRIES) {
        await sleep(3_000, signal);
      }
    }
    if (!uploadOk) {
      fail("upload_not_confirmed", 422, "上传预览与候选图片不一致（Wrong Upload 门禁），已停止。");
    }

    // 6) submit（No Double Submit 由 bridge phase 门禁保证；§31/§32）
    assertNotAborted(signal);
    await bridge.enqueue(jobId, { type: "submit" });
    const submit = await bridge.waitResult(jobId, 60_000);
    if (!submit.ok) {
      fail("search_trigger_not_confirmed", 422, `“搜索图片”触发失败（${String(submit.code ?? "unknown")}）。`);
    }

    // 7) 结果页证明（§19：imageId + result route + 非推荐流；≤45s）
    let resultReady = false;
    const deadline = Date.now() + RESULT_PAGE_WAIT_MS;
    while (Date.now() < deadline) {
      assertNotAborted(signal);
      await sleep(1_000, signal);
      await bridge.enqueue(jobId, { type: "getState" });
      state = parsePageState(await bridge.waitResult(jobId, 15_000));
      if (state.ok && state.pageKind === "result_page" && state.resultPage?.resultsReady === true) {
        resultReady = true;
        break;
      }
    }
    if (!resultReady) {
      fail("search_trigger_not_confirmed", 422, "未进入真实图搜结果页（疑似推荐流或提交未生效），已停止。");
    }

    // 8) collect（§20：data-renderkey offerId；同卡片绑定；bounded；dedupe）
    await sleep(1_500, signal);
    await bridge.enqueue(jobId, { type: "collect" });
    const collect = await bridge.waitResult(jobId, 30_000);
    const cards = Array.isArray(collect.cards) ? collect.cards as Array<{
      offerId?: unknown; title?: unknown; priceText?: unknown; moqText?: unknown;
      imageUrl?: unknown; detailUrl?: unknown; entityBound?: unknown;
    }> : [];
    if (cards.length < 3) {
      fail("image_results_insufficient", 422, `图搜结果不足（${cards.length} < 3）。`);
    }
    const candidates: AcquisitionCandidate[] = [];
    const seen = new Set<string>();
    for (const card of cards) {
      const offerId = typeof card.offerId === "string" ? card.offerId : "";
      if (!/^\d{5,20}$/.test(offerId) || seen.has(offerId)) continue;
      seen.add(offerId);
      candidates.push({
        schema: "acquisition-candidate.v1",
        source: "1688",
        offerId,
        sourceUrl: typeof card.detailUrl === "string" && card.detailUrl
          ? card.detailUrl
          : `https://detail.1688.com/offer/${offerId}.html`,
        capturedAt,
        acquisitionMethod: "image",
        sourceProductRole: "similar",
        title: typeof card.title === "string" ? card.title.slice(0, 200) : "",
        images: typeof card.imageUrl === "string" && card.imageUrl ? [card.imageUrl] : [],
        displayedPrice: typeof card.priceText === "string" && card.priceText
          ? { text: card.priceText, nature: "displayed_price" }
          : null,
        priceRange: null,
        priceTiers: [],
        displayedMoq: typeof card.moqText === "string" && card.moqText
          ? { text: card.moqText, value: null, nature: "displayed_moq" }
          : null,
        skuSpecs: [],
        sellerClaims: [],
        platformMetadata: [],
        supplierDisplayName: "",
        matchState: "unknown",
      });
    }
    if (candidates.length < 3) {
      fail("image_results_insufficient", 422, `图搜结果去重后不足（${candidates.length} < 3）。`);
    }

    const trace: ImageAcquisitionRunTrace = {
      source: "1688",
      method: "image",
      query: input.imageUrl ?? input.localImagePath ?? "",
      timestamp: new Date().toISOString(),
      driverVersion: NATIVE_1688_EXTENSION_DRIVER_VERSION,
      resolverVersion: "native-1688-upload-resolver.v2|native-1688-image-submit-resolver.v2|native-1688-result-extractor.v2",
      success: true,
      failClosedReason: null,
      pageState: "results_ready",
      durationMs: Date.now() - startedAt,
      candidateImageBound: true,
    };
    return { candidates, trace };
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** 错误归一化（业务错误分类 §53；扩展状态语义 §25-§27） */
export function normalizeImageAcquisitionError(error: unknown): { code: string; status: number; message: string } {
  if (error instanceof SourcingAcquisitionError) {
    return { code: error.code, status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "extension_bridge_not_available", status: 503, message: `图片获取失败：${message.slice(0, 200)}` };
}
