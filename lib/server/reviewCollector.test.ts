import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  storeReviewCollectPreview,
  takeReviewCollectPreview,
  peekReviewCollectPreview,
  consumeReviewCollectPreview,
  resetReviewCollectPreviewStoreForTests,
  getPendingReviewCollectPreviewDto,
  findPendingReviewCollectPreview,
  reviewBlockForPageStatus,
  isReusableReviewCollectPreview,
  collectReviewSnippets,
  reviewCollectDetailUrl,
  REVIEW_COLLECT_US_POSTAL_CODE,
  REVIEW_COLLECTOR_ALLOWED_ORIGINS,
  type ReviewCollectPreview,
} from "./reviewCollector";
import {
  buildReviewDuplicateKey,
  buildReviewContentHash,
  type ReviewItem,
} from "./reviewEvidence";

/* ── 隔离会话打桩：只观察会话参数与导航 URL，不启动真实浏览器 ── */
const sessionProbe = vi.hoisted(() => ({
  openInputs: [] as Array<Record<string, unknown>>,
  navigateUrls: [] as string[],
  forceFinalUrl: null as string | null,
}));

vi.mock("@/tools/collectors/amazon/browser-control", () => ({
  resolveSystemBrowser: () => ({ browser: "chrome", locationType: "system", path: "C:/chrome.exe" }),
  openIsolatedPublicBrowserSession: async (input: Record<string, unknown>) => {
    sessionProbe.openInputs.push(input);
    let evaluates = 0;
    return {
      navigate: async (url: string) => {
        sessionProbe.navigateUrls.push(url);
        const finalUrl = sessionProbe.forceFinalUrl ?? url;
        return { finalUrl, allowedFinalOrigin: true, mainDocumentHttpStatus: 200, navigationElapsedMs: 12 };
      },
      evaluateDomByValue: async () => {
        evaluates += 1;
        if (evaluates === 1) return { pageStatus: "ok" };
        if (evaluates === 2) {
          return { explicitNoReviews: false, reviewNodeCount: 2, pageTitle: "Amazon product", elapsedMs: 10, retryAttempt: 0, scrollTriggered: true };
        }
        return [{ rating: 5, date: "2026-09-01", title: "Great pick" }];
      },
      close: async () => undefined,
    };
  },
}));

const SUBJECT_OWNER = "owner:v1";
const SUBJECT_VISITOR_A = "visitor:demo-a";
const SUBJECT_VISITOR_B = "visitor:demo-b";
const TASK_ID = "task-review-test-1";
const ASIN = "B0A1B2C3D4";

describe("reviewBlockForPageStatus（页面分类 → 评论采集阻断映射）", () => {  it("maps the Amazon automation gateway to a blocker that never says 登录", () => {
    const block = reviewBlockForPageStatus("automation_blocked");
    expect(block).not.toBeNull();
    expect(block?.status).toBe("captcha_required");
    expect(block?.note).toContain("自动化访问校验");
    expect(block?.note).not.toContain("登录");
    // 真实分类保留在诊断字段（不被错误地记成 captcha / login_wall）
    expect(block?.diagnosticPageStatus).toBe("automation_blocked");
  });

  it("keeps captcha / login_wall / error_page mappings unchanged", () => {
    expect(reviewBlockForPageStatus("captcha")).toMatchObject({ status: "captcha_required", diagnosticPageStatus: "captcha" });
    expect(reviewBlockForPageStatus("login_wall")).toMatchObject({ status: "login_required", diagnosticPageStatus: "login_wall" });
    expect(reviewBlockForPageStatus("login_wall")?.note).toContain("页面要求登录");
    expect(reviewBlockForPageStatus("error_page")).toMatchObject({ status: "page_error", diagnosticPageStatus: "error_page" });
    expect(reviewBlockForPageStatus("captcha")?.diagnosticPageStatus).not.toBe("automation_blocked");
  });

  it("does not block ok / unknown_page / missing status", () => {
    expect(reviewBlockForPageStatus("ok")).toBeNull();
    expect(reviewBlockForPageStatus("unknown_page")).toBeNull();
    expect(reviewBlockForPageStatus(null)).toBeNull();
    expect(reviewBlockForPageStatus(undefined)).toBeNull();
  });
});

function createSamplePreview(overrides: Partial<ReviewCollectPreview> = {}): ReviewCollectPreview {
  const capturedAt = "2026-09-06T10:00:00.000Z";
  return {
    previewId: "preview-uuid-1234",
    items: [
      {
        asin: ASIN,
        role: "current_candidate",
        rating: 5,
        date: "2026-08-01",
        title: "Great insulated tumbler!",
        sourceUrl: `https://www.amazon.com/dp/${ASIN}`,
        bindingNote: "详情页公开 Top Reviews 片段",
      },
      {
        asin: "B0COMPET01",
        role: "competitor",
        rating: 2,
        date: "2026-08-02",
        title: "Leaks when tipped over.",
        sourceUrl: "https://www.amazon.com/dp/B0COMPET01",
        bindingNote: "详情页公开 Top Reviews 片段",
      },
    ],
    pageResults: [
      {
        asin: ASIN,
        status: "ok",
        note: null,
        extractedCount: 1,
        reviewNodeCount: 3,
        finalUrl: `https://www.amazon.com/dp/${ASIN}?language=en_US`,
        pageTitle: "Amazon product",
        waitElapsedMs: 142,
        pageStatus: "ok",
      },
      { asin: "B0COMPET01", status: "ok", note: null, extractedCount: 1 },
    ],
    capturedAt,
    expiresAt: Date.now() + 15 * 60 * 1000,
    subjectKey: SUBJECT_OWNER,
    taskId: TASK_ID,
    ...overrides,
  };
}

describe("getPendingReviewCollectPreviewDto 纯只读契约", () => {
  beforeEach(() => {
    resetReviewCollectPreviewStoreForTests();
  });

  it("正常返回 DTO 且纯读不消费（多次读取幂等，仍可被 take 消费）", () => {
    const preview = createSamplePreview();
    storeReviewCollectPreview(preview);

    const dto1 = getPendingReviewCollectPreviewDto({
      subjectKey: SUBJECT_OWNER,
      taskId: TASK_ID,
      asin: ASIN,
    });
    expect(dto1).not.toBeNull();
    expect(dto1?.previewId).toBe(preview.previewId);
    expect(dto1?.capturedAt).toBe(preview.capturedAt);
    expect(new Date(dto1!.expiresAt).getTime()).toBe(preview.expiresAt);
    expect(dto1?.items).toHaveLength(2);
    expect(dto1?.items[0]).toEqual({
      asin: ASIN,
      role: "current_candidate",
      rating: 5,
      date: "2026-08-01",
      title: "Great insulated tumbler!",
      duplicate: false,
    });
    expect(dto1?.pageResults).toHaveLength(2);
    expect(dto1?.pageResults[0]).toMatchObject({
      reviewNodeCount: 3,
      finalUrl: `https://www.amazon.com/dp/${ASIN}?language=en_US`,
      pageTitle: "Amazon product",
      waitElapsedMs: 142,
      pageStatus: "ok",
    });

    // 第二次读取依然存在（不消费）
    const dto2 = getPendingReviewCollectPreviewDto({
      subjectKey: SUBJECT_OWNER,
      taskId: TASK_ID,
      asin: ASIN,
    });
    expect(dto2).toEqual(dto1);

    // 严禁泄露内部凭证与 subjectKey/taskId
    expect((dto1 as Record<string, unknown>).subjectKey).toBeUndefined();
    expect((dto1 as Record<string, unknown>).taskId).toBeUndefined();
    expect((dto1!.items[0] as Record<string, unknown>).sourceUrl).toBeUndefined();
    expect((dto1!.items[0] as Record<string, unknown>).bindingNote).toBeUndefined();

    // 仍能被正式 action=collect-confirm 正常 take 消费
    const claimed = takeReviewCollectPreview(preview.previewId, {
      subjectKey: SUBJECT_OWNER,
      taskId: TASK_ID,
    });
    expect(claimed).not.toBeNull();
    expect(claimed?.previewId).toBe(preview.previewId);

    // 消费后再次查询返回 null
    const dtoAfterTake = getPendingReviewCollectPreviewDto({
      subjectKey: SUBJECT_OWNER,
      taskId: TASK_ID,
      asin: ASIN,
    });
    expect(dtoAfterTake).toBeNull();
  });

  it("正确计算每条评论片段相对于 currentDatasetReviews 的 duplicate 标记", () => {
    const preview = createSamplePreview();
    storeReviewCollectPreview(preview);

    // 构造一条与第一项完全匹配的 existing review
    const matchingDuplicateKey = buildReviewDuplicateKey({
      reviewId: null,
      asin: ASIN,
      contentHash: buildReviewContentHash("Great insulated tumbler!"),
      rating: 5,
      reviewDate: "2026-08-01",
    });

    const mockDatasetReviews = [
      {
        id: "rev-1",
        asin: ASIN,
        sourceProductRole: "current_candidate" as const,
        reviewText: "Great insulated tumbler!",
        reviewTitle: null,
        rating: 5,
        reviewDate: "2026-08-01",
        duplicateKey: matchingDuplicateKey,
        contentHash: buildReviewContentHash("Great insulated tumbler!"),
        sourceType: "browser" as const,
        bindingKind: "browser_verified" as const,
        createdAt: "2026-09-01T00:00:00.000Z",
        collectorVersion: "v1",
        nature: "positive" as const,
      },
    ] as unknown as ReviewItem[];

    const dto = getPendingReviewCollectPreviewDto({
      subjectKey: SUBJECT_OWNER,
      taskId: TASK_ID,
      asin: ASIN,
      currentDatasetReviews: mockDatasetReviews,
    });

    expect(dto).not.toBeNull();
    // 第一条匹配现存 dataset，标记 duplicate = true
    expect(dto?.items[0].duplicate).toBe(true);
    // 第二条不匹配现存 dataset，标记 duplicate = false
    expect(dto?.items[1].duplicate).toBe(false);
  });

  it("跨 task / 跨 subject 隔离 fail-closed", () => {
    const preview = createSamplePreview({ subjectKey: SUBJECT_VISITOR_A, taskId: "task-demo-1" });
    storeReviewCollectPreview(preview);

    // 相同 subject 与 task 能读到
    const match = getPendingReviewCollectPreviewDto({
      subjectKey: SUBJECT_VISITOR_A,
      taskId: "task-demo-1",
      asin: ASIN,
    });
    expect(match).not.toBeNull();

    // 跨 subject（Visitor B 查询 Visitor A 的 Preview）-> null
    const crossSubject = getPendingReviewCollectPreviewDto({
      subjectKey: SUBJECT_VISITOR_B,
      taskId: "task-demo-1",
      asin: ASIN,
    });
    expect(crossSubject).toBeNull();

    // 跨 task（相同 subject 查询不同 task）-> null
    const crossTask = getPendingReviewCollectPreviewDto({
      subjectKey: SUBJECT_VISITOR_A,
      taskId: "task-demo-2",
      asin: ASIN,
    });
    expect(crossTask).toBeNull();

    // ASIN 不匹配 -> null
    const mismatchAsin = getPendingReviewCollectPreviewDto({
      subjectKey: SUBJECT_VISITOR_A,
      taskId: "task-demo-1",
      asin: "B0NONEXIST9",
    });
    expect(mismatchAsin).toBeNull();
  });

  it("过期返回 null", () => {
    const expiredPreview = createSamplePreview({
      previewId: "expired-preview-1",
      expiresAt: Date.now() - 1000,
    });
    storeReviewCollectPreview(expiredPreview);

    const dto = getPendingReviewCollectPreviewDto({
      subjectKey: SUBJECT_OWNER,
      taskId: TASK_ID,
      asin: ASIN,
    });
    expect(dto).toBeNull();
  });

  it("不存在返回 null", () => {
    const dto = getPendingReviewCollectPreviewDto({
      subjectKey: SUBJECT_OWNER,
      taskId: "non-existent-task",
      asin: ASIN,
    });
    expect(dto).toBeNull();
  });
});

describe("Review Preview 确认生命周期", () => {
  beforeEach(() => {
    resetReviewCollectPreviewStoreForTests();
  });

  it("peek 不消费；正式保存成功后 consume", () => {
    const preview = createSamplePreview();
    storeReviewCollectPreview(preview);
    expect(peekReviewCollectPreview(preview.previewId, { subjectKey: SUBJECT_OWNER, taskId: TASK_ID })).toEqual(preview);
    expect(peekReviewCollectPreview(preview.previewId, { subjectKey: SUBJECT_OWNER, taskId: "other-task" })).toBeNull();
    expect(consumeReviewCollectPreview(preview.previewId, { subjectKey: SUBJECT_OWNER, taskId: TASK_ID })).toBe(true);
    expect(peekReviewCollectPreview(preview.previewId, { subjectKey: SUBJECT_OWNER, taskId: TASK_ID })).toBeNull();
  });

  it("校验、CAS 或导入失败时不调用 consume，Preview 仍可重试", () => {
    const preview = createSamplePreview();
    storeReviewCollectPreview(preview);
    // 模拟 route 在 selectedIndices / CAS / import 任一失败路径：只 peek，不消费。
    expect(peekReviewCollectPreview(preview.previewId, { subjectKey: SUBJECT_OWNER, taskId: TASK_ID })).not.toBeNull();
    expect(peekReviewCollectPreview(preview.previewId, { subjectKey: SUBJECT_OWNER, taskId: TASK_ID })).not.toBeNull();
  });

  it("task 或 subject 不匹配时无法消费", () => {
    const preview = createSamplePreview();
    storeReviewCollectPreview(preview);
    expect(consumeReviewCollectPreview(preview.previewId, { subjectKey: SUBJECT_VISITOR_A, taskId: TASK_ID })).toBe(false);
    expect(consumeReviewCollectPreview(preview.previewId, { subjectKey: SUBJECT_OWNER, taskId: "other-task" })).toBe(false);
    expect(peekReviewCollectPreview(preview.previewId, { subjectKey: SUBJECT_OWNER, taskId: TASK_ID })).not.toBeNull();
  });
});

/**
 * VOC marketplace redirect 修复（2026-09-14）。
 *
 * 现场：隔离会话访问 `www.amazon.com/dp/<asin>?language=en_US` 被 Amazon 按访客归属
 * 跳转到 `www.amazon.sg`（ref_=mr_direct_us_sg_sg），最终 origin 不在白名单 →
 * blocked_redirect → 编排器 navigation_not_allowed。商品资料链路因为在导航前做了
 * 美国配送校准 + currency=USD 而停在 amazon.com，这里把 VOC 对齐到同一方式。
 */
describe("VOC 采集会话配置（与商品资料一致）", () => {
  beforeEach(() => {
    sessionProbe.openInputs.length = 0;
    sessionProbe.navigateUrls.length = 0;
    sessionProbe.forceFinalUrl = null;
  });

  it("会话带美国配送校准，导航 URL 显式 en_US + USD，白名单策略不变", async () => {
    const result = await collectReviewSnippets({
      asins: [{ asin: ASIN, role: "current_candidate" }],
      headless: true,
    });

    expect(sessionProbe.openInputs).toHaveLength(1);
    const input = sessionProbe.openInputs[0]!;
    expect(input.calibrateEnvironment).toEqual({ postalCode: REVIEW_COLLECT_US_POSTAL_CODE });
    // 白名单策略不动：仍是同一个 Amazon 零售站点常量
    expect(input.allowedOrigins).toBe(REVIEW_COLLECTOR_ALLOWED_ORIGINS);
    // 导航 URL 与商品资料采集同形态，显式保持 amazon.com + USD 市场
    expect(sessionProbe.navigateUrls).toEqual([
      `https://www.amazon.com/dp/${ASIN}?language=en_US&currency=USD`,
    ]);
    expect(reviewCollectDetailUrl(ASIN)).toBe(`https://www.amazon.com/dp/${ASIN}?language=en_US&currency=USD`);
    expect(result.pageResults[0]?.status).toBe("ok");
    expect(result.items).toHaveLength(1);
  });

  it("被 marketplace redirect 换到白名单内其它市场（amazon.co.jp）时不提取评论，明确失败", async () => {
    // 现场实测：Amazon 会按访客归属把 /dp/ 请求跳到区域站点（amazon.sg / amazon.co.jp）。
    // co.jp 在白名单内，但它的评论属于另一个市场，不能当作本次（amazon.com）证据。
    sessionProbe.forceFinalUrl = `https://www.amazon.co.jp/dp/${ASIN}?ref_=mr_direct_us_jp_jp&showmri=undefined&th=1`;
    const result = await collectReviewSnippets({
      asins: [{ asin: ASIN, role: "current_candidate" }],
      headless: true,
    });
    expect(result.items).toHaveLength(0);
    expect(result.pageResults[0]?.status).toBe("blocked_redirect");
    expect(result.pageResults[0]?.note).toContain("amazon.co.jp");
    expect(result.pageResults[0]?.extractedCount).toBe(0);
    expect(result.pageResults[0]?.finalUrl).toContain("amazon.co.jp");
  });
});

describe("Preview 复用判定（失败态不再当作成功缓存）", () => {
  const pageResult = (status: string) => ({
    asin: ASIN,
    status: status as never,
    note: null,
    extractedCount: 0,
  });

  it("白名单外跳转（navigation_not_allowed）不复用：重试必须重新采集", () => {
    const pending = createSamplePreview({ items: [], pageResults: [pageResult("blocked_redirect")] });
    expect(isReusableReviewCollectPreview(pending)).toBe(false);
  });

  it("瞬时提取失败不复用", () => {
    const pending = createSamplePreview({ items: [], pageResults: [pageResult("extraction_empty")] });
    expect(isReusableReviewCollectPreview(pending)).toBe(false);
  });

  it("成功待确认条目仍复用（保留 TTL 幂等）", () => {
    const pending = createSamplePreview();
    expect(pending.items.length).toBeGreaterThan(0);
    expect(isReusableReviewCollectPreview(pending)).toBe(true);
  });

  it("登录墙 / 验证码 / 明确无评论仍是可操作阻断态，继续复用", () => {
    for (const status of ["login_required", "captcha_required", "confirmed_no_reviews"]) {
      const pending = createSamplePreview({ items: [], pageResults: [pageResult(status)] });
      expect(isReusableReviewCollectPreview(pending), status).toBe(true);
    }
  });
});
