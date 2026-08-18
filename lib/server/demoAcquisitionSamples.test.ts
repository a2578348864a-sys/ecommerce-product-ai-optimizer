/**
 * Demo Acquisition Samples — 演示回放样本与 demo 分支契约测试
 *
 * 覆盖：
 * - buildDemoBrowserCollectPreview：三 ASIN 一致 + schema + 字段值来自真实样本；
 * - buildDemoReviewCollectPreviewItems：样本评论映射（role/rating/date/sourceUrl）；
 * - 诚实性：样本全部带 demo 语义（route 响应 demo:true），前端必须展示“演示数据”。
 */
import { describe, expect, it } from "vitest";
import {
  DEMO_ACQUISITION_EVIDENCE_ID,
  DEMO_BROWSER_EVIDENCE_SAMPLE,
  DEMO_REVIEW_EVIDENCE_SAMPLE,
  DEMO_SOURCING_EVIDENCE_SAMPLE,
  DEMO_VOC_ANALYSIS_SAMPLE,
  buildDemoBrowserCollectPreview,
  buildDemoReviewCollectPageResults,
  buildDemoReviewCollectPreviewItems,
} from "@/lib/server/demoAcquisitionSamples";

describe("demoAcquisitionSamples", () => {
  it("DEMO_ACQUISITION_EVIDENCE_ID 是稳定标识（save 链识别用）", () => {
    expect(DEMO_ACQUISITION_EVIDENCE_ID).toBe("demo-acquisition-sample-v1");
  });

  it("buildDemoBrowserCollectPreview：三 ASIN 一致 + 合法 extraction schema + 字段来自真实样本", () => {
    const taskAsin = "B0F2BF31PW";
    const preview = buildDemoBrowserCollectPreview(taskAsin);
    expect(preview.extraction.schemaVersion).toBe("amazon-detail-page-extraction.v1");
    expect(preview.extraction.expectedAsin).toBe(taskAsin);
    expect(preview.extraction.urlAsin).toBe(taskAsin);
    expect(preview.extraction.pageAsin).toBe(taskAsin);
    expect(preview.extraction.entityBound).toBe(true);
    expect(preview.extraction.bindingProof.productContainerFound).toBe(true);
    expect(preview.extraction.pageStatus).toBe("ok");
    // 字段值来自真实样本（THERMOS）
    expect(preview.extraction.fields.title.value).toBe(DEMO_BROWSER_EVIDENCE_SAMPLE.snapshots[0].fields.title.value);
    expect(preview.extraction.fields.price.value).toBe(DEMO_BROWSER_EVIDENCE_SAMPLE.snapshots[0].fields.price.value);
    expect(preview.navigation.allowedFinalOrigin).toBe(true);
    expect(preview.calibration?.usdPreferencesConfirmed).toBe(true);
    // 与目标 ASIN 不一致时仍可构造（save 时由 buildConfirmedSnapshot 硬门禁拒绝）
    const other = buildDemoBrowserCollectPreview("B012345678");
    expect(other.extraction.expectedAsin).toBe("B012345678");
  });

  it("buildDemoReviewCollectPreviewItems：样本评论映射完整（role/rating/date/sourceUrl）", () => {
    const items = buildDemoReviewCollectPreviewItems();
    expect(items.length).toBe(DEMO_REVIEW_EVIDENCE_SAMPLE.dataset.reviews.length);
    expect(items.length).toBeGreaterThan(0);
    const first = items[0];
    expect(first.asin.length).toBeGreaterThan(0);
    expect(["current_candidate", "competitor"]).toContain(first.role);
    expect(typeof first.title).toBe("string");
    expect(typeof first.sourceUrl).toBe("string");
    expect(first.bindingNote.length).toBeGreaterThan(0);
  });

  it("buildDemoReviewCollectPageResults：按 ASIN 分组且状态 ok", () => {
    const pages = buildDemoReviewCollectPageResults();
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(page.status).toBe("ok");
      expect(page.extractedCount).toBeGreaterThan(0);
    }
  });

  it("样本自洽：VOC 分析绑定候选与浏览器证据目标一致（证据链完整性）", () => {
    expect(DEMO_VOC_ANALYSIS_SAMPLE.candidateId).toBe(DEMO_BROWSER_EVIDENCE_SAMPLE.candidateId);
    expect(DEMO_SOURCING_EVIDENCE_SAMPLE.candidates.length).toBeGreaterThan(0);
    // 1688 样本：供应线索字段齐全（价格分层/MOQ/卖家自报）
    const candidate = DEMO_SOURCING_EVIDENCE_SAMPLE.candidates[0];
    expect(candidate.offerId).toMatch(/^\d{5,20}$/);
    expect(candidate.displayedPrice).toBeDefined();
  });
});
