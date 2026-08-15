/**
 * V3.3 — Browser Evidence 单页采集（服务端同步；不保存，只生成 Preview）
 *
 * 流程：隔离浏览器会话 → 导航任务绑定 ASIN 单页（?language=en_US）→
 * 页面分类 + 实体绑定 + 6 字段提取 → 关闭会话 → 返回 Preview（不可信客户端不可伪造）。
 *
 * 安全铁律：
 * - 只导航 https://www.amazon.com 白名单；单页导航，不自动搜索、不批量。
 * - CAPTCHA / 登录墙 / 错误页 → fail-closed 明确错误，不绕过。
 * - 不读取 Cookie/Token/密码；不保存完整 HTML；零 AI 调用。
 */
import { randomUUID } from "node:crypto";
import {
  resolveSystemBrowser,
  openIsolatedPublicBrowserSession,
} from "@/tools/collectors/amazon/browser-control";
import {
  buildAmazonDetailPageExtractionExpression,
  type AmazonDetailPageExtraction,
} from "@/tools/collectors/amazon/detail-page-extract";
import { BrowserEvidenceError, type BrowserEvidenceSnapshot } from "@/lib/server/browserEvidence";
import type { AccessContext } from "@/lib/server/accessPassword";

export const BROWSER_EVIDENCE_ALLOWED_ORIGINS = ["https://www.amazon.com"] as const;
export const BROWSER_EVIDENCE_COLLECTOR_VERSION = "amazon-detail-page-extractor.v1";

export type BrowserEvidenceNavigation = {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  navigationElapsedMs: number;
  allowedFinalOrigin: boolean;
};

export type BrowserEvidenceCollectPreview = {
  extraction: AmazonDetailPageExtraction;
  navigation: BrowserEvidenceNavigation;
};

export type BrowserEvidenceStoredPreview = {
  evidenceId: string;
  preview: BrowserEvidenceCollectPreview;
  capturedAt: string;
  expiresAt: number;
  /** 绑定主体：owner:v1 或 visitor:{demoAccessId}——Visitor A 不能取 B 的 Preview */
  subjectKey: string;
  /** 绑定任务：Preview 只能保存回采集它的任务 */
  taskId: string;
  /** 绑定 ASIN：与 preview 提取 ASIN 一致（三一致硬门禁的一部分） */
  asin: string;
};

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const PREVIEW_MAX_ENTRIES = 64;

/** 主体键：同一主体（Owner 或同一 Visitor）的 Preview 才能互取 */
export function browserEvidenceSubjectKey(context: AccessContext): string {
  return context.mode === "demo" ? `visitor:${context.demoAccessId}` : "owner:v1";
}

/** 服务端短暂缓存 collect 生成的 Preview；save 凭 evidenceId + 主体 + 任务取回，客户端无法篡改字段值 */
class PreviewStore {
  private entries = new Map<string, BrowserEvidenceStoredPreview>();

  put(input: BrowserEvidenceStoredPreview): void {
    this.prune();
    if (this.entries.size >= PREVIEW_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest === "string") this.entries.delete(oldest);
    }
    this.entries.set(input.evidenceId, input);
  }

  take(evidenceId: string, claim: { subjectKey: string; taskId: string }): BrowserEvidenceStoredPreview | null {
    this.prune();
    const entry = this.entries.get(evidenceId);
    if (!entry) return null;
    // 跨主体 / 跨任务一律视为不可用（fail-closed，不泄漏 Preview 存在性之外的信息）
    if (entry.subjectKey !== claim.subjectKey || entry.taskId !== claim.taskId) return null;
    this.entries.delete(evidenceId);
    return entry;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }
}

const previewStore = new PreviewStore();

export function storeBrowserEvidencePreview(input: BrowserEvidenceStoredPreview): void {
  previewStore.put(input);
}

export function takeBrowserEvidencePreview(
  evidenceId: string,
  claim: { subjectKey: string; taskId: string },
): BrowserEvidenceStoredPreview | null {
  return previewStore.take(evidenceId, claim);
}

export class BrowserEvidenceCollectError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BrowserEvidenceCollectError";
  }
}

/** 页面分类 → fail-closed 错误码（ok 返回 null）；导出供测试与诊断 */
export function browserEvidenceFailClosedCode(
  pageStatus: AmazonDetailPageExtraction["pageStatus"],
): string | null {
  switch (pageStatus) {
    case "ok": return null;
    case "captcha": return "page_blocked_captcha";
    case "login_wall": return "page_blocked_login_wall";
    case "error_page": return "page_error";
    case "unknown_page": return "page_unknown";
  }
}

function failClosedMessage(code: string): string {
  switch (code) {
    case "page_blocked_captcha": return "页面要求验证码（CAPTCHA）。我们不自动绕过验证码：请在本机浏览器手动打开该商品页并确认是否为正常商品页后重试。";
    case "page_blocked_login_wall": return "页面要求登录。我们不自动登录：请确认该商品页可公开访问后重试。";
    case "page_error": return "页面返回错误页（商品可能不存在、下架或访问受限）。请确认 ASIN 后重试。";
    case "page_unknown": return "页面不是可识别的 Amazon 商品详情页。请确认 ASIN 与站点后重试。";
    default: return "浏览器采集失败，请稍后重试。";
  }
}

/** 单页采集（同步完成：打开 → 导航 → 提取 → 关闭）；返回 Preview，不保存 */
export async function collectBrowserEvidencePreview(input: {
  asin: string;
  capturedAt: string;
}): Promise<BrowserEvidenceCollectPreview> {
  const browser = resolveSystemBrowser();
  if (!browser) {
    throw new BrowserEvidenceCollectError(
      "browser_unavailable",
      503,
      "本机未检测到可用的 Chrome/Edge 浏览器，无法进行页面采集。",
    );
  }
  const session = await openIsolatedPublicBrowserSession({
    browser,
    allowedOrigins: BROWSER_EVIDENCE_ALLOWED_ORIGINS,
    maxNavigations: 1,
    headless: true,
  });
  try {
    const requestedUrl = `https://www.amazon.com/dp/${input.asin}?language=en_US`;
    const nav = await session.navigate(requestedUrl);
    const navigation: BrowserEvidenceNavigation = {
      requestedUrl,
      finalUrl: nav.finalUrl,
      httpStatus: nav.mainDocumentHttpStatus,
      navigationElapsedMs: nav.navigationElapsedMs,
      allowedFinalOrigin: nav.allowedFinalOrigin,
    };
    if (!nav.allowedFinalOrigin) {
      throw new BrowserEvidenceCollectError(
        "navigation_not_allowed",
        502,
        "页面导航被重定向到白名单外地址，已停止采集（可能为验证码/登录墙/错误页）。请在本机浏览器手动检查该商品页。",
      );
    }
    const extraction = await session.evaluateDomByValue<AmazonDetailPageExtraction>(
      buildAmazonDetailPageExtractionExpression({
        expectedAsin: input.asin,
        capturedAt: input.capturedAt,
        collectorVersion: BROWSER_EVIDENCE_COLLECTOR_VERSION,
      }),
    );
    const failClosed = browserEvidenceFailClosedCode(extraction.pageStatus);
    if (failClosed) {
      throw new BrowserEvidenceCollectError(failClosed, 422, failClosedMessage(failClosed));
    }
    return { extraction, navigation };
  } catch (error) {
    if (error instanceof BrowserEvidenceCollectError) throw error;
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message.includes("PUBLIC_NAVIGATION_BUDGET_EXHAUSTED")) {
      throw new BrowserEvidenceCollectError("navigation_budget_exhausted", 502, "本次采集导航预算用尽，已停止。");
    }
    if (message.includes("PUBLIC_BROWSER_SESSION_FAIL_CLOSED")) {
      throw new BrowserEvidenceCollectError(
        "browser_session_fail_closed",
        502,
        "浏览器会话因安全门禁进入 fail-closed，已停止采集。",
      );
    }
    if (message.includes("CDP_RUNTIME_EVALUATION_FAILED")) {
      throw new BrowserEvidenceCollectError(
        "extraction_failed",
        502,
        `页面提取脚本执行失败：${message.slice(0, 240)}。请在本机浏览器手动检查该商品页结构后重试。`,
      );
    }
    throw new BrowserEvidenceCollectError(
      "collect_failed",
      502,
      `浏览器采集失败：${message.slice(0, 240)}`,
    );
  } finally {
    await session.close();
  }
}

/**
 * ASIN 三一致硬门禁：URL ASIN = 页面锚点 ASIN = 任务绑定 ASIN；任一不满足 → 硬拒绝，无"仍然保存"。
 * 由 API route 与真实 Smoke 共用同一实现，保证验证路径与生产路径一致。
 */
export function buildConfirmedSnapshot(input: {
  preview: BrowserEvidenceCollectPreview;
  taskAsin: string;
  capturedAt: string;
  context: AccessContext;
}): BrowserEvidenceSnapshot {
  const { preview, taskAsin, capturedAt, context } = input;
  const extraction = preview.extraction;
  if (extraction.schemaVersion !== "amazon-detail-page-extraction.v1") {
    throw new BrowserEvidenceError("preview_invalid", 422, "采集预览结构无效，请重新采集。");
  }
  const mismatches: string[] = [];
  if (extraction.expectedAsin !== taskAsin) mismatches.push("期望 ASIN");
  if (extraction.urlAsin !== taskAsin) mismatches.push("URL ASIN");
  if (extraction.pageAsin !== taskAsin) mismatches.push("页面 ASIN");
  if (!extraction.entityBound) mismatches.push("实体绑定");
  const proof = extraction.bindingProof;
  if (!proof.urlMatchesExpected || !proof.pageAnchorMatchesExpected || !proof.productContainerFound) {
    mismatches.push("绑定证明");
  }
  if (mismatches.length > 0) {
    throw new BrowserEvidenceError(
      "asin_mismatch",
      422,
      `页面证据与任务绑定商品不一致（${mismatches.join("、")}），已拒绝保存。请确认采集目标是正确商品后重试。`,
    );
  }
  const fields = extraction.fields;
  return {
    evidenceId: randomUUID(),
    sourceType: "browser",
    sourceSite: "amazon",
    pageUrl: preview.navigation.finalUrl,
    marketplace: "amazon.com",
    locale: null,
    currency: fields.price.reason?.startsWith("currency_not_usd:")
      ? (fields.price.reason.slice("currency_not_usd:".length) as BrowserEvidenceSnapshot["currency"])
      : fields.price.value !== null ? "USD" : null,
    entityBinding: {
      bound: extraction.entityBound,
      urlAsin: extraction.urlAsin,
      pageAsin: extraction.pageAsin,
      proof: extraction.bindingProof,
    },
    collectorVersion: BROWSER_EVIDENCE_COLLECTOR_VERSION,
    capturedAt,
    fields: {
      asin: { value: fields.asin.value as string | null, status: fields.asin.status, reason: fields.asin.reason, nature: "snapshot" },
      title: { value: fields.title.value as string | null, status: fields.title.status, reason: fields.title.reason, nature: "snapshot" },
      price: { value: fields.price.value as number | null, status: fields.price.status, reason: fields.price.reason, nature: "snapshot" },
      bsr: { value: fields.bsr.value as number | null, status: fields.bsr.status, reason: fields.bsr.reason, nature: "snapshot" },
      rating: { value: fields.rating.value as number | null, status: fields.rating.status, reason: fields.rating.reason, nature: "snapshot" },
      reviewCount: { value: fields.reviews.value as number | null, status: fields.reviews.status, reason: fields.reviews.reason, nature: "snapshot" },
    },
    failureReasons: Object.values(fields)
      .map((item) => item.reason)
      .filter((reason): reason is string => reason !== null),
    confirmedBy: {
      mode: context.mode === "demo" ? "visitor" : "owner",
      actorRef: context.mode === "demo" ? `visitor:${context.demoAccessId}` : "owner:v1",
    },
    confirmedAt: new Date().toISOString(),
  };
}
