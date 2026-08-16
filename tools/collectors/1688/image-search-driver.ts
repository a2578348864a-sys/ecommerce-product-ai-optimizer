/**
 * V3.5 — 1688 Native Image Search 驱动（编排层）
 *
 * Contract §32/§33/§37/§38/§39/§41/§52：
 * 流程：导航允许的 1688 图搜页 → Upload Target Proof → focus+Enter 打开 Native File Chooser
 * → CDP 文件注入 → Upload State Proof（预览图 + Candidate Identity Proof）
 * → Submit Target Proof（class 扫描 + elementFromPoint，live 坐标）
 * → CDP 鼠标点击触发视觉搜索 → 结果页证明（imageId + 非 fallback）→ 卡片提取 → 候选。
 *
 * - 前台窗口硬前置（BROWSER_FOREGROUND_REQUIRED）。
 * - bounded：单次运行总超时、每步超时、操作间 cooldown、最多 60 卡片、取消支持。
 * - 任何 proof 失败 → fail-closed（不猜、不跳过）。
 * - 布局重试：紧凑布局（y<50 顶部死区）→ 重开页面（最多 3 次）。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import {
  BROWSER_SESSION_DRIVER_VERSION,
  open1688BrowserSession,
  type PersistentBrowserSession,
} from "./browser-session";
import {
  buildResultCardsExtractionExpression,
  buildResultPageClassificationExpression,
  buildSubmitTargetProofExpression,
  buildUploadStateProofExpression,
  buildUploadTargetProofExpression,
  parseResultCards,
  parseResultPageClassification,
  parseSubmitTargetProof,
  parseUploadStateProof,
  parseUploadTargetProof,
  validateImageResultCards,
  RESOLVER_VERSIONS,
} from "./image-search-resolver";
import type {
  ImageAcquisitionRunTrace,
  ImageSearchPageState,
  ImageSearchResultCard,
} from "./image-search-contract";

export class ImageSearchDriverError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ImageSearchDriverError";
  }
}

const MAX_LAYOUT_RETRIES = 3;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 1688 页面上传限制 ≤30MB
const NAVIGATE_TIMEOUT_MS = 20_000;
const UPLOAD_CONFIRM_TIMEOUT_MS = 15_000;
const RESULT_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 120_000;
const COOLDOWN_MS = 1_000;
const MAX_CARDS = 60;

export type NativeImageSearchInput = {
  /** 本地候选图片绝对路径（必须已通过图片来源校验，见 lib/server/sourcingImageAcquisition） */
  imagePath: string;
  /** 候选图 base64 长度（用于 Candidate Identity Proof：预览 dataURL 长度匹配） */
  imageBase64Length: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
};

export type NativeImageSearchResult = {
  cards: ImageSearchResultCard[];
  trace: ImageAcquisitionRunTrace;
};

function fail(code: string, status: number, message: string): never {
  throw new ImageSearchDriverError(code, status, message);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(resolveDelay, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolveDelay();
      }, { once: true });
    }
  });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, signal?: AbortSignal, stepMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    if (await predicate()) return true;
    await delay(stepMs, signal);
  }
  return false;
}

function base64LengthOfFile(path: string): number {
  const size = statSync(path).size;
  return Math.ceil(size / 3) * 4;
}

/** 打开图搜页并返回上传 target 证明；紧凑布局（y<50）返回 null 触发重试 */
async function openUploadPage(session: PersistentBrowserSession, signal?: AbortSignal): Promise<{
  proof: ReturnType<typeof parseUploadTargetProof>;
  pageState: ImageSearchPageState;
}> {
  await session.send("Page.navigate", { url: "https://s.1688.com/selloffer/offer_search.html" });
  const ready = await waitFor(async () => {
    try {
      const raw = await session.evaluate<unknown>("document.querySelector('input[type=file]#img-search-upload') !== null");
      return raw === true;
    } catch {
      return false;
    }
  }, NAVIGATE_TIMEOUT_MS, signal);
  if (!ready) fail("page_identity_unknown", 422, "1688 图搜页面加载超时或未识别，请确认浏览器正常打开 s.1688.com。");
  const rawProof = await session.evaluate<unknown>(buildUploadTargetProofExpression());
  const proof = parseUploadTargetProof(rawProof);
  if (!proof.found || !proof.pageUrlAllowed) {
    fail("upload_target_not_found", 422, "未找到 1688 上传入口（input#img-search-upload），页面可能已改版。");
  }
  if (!proof.unique || !proof.visible || !proof.enabled) {
    fail("upload_target_not_found", 422, `上传入口状态异常（${proof.reasonCodes.join("/")}），已停止。`);
  }
  return { proof, pageState: "upload_target_found" };
}

/**
 * 上传候选图（双路径，§33 语义保持）：
 * Path A（主）：页面内 DataTransfer 注入（spike A.1 实测可行；免键盘/chooser/焦点依赖）
 *             Node 读文件 → base64 → 页面构建 File → input.files → dispatch change。
 * Path B（备）：focus + 可信 Enter → Native File Chooser → CDP setFileInputFiles（spike A.3 主路径）。
 * 上传是否成功由调用方 Upload State Proof（预览图 + Candidate Identity）统一裁决。
 */
async function uploadCandidateImage(
  session: PersistentBrowserSession,
  imagePath: string,
  signal?: AbortSignal,
): Promise<void> {
  const fileSize = statSync(imagePath).size;
  // Path A：≤8MB 走 DataTransfer 注入（CDP 消息体积保护；更大走 chooser）
  if (fileSize <= 8 * 1024 * 1024) {
    try {
      const base64 = readFileSync(imagePath).toString("base64");
      const injected = await session.evaluate<{ ok: boolean; files: number; error?: string }>(`(() => {
        try {
          const base64 = ${JSON.stringify(base64)};
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const file = new File([bytes], "candidate-image.jpg", { type: "image/jpeg" });
          const input = document.querySelector('input[type=file]#img-search-upload');
          if (!(input instanceof HTMLInputElement)) return { ok: false, files: 0, error: "input_not_found" };
          const dt = new DataTransfer();
          dt.items.add(file);
          // files 是只读属性，需用原型 setter（直接赋值会被静默忽略）
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
          if (!setter) return { ok: false, files: 0, error: "no_files_setter" };
          setter.call(input, dt.files);
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true, files: input.files.length };
        } catch (error) {
          return { ok: false, files: 0, error: String(error).slice(0, 120) };
        }
      })()`);
      if (injected.ok && injected.files > 0) return;
      // Path A 失败 → 落到 Path B
    } catch {
      // evaluate 异常 → 落到 Path B
    }
  }

  // Path B：focus + Enter → chooser → 文件注入
  await session.send("Page.setInterceptFileChooserDialog", { enabled: true });
  const chooserPromise = new Promise<{ backendNodeId: number }>((resolveChooser, rejectChooser) => {
    const timeout = setTimeout(() => rejectChooser(new Error("FILE_CHOOSER_TIMEOUT")), 10_000);
    const unsubscribe = session.onEvent((method, params) => {
      if (method !== "Page.fileChooserOpened") return;
      const backendNodeId = params.backendNodeId;
      if (typeof backendNodeId === "number") {
        clearTimeout(timeout);
        unsubscribe();
        resolveChooser({ backendNodeId });
      }
    });
  });

  // 聚焦 input + CDP 可信键盘 Enter（与用户 Tab+Enter 等价；spike A.3 实测唯一可靠激活）
  // 前置：Page.bringToFront 把页面/窗口切到前台（CDP 键盘事件只在窗口聚焦时送达）
  await session.send("Page.bringToFront");
  await delay(300, signal);
  await session.evaluate("(() => { const el = document.querySelector('input[type=file]#img-search-upload'); if (el instanceof HTMLInputElement) el.focus(); return el instanceof HTMLInputElement; })()");
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });

  let backendNodeId: number;
  try {
    backendNodeId = (await Promise.race([
      chooserPromise,
      new Promise<never>((_, rejectChooser) => {
        if (signal) signal.addEventListener("abort", () => rejectChooser(new Error("CANCELLED")), { once: true });
      }),
    ])).backendNodeId;
  } catch {
    fail("upload_not_confirmed", 422, "文件选择器未打开。请确认浏览器窗口在前台（1688 图搜需要前台浏览器会话）。");
  }

  await session.send("DOM.setFileInputFiles", {
    files: [imagePath],
    backendNodeId,
  });
  await session.send("Page.setInterceptFileChooserDialog", { enabled: false });
}

/**
 * 运行一次原生图搜（完整自动化：上传 → 触发 → 提取）。
 * 任何门禁失败抛 ImageSearchDriverError（fail-closed）。
 */
export async function runNativeImageSearch(input: NativeImageSearchInput): Promise<NativeImageSearchResult> {
  const startedAt = Date.now();
  const signal = input.signal;
  const timestamp = new Date().toISOString();
  let pageState: ImageSearchPageState = "idle";
  let failClosedReason: string | null = null;
  let candidateImageBound = false;

  if (!existsSync(input.imagePath)) fail("upload_not_confirmed", 422, "候选图片文件不存在。");
  const fileSize = statSync(input.imagePath).size;
  if (fileSize < 1 || fileSize > MAX_UPLOAD_BYTES) {
    fail("upload_not_confirmed", 422, `候选图片大小超出 1688 上传限制（≤30MB）。`);
  }

  let session: PersistentBrowserSession | null = null;
  try {
    const s = await open1688BrowserSession({ env: input.env });
    session = s;
    const windowState = await s.windowState;
    if (windowState === "minimized") {
      fail("browser_foreground_required", 409, "1688 浏览器窗口处于最小化状态，请将窗口置于前台后重试。");
    }

    // ── 打开图搜页（布局重试 ≤3 次） ──
    let uploadProof: ReturnType<typeof parseUploadTargetProof> | null = null;
    for (let attempt = 0; attempt < MAX_LAYOUT_RETRIES; attempt++) {
      if (signal?.aborted) fail("timeout", 504, "图搜已取消。");
      const opened = await openUploadPage(s, signal);
      uploadProof = opened.proof;
      pageState = "upload_target_found";
      // 紧凑布局（顶部死区 y<50）→ 重开页面（spike A.3）
      if (uploadProof.y !== null && uploadProof.y < 50 && attempt < MAX_LAYOUT_RETRIES - 1) {
        await delay(COOLDOWN_MS, signal);
        continue;
      }
      break;
    }
    if (!uploadProof) fail("upload_target_not_found", 422, "多次尝试均未获得有效上传入口。");

    // ── 上传（DataTransfer 注入主路径 → chooser 备选） ──
    await uploadCandidateImage(s, input.imagePath, signal);
    pageState = "upload_confirmed";

    // ── Upload State Proof：预览图出现 + Candidate Identity Proof（base64 长度匹配） ──
    const uploadConfirmed = await waitFor(async () => {
      try {
        const raw = await s.evaluate<unknown>(buildUploadStateProofExpression());
        const state = parseUploadStateProof(raw);
        if (!state.confirmed) return false;
        const preview = state.previewImageSrc;
        if (!preview || !preview.startsWith("data:image/")) return false;
        // dataURL 内容长度 vs 本地文件 base64 长度（spike A.3 实测精确一致）
        const dataPart = preview.slice(preview.indexOf(",") + 1);
        const lengthOk = Math.abs(dataPart.length - input.imageBase64Length) <= 8;
        candidateImageBound = lengthOk;
        return lengthOk;
      } catch {
        return false;
      }
    }, UPLOAD_CONFIRM_TIMEOUT_MS, signal);
    if (!uploadConfirmed) {
      if (!candidateImageBound) {
        fail("upload_not_confirmed", 422, "上传预览与候选图片不一致（Wrong Upload 门禁），已停止。");
      }
      fail("upload_not_confirmed", 422, "上传状态未确认（预览图未出现），请确认浏览器窗口在前台后重试。");
    }

    // ── Submit Target Proof + CDP 鼠标点击（live 坐标，Wrong Click = 0） ──
    const submitReady = await waitFor(async () => {
      try {
        const raw = await s.evaluate<unknown>(buildSubmitTargetProofExpression());
        return parseSubmitTargetProof(raw).found;
      } catch {
        return false;
      }
    }, UPLOAD_CONFIRM_TIMEOUT_MS, signal);
    if (!submitReady) fail("search_trigger_not_confirmed", 422, "未找到「搜索图片」按钮（上传模式未激活或页面改版）。");

    const rawSubmit = await s.evaluate<unknown>(buildSubmitTargetProofExpression());
    const submitProof = parseSubmitTargetProof(rawSubmit);
    if (!submitProof.found || !submitProof.unique || !submitProof.visible || !submitProof.enabled || submitProof.x === null || submitProof.y === null) {
      fail("search_trigger_not_confirmed", 422, `「搜索图片」按钮证明失败（${submitProof.reasonCodes.join("/")}），已停止（Wrong Click 门禁）。`);
    }
    // 点击前实时重证明（stale 防护）
    const recheck = parseSubmitTargetProof(await s.evaluate<unknown>(buildSubmitTargetProofExpression()));
    if (!recheck.found || recheck.x === null || recheck.y === null) {
      fail("search_trigger_not_confirmed", 422, "「搜索图片」按钮已变化（stale），已停止（Wrong Click 门禁）。");
    }
    await delay(COOLDOWN_MS, signal);
    const { x, y } = recheck;
    await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    pageState = "search_triggered";

    // ── 结果页证明（imageId + 非 fallback） ──
    const resultReady = await waitFor(async () => {
      try {
        const raw = await s.evaluate<unknown>(buildResultPageClassificationExpression());
        const classification = parseResultPageClassification(raw);
        return classification.resultsReady;
      } catch {
        return false;
      }
    }, RESULT_TIMEOUT_MS, signal);
    if (!resultReady) {
      const classification = parseResultPageClassification(await s.evaluate<unknown>(buildResultPageClassificationExpression()));
      if (classification.isFallbackRecommendation) {
        fail("search_trigger_not_confirmed", 422, "未跳转到真实视觉搜索结果页（疑似推荐流而非图搜结果），已停止。");
      }
      fail("timeout", 504, "等待视觉搜索结果超时。");
    }
    pageState = "results_ready";

    // ── 卡片提取 + 校验 ──
    await delay(COOLDOWN_MS, signal);
    const rawCards = await s.evaluate<unknown>(buildResultCardsExtractionExpression());
    const cards = parseResultCards(rawCards).slice(0, MAX_CARDS);
    try {
      validateImageResultCards(cards);
    } catch (error) {
      fail("entity_binding_failed", 422, `结果卡片校验失败：${errorMessage(error)}`);
    }
    // 卡片 offerId 唯一 + 同卡片绑定（Wrong Entity = 0 结构层）
    if (cards.some((card) => !card.entityBound)) {
      fail("entity_binding_failed", 422, "存在跨卡片字段风险，已拒绝（Wrong Entity 门禁）。");
    }
    if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) {
      fail("timeout", 504, "图搜总时长超出限制。");
    }

    const trace: ImageAcquisitionRunTrace = {
      source: "1688",
      method: "image",
      query: input.imagePath,
      timestamp,
      driverVersion: BROWSER_SESSION_DRIVER_VERSION,
      resolverVersion: `${RESOLVER_VERSIONS.upload}|${RESOLVER_VERSIONS.submit}|${RESOLVER_VERSIONS.extract}`,
      success: true,
      failClosedReason: null,
      pageState,
      durationMs: Date.now() - startedAt,
      candidateImageBound,
    };
    return { cards, trace };
  } catch (error) {
    if (error instanceof ImageSearchDriverError) {
      failClosedReason = error.code;
      throw error;
    }
    const normalized = normalizeBrowserError(error);
    failClosedReason = normalized.code;
    throw new ImageSearchDriverError(normalized.code, normalized.status, normalized.message);
  } finally {
    session?.close();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 浏览器/CDP 错误归一化（fail-closed 错误分类，§53） */
function normalizeBrowserError(error: unknown): { code: string; status: number; message: string } {
  const message = errorMessage(error);
  if (message.includes("BROWSER_DEBUG_SOCKET") || message.includes("CDP_RUNTIME_EVALUATION_FAILED")) {
    return { code: "browser_not_ready", status: 503, message: "浏览器会话中断，请重试。" };
  }
  if (message.includes("FILE_CHOOSER_TIMEOUT")) {
    return { code: "upload_not_confirmed", status: 422, message: "文件选择器未响应，请确认浏览器窗口在前台。" };
  }
  if (message.includes("CANCELLED")) {
    return { code: "timeout", status: 504, message: "图搜已取消。" };
  }
  return { code: "browser_not_ready", status: 503, message: `浏览器操作失败：${message.slice(0, 200)}` };
}
