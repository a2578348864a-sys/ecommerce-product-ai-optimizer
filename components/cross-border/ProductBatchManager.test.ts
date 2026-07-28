import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProductBatchItemView, ProductBatchView } from "@/lib/productBatchStore";
import { ProductBatchManagerView } from "./ProductBatchManager";

const batch: ProductBatchView = {
  id: "batch-a",
  batchName: "Home · organizer",
  marketplace: "US",
  currency: "USD",
  reportType: "search_results",
  query: "organizer",
  category: "Home",
  priceMinCents: 1000,
  priceMaxCents: 4000,
  briefHash: "a".repeat(64),
  sourceFileName: "input.xlsx",
  sourceFileSha256: "b".repeat(64),
  normalizedBusinessHash: "c".repeat(64),
  snapshotHash: "d".repeat(64),
  manifestHash: "e".repeat(64),
  itemCount: 1,
  acceptedCount: 1,
  quarantinedCount: 0,
  dataQualityStatus: "passed",
  batchStatus: "ready",
  sellerSpriteDisclaimerVersion: "v1",
  normalizedSnapshotJson: '{"schemaVersion":"sellersprite-market-snapshot.v3"}',
  manifestJson: '{"schemaVersion":"sellersprite-local-preview-manifest.v3"}',
  qualitySummaryJson: "{}",
  errorJson: null,
  dedupeKey: "f".repeat(64),
  importedAt: "2026-07-28T00:00:00.000Z",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

const item: ProductBatchItemView = {
  id: "item-a",
  batchId: "batch-a",
  productKey: "amazon:US:B000000001",
  ordinal: 0,
  asin: "B000000001",
  parentAsin: null,
  itemIdentityHash: "1".repeat(64),
  itemHash: "2".repeat(64),
  evidenceHash: "3".repeat(64),
  normalizedProductJson: JSON.stringify({
    providerMetrics: {
      productTitle: { status: "resolved", normalized: "Closet organizer" },
      price: { status: "resolved", normalized: 29.99 },
      rating: { status: "resolved", normalized: 4.5 },
      reviews: { status: "resolved", normalized: 120 },
    },
  }),
  occurrenceProjectionJson: '{"occurrences":[]}',
  familyProjectionJson: '{"family":null}',
  rankingJson: '{"scoreRank":1,"researchPriority":"priority_1"}',
  provisionalDisposition: "provisional_score_only",
  researchPriority: "priority_1",
  evidenceStatus: "sufficient_for_comparison",
  promotionEligible: false,
  imageSnapshotJson: '{"status":"not_cached"}',
  createdAt: "2026-07-28T00:00:00.000Z",
};

function render(accessMode: "owner" | "visitor") {
  return renderToStaticMarkup(createElement(ProductBatchManagerView, {
    state: "ready",
    accessMode,
    remainingAiCalls: accessMode === "visitor" ? 5 : null,
    batches: [batch],
    selection: {
      activeProductBatchId: batch.id,
      activeLegacyRegistrationId: null,
      updatedAt: batch.updatedAt,
    },
    legacyRegistrationId: "production-registration-20260717-01",
    selectedBatch: batch,
    selectedItems: [item],
    busy: false,
  }));
}

describe("ProductBatch unified role UI", () => {
  it("shows Owner and Visitor the same main batch actions", () => {
    const owner = render("owner");
    const visitor = render("visitor");
    for (const label of [
      "导入新批次",
      "批次历史",
      "查看商品",
      "设置为当前",
      "切回 Legacy",
      "归档",
    ]) {
      expect(owner).toContain(label);
      expect(visitor).toContain(label);
    }
    expect(visitor).not.toContain("仅 Owner");
    expect(visitor).not.toContain("访客无权上传");
  });

  it("adds only the Visitor quota and isolated sandbox notice", () => {
    const owner = render("owner");
    const visitor = render("visitor");
    expect(visitor).toContain("剩余真实 AI 额度 5/5");
    expect(visitor).toContain("独立访客沙盒");
    expect(owner).not.toContain("独立访客沙盒");
  });

  it("keeps new ProductBatch items disconnected from Candidate", () => {
    const html = render("visitor");
    expect(html).toContain("Closet organizer");
    expect(html).toContain("商品研究接线将在下一阶段开放");
    expect(html).not.toContain("研究此商品");
    expect(html).not.toContain("/agent/run");
  });

  it("does not expose private batch data in the unauthenticated state", () => {
    const html = renderToStaticMarkup(createElement(ProductBatchManagerView, {
      state: "unauthenticated",
      accessMode: null,
      remainingAiCalls: null,
      batches: [],
      selection: null,
      legacyRegistrationId: null,
      selectedBatch: null,
      selectedItems: [],
      busy: false,
    }));
    expect(html).toContain("登录后管理商品批次");
    expect(html).not.toContain("batch-a");
    expect(html).not.toContain("Closet organizer");
  });
});
