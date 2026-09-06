/**
 * V3 Final Operability Correction — Package C：半自动 Review Collector（Preview 服务端层）
 *
 * 流程：隔离浏览器会话 → 逐 ASIN 导航详情页（?language=en_US）→ 提取公开
 * "Top reviews" 片段（星级/日期/标题）→ 关闭会话 → 返回 Preview（服务端缓存，
 * 客户端不可伪造字段值）→ 人工确认后由 route 层走 importReviews（browser 绑定）。
 *
 * 安全铁律（与 browserEvidenceCollect 一致）：
 * - 只导航 https://www.amazon.com 白名单；单页导航，不自动搜索、不批量。
 * - CAPTCHA / 登录墙 / 重定向出白名单 → fail-closed 明确记录，不绕过、不提取。
 * - 不读取 Cookie/Token/密码；不保存完整 HTML；零 AI 调用。
 * - 上限：单次 ≤3 个 ASIN、每页 ≤20 条（详情页 Top Reviews 片段公开可见的边界）。
 * - 评论全文页需登录 → 如实标注限制（bindingNote），评论页登录墙不绕过。
 */
import { randomUUID } from "node:crypto";
import {
  openIsolatedPublicBrowserSession,
  resolveSystemBrowser,
  type BrowserExecutableCandidate,
} from "@/tools/collectors/amazon/browser-control";
import { buildReviewSnippetExtractionExpression, type ReviewSnippet } from "@/tools/collectors/amazon/review-snippet-extract";
import {
  isValidAsin,
  buildReviewDuplicateKey,
  buildReviewContentHash,
  type ReviewSourceProductRole,
  type ReviewEvidenceV1,
} from "@/lib/server/reviewEvidence";
import type { AccessContext } from "@/lib/server/accessPassword";

export const REVIEW_COLLECTOR_VERSION = "amazon-review-snippet-collector.v1";
export const REVIEW_COLLECTOR_ALLOWED_ORIGINS = ["https://www.amazon.com"] as const;
/** 单次采集：最多 3 个 ASIN（maxNavigations 预算内） */
export const REVIEW_COLLECT_MAX_ASINS_PER_RUN = 3;
/** 单页最多提取条数（详情页 Top Reviews 片段） */
export const REVIEW_COLLECT_MAX_ITEMS_PER_PAGE = 20;
/** 单条提取结果最大字节（防御性上限，实际走 import 的 4KB 校验） */
const REVIEW_SNIPPET_MAX_TITLE_CHARS = 2000;

export class ReviewCollectorError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ReviewCollectorError";
  }
}

export type ReviewCollectRequestAsin = {
  asin: string;
  role: ReviewSourceProductRole;
};

export type ReviewSnippetPreviewItem = {
  asin: string;
  role: ReviewSourceProductRole;
  rating: number | null;
  date: string | null;
  title: string;
  sourceUrl: string;
  bindingNote: string;
};

export type ReviewCollectPageResult = {
  asin: string;
  status: "ok" | "blocked_redirect" | "no_reviews_extracted" | "error";
  note: string | null;
  extractedCount: number;
};

export type ReviewCollectPreview = {
  previewId: string;
  items: ReviewSnippetPreviewItem[];
  pageResults: ReviewCollectPageResult[];
  capturedAt: string;
  expiresAt: number;
  /** 绑定主体：owner:v1 或 visitor:{demoAccessId}——Visitor A 不能取 B 的 Preview */
  subjectKey: string;
  /** 绑定任务：Preview 只能确认回采集它的任务 */
  taskId: string;
};

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const PREVIEW_MAX_ENTRIES = 32;

class ReviewCollectPreviewStore {
  private entries = new Map<string, ReviewCollectPreview>();

  put(input: ReviewCollectPreview): void {
    this.prune();
    if (this.entries.size >= PREVIEW_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest === "string") this.entries.delete(oldest);
    }
    this.entries.set(input.previewId, input);
  }

  take(previewId: string, claim: { subjectKey: string; taskId: string }): ReviewCollectPreview | null {
    this.prune();
    const entry = this.entries.get(previewId);
    if (!entry) return null;
    // 跨主体 / 跨任务一律视为不可用（fail-closed）
    if (entry.subjectKey !== claim.subjectKey || entry.taskId !== claim.taskId) return null;
    this.entries.delete(previewId);
    return entry;
  }

  /** 第十一版：无副作用查询（prune 先行；subjectKey/taskId 严格匹配；仅返回最新未过期 Preview） */
  clearForTests(): void {
    this.entries.clear();
  }

  findPending(query: { subjectKey: string; taskId: string; asin?: string }): ReviewCollectPreview | null {
    this.prune();
    const now = Date.now();
    const normalizedAsin = query.asin ? query.asin.trim().toUpperCase() : null;
    let match: ReviewCollectPreview | null = null;
    for (const entry of this.entries.values()) {
      if (entry.subjectKey !== query.subjectKey || entry.taskId !== query.taskId || entry.expiresAt <= now) continue;
      if (normalizedAsin !== null) {
        const hasCurrentCandidateAsin = entry.items.some(
          (item) => item.role === "current_candidate" && item.asin.trim().toUpperCase() === normalizedAsin,
        );
        const hasPageResultAsin = entry.pageResults.some(
          (p) => p.asin.trim().toUpperCase() === normalizedAsin,
        );
        if (!hasCurrentCandidateAsin && !hasPageResultAsin) continue;
      }
      match = entry;
    }
    return match;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }
}

const previewStore = new ReviewCollectPreviewStore();

export function reviewCollectSubjectKey(context: AccessContext): string {
  return context.mode === "demo" ? `visitor:${context.demoAccessId}` : "owner:v1";
}

export function storeReviewCollectPreview(input: ReviewCollectPreview): void {
  previewStore.put(input);
}

export function takeReviewCollectPreview(
  previewId: string,
  claim: { subjectKey: string; taskId: string },
): ReviewCollectPreview | null {
  return previewStore.take(previewId, claim);
}

/** 第十一版：无副作用 Pending Preview 查询（不消费、不删除有效 Preview；跨主体/跨任务 fail-closed；过期不复用） */
export function findPendingReviewCollectPreview(query: {
  subjectKey: string;
  taskId: string;
  asin?: string;
}): ReviewCollectPreview | null {
  return previewStore.findPending(query);
}

export type PendingReviewCollectPreviewDto = {
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
  expiresAt: string;
};

/**
 * 纯只读安全 DTO 投影：不消费、不删除 Preview，不泄漏内部凭证与 subjectKey。
 * 若有效，计算每条评论片段相对于 currentDatasetReviews 的 duplicate 标记。
 */
export function getPendingReviewCollectPreviewDto(query: {
  subjectKey: string;
  taskId: string;
  asin?: string;
  currentDatasetReviews?: ReviewEvidenceV1["dataset"]["reviews"];
}): PendingReviewCollectPreviewDto | null {
  const preview = findPendingReviewCollectPreview({
    subjectKey: query.subjectKey,
    taskId: query.taskId,
    asin: query.asin,
  });
  if (!preview) return null;
  const now = Date.now();
  if (preview.expiresAt <= now) return null;

  const existingKeys = new Set(
    (query.currentDatasetReviews ?? []).map((review) => review.duplicateKey),
  );
  const items = preview.items.map((item) => {
    const duplicateKey = buildReviewDuplicateKey({
      reviewId: null,
      asin: item.asin,
      contentHash: buildReviewContentHash(item.title),
      rating: item.rating,
      reviewDate: item.date,
    });
    return {
      asin: item.asin,
      role: item.role,
      rating: item.rating,
      date: item.date,
      title: item.title,
      duplicate: existingKeys.has(duplicateKey),
    };
  });

  const pageResults = preview.pageResults.map((page) => ({
    asin: page.asin,
    status: page.status,
    note: page.note,
    extractedCount: page.extractedCount,
  }));

  return {
    previewId: preview.previewId,
    items,
    pageResults,
    capturedAt: preview.capturedAt,
    expiresAt: new Date(preview.expiresAt).toISOString(),
  };
}

/** 测试专用：清空内存 Preview Store（仅测试文件使用） */
export function resetReviewCollectPreviewStoreForTests(): void {
  previewStore.clearForTests();
}

export function assertReviewCollectRequest(
  value: unknown,
): ReviewCollectRequestAsin[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > REVIEW_COLLECT_MAX_ASINS_PER_RUN) {
    throw new ReviewCollectorError(
      "invalid_collect_payload",
      400,
      `采集请求需要 asins 数组（1-${REVIEW_COLLECT_MAX_ASINS_PER_RUN} 个，每项含 asin/sourceProductRole）。`,
    );
  }
  const seen = new Set<string>();
  const parsed: ReviewCollectRequestAsin[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new ReviewCollectorError("invalid_collect_payload", 400, "asins 每项必须是对象（asin/sourceProductRole）。");
    }
    const record = raw as Record<string, unknown>;
    const asin = typeof record.asin === "string" ? record.asin.trim().toUpperCase() : "";
    const role = record.sourceProductRole;
    if (!isValidAsin(asin) || (role !== "current_candidate" && role !== "competitor")) {
      throw new ReviewCollectorError("invalid_collect_payload", 400, "ASIN 格式无效（10 位大写字母数字）或角色无效（current_candidate / competitor）。");
    }
    if (seen.has(asin)) {
      throw new ReviewCollectorError("invalid_collect_payload", 400, `ASIN ${asin} 重复，请合并后重试。`);
    }
    seen.add(asin);
    parsed.push({ asin, role });
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 归一化页面返回的 snippet（fail-closed：结构不合法即丢弃该条） */
function parseSnippet(value: unknown): ReviewSnippet | null {
  if (!isRecord(value)) return null;
  const title = asString(value.title).slice(0, REVIEW_SNIPPET_MAX_TITLE_CHARS);
  if (!title) return null;
  const rating = asNumber(value.rating);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return null;
  return {
    rating,
    date: asString(value.date, ""),
    title,
  };
}

/** 执行一次采集（同步阻塞；调用方负责超时与错误归一化） */
export async function collectReviewSnippets(input: {
  asins: ReviewCollectRequestAsin[];
  headless?: boolean;
}): Promise<{ items: ReviewSnippetPreviewItem[]; pageResults: ReviewCollectPageResult[] }> {
  const browser = resolveSystemBrowser();
  if (!browser) {
    throw new ReviewCollectorError("browser_not_available", 503, "本机未检测到可用浏览器，无法自动采集评论。请在安装 Chrome/Edge 后重试。");
  }
  const items: ReviewSnippetPreviewItem[] = [];
  const pageResults: ReviewCollectPageResult[] = [];
  const session = await openIsolatedPublicBrowserSession({
    browser,
    allowedOrigins: REVIEW_COLLECTOR_ALLOWED_ORIGINS,
    maxNavigations: input.asins.length,
    headless: input.headless ?? true,
  });
  try {
    for (const { asin, role } of input.asins) {
      try {
        const nav = await session.navigate(`https://www.amazon.com/dp/${asin}?language=en_US`);
        if (!nav.allowedFinalOrigin) {
          pageResults.push({ asin, status: "blocked_redirect", note: "页面重定向到白名单外（验证码/登录墙），未绕过。", extractedCount: 0 });
          continue;
        }
        const extracted = await session.evaluateDomByValue<unknown[]>(
          buildReviewSnippetExtractionExpression({ maxItems: REVIEW_COLLECT_MAX_ITEMS_PER_PAGE }),
        );
        const reviews = Array.isArray(extracted) ? extracted.map(parseSnippet).filter((snippet): snippet is ReviewSnippet => snippet !== null) : [];
        if (reviews.length === 0) {
          pageResults.push({ asin, status: "no_reviews_extracted", note: "详情页无公开 Top Reviews 片段。", extractedCount: 0 });
          continue;
        }
        for (const review of reviews) {
          items.push({
            asin,
            role,
            rating: review.rating,
            date: review.date || null,
            title: review.title,
            sourceUrl: `https://www.amazon.com/dp/${asin}`,
            bindingNote: "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）",
          });
        }
        pageResults.push({ asin, status: "ok", note: null, extractedCount: reviews.length });
      } catch (error) {
        pageResults.push({
          asin,
          status: "error",
          note: error instanceof Error ? error.message.slice(0, 120) : "未知错误",
          extractedCount: 0,
        });
      }
    }
  } finally {
    await session.close();
  }
  return { items, pageResults };
}

/** 服务端构建单次采集的 Preview（含缓存写入，供 collect-confirm 取回） */
export async function createReviewCollectPreview(input: {
  context: AccessContext;
  taskId: string;
  asins: ReviewCollectRequestAsin[];
  headless?: boolean;
}): Promise<Omit<ReviewCollectPreview, "subjectKey" | "taskId">> {
  const { items, pageResults } = await collectReviewSnippets({ asins: input.asins, headless: input.headless });
  const capturedAt = new Date().toISOString();
  const preview: ReviewCollectPreview = {
    previewId: randomUUID(),
    items,
    pageResults,
    capturedAt,
    expiresAt: Date.now() + PREVIEW_TTL_MS,
    subjectKey: reviewCollectSubjectKey(input.context),
    taskId: input.taskId,
  };
  previewStore.put(preview);
  return {
    previewId: preview.previewId,
    items: preview.items,
    pageResults: preview.pageResults,
    capturedAt: preview.capturedAt,
    expiresAt: preview.expiresAt,
  };
}

/** 幂等键（route 层做重复标记用）：asin + 归一化标题哈希，与 import 去重语义一致地提示 */
export function buildSnippetPreviewDedupeKey(item: ReviewSnippetPreviewItem): string {
  return `${item.asin}|${item.title.trim().toLowerCase().replace(/\s+/g, " ")}`;
}
