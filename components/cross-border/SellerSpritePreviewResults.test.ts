import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SellerSpritePreviewResult } from "@/lib/upstream/sellersprite/preview";
import { SellerSpritePreviewResults } from "./SellerSpritePreviewResults";

function previewFixture(): SellerSpritePreviewResult & { importToken: string } {
  return {
    schemaVersion: "sellersprite_preview_v1",
    source: {
      sourceProvider: "SellerSprite",
      sourceType: "sellersprite_xlsx",
      marketplace: "Amazon US",
      reportType: "SellerSprite Search Results",
      currency: "USD",
      sourceFileSha256: "a".repeat(64),
    },
    acceptedRowCount: 7,
    rejectedRowCount: 3,
    acceptedRows: [{
      rowNumber: 2,
      rowHash: "row-hash-2",
      facts: {
        asin: "B000000002",
        parentAsin: "B000000001",
        title: "A long but useful synthetic product title for layout verification",
        amazonUrl: "https://www.amazon.com/dp/B000000002",
        imageUrl: "https://m.media-amazon.com/images/I/synthetic.jpg",
        priceUsd: 19.99,
        rating: 4.5,
        reviewCount: 128,
        brand: "Fixture Brand",
        category: "Beauty & Personal Care > Sun Care > Face",
      },
      estimates: {
        estimatedMonthlySales: 320,
        estimatedMonthlyRevenueUsd: 6396.8,
      },
      fieldStatus: {
        priceUsd: "snapshot",
        searchRank: "missing",
      } as never,
      missingFields: ["searchRank"],
      warnings: [{ code: "missing_optional_field", field: "searchRank" }],
    }],
    rejectedRows: [{
      rowNumber: 9,
      status: "invalid",
      reasons: [{ code: "invalid_asin", field: "asin" }],
    }],
    duplicates: [],
    warnings: [{ code: "invalid_rows_quarantined", rowNumbers: [9, 10, 11] }],
    blockingErrors: [],
    previewTruncated: false,
    importToken: "synthetic-import-token",
  };
}

function renderResults(): string {
  return renderToStaticMarkup(createElement(SellerSpritePreviewResults, {
    preview: previewFixture(),
    selectedRowHashes: ["row-hash-2", "row-hash-3"],
    processedRowHashes: new Set<string>(),
    canSelect: true,
    isImporting: false,
    selectAllOverLimit: false,
    maxSelectedRows: 20,
    onSelectAll: () => undefined,
    onClearSelection: () => undefined,
    onToggleRow: () => undefined,
  }));
}

describe("SellerSpritePreviewResults", () => {
  it("renders response-backed summary counts and the import-safety disclaimer", () => {
    const html = renderResults();

    expect(html).toContain("可加入研究池");
    expect(html).toContain(">7<");
    expect(html).toContain("异常隔离");
    expect(html).toContain(">3<");
    expect(html).toContain("警告");
    expect(html).toContain(">1<");
    expect(html).toContain("已选择");
    expect(html).toContain(">2<");
    expect(html).toContain("最多 20 项");
    expect(html).toContain("结构合格仅表示数据可安全导入，不代表商品值得采购或属于选品结论");
  });

  it("keeps the core row compact while placing full technical fields in closed details", () => {
    const html = renderResults();
    const rowDetails = html.match(/<details([^>]*)>\s*<summary[^>]*>查看详情<\/summary>([\s\S]*?)<\/details>/);

    expect(html).toContain("line-clamp-2");
    expect(html).toContain("$19.99");
    expect(html).toContain("评分");
    expect(html).toContain("4.5");
    expect(html).toContain("评论");
    expect(html).toContain("128");
    expect(html).toContain("月销量");
    expect(html).toContain("320");
    expect(html).toContain("月销售额");
    expect(html).toContain("$6,396.80");
    expect(html).toContain("存在警告");
    expect(rowDetails).not.toBeNull();
    expect(rowDetails?.[1]).not.toMatch(/\bopen\b/);
    expect(rowDetails?.[2]).toContain("https://www.amazon.com/dp/B000000002");
    expect(rowDetails?.[2]).toContain("B000000001");
    expect(rowDetails?.[2]).toContain("Beauty &amp; Personal Care &gt; Sun Care &gt; Face");
    // B：卡片式布局（grid 卡片），不再依赖横向滚动表格
    expect(html).toContain("md:grid-cols-2");
  });

  it("shows product thumbnails and keeps rejected rows in a visually separated non-selectable region", () => {
    const html = renderResults();

    // B：每项展示缩略图（图片链接仅用于浏览器加载，路由层仍做 SSRF 校验）
    expect(html).toContain("m.media-amazon.com/images/I/synthetic.jpg");
    // 异常隔离区视觉分离：独立色块 + 标题 + 明确"不会进入选择或导入"
    expect(html).toContain("异常隔离区");
    expect(html).toContain("不会进入选择或导入");
    expect(html).toContain("第 9 行");
    // 异常隔离区不可选（无 checkbox）
    expect(html).not.toContain('aria-label="选择第 9 行商品"');
  });
});
