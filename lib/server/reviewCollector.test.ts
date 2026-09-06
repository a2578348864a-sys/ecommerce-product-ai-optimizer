import { beforeEach, describe, expect, it } from "vitest";
import {
  storeReviewCollectPreview,
  takeReviewCollectPreview,
  resetReviewCollectPreviewStoreForTests,
  getPendingReviewCollectPreviewDto,
  findPendingReviewCollectPreview,
  type ReviewCollectPreview,
} from "./reviewCollector";
import {
  buildReviewDuplicateKey,
  buildReviewContentHash,
  type ReviewItem,
} from "./reviewEvidence";

const SUBJECT_OWNER = "owner:v1";
const SUBJECT_VISITOR_A = "visitor:demo-a";
const SUBJECT_VISITOR_B = "visitor:demo-b";
const TASK_ID = "task-review-test-1";
const ASIN = "B0A1B2C3D4";

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
      { asin: ASIN, status: "ok", note: null, extractedCount: 1 },
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
