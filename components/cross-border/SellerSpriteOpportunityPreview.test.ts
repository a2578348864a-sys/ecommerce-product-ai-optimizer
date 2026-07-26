import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildSellerSpriteOpportunityPreviewViewModel } from "@/lib/sellerSpriteOpportunityPreview";
import { buildSellerSpriteBriefBoundShadowReport } from "@/lib/upstream/sellersprite/briefBoundShadowReport";
import { buildSellerSpriteMarketSnapshot } from "@/lib/upstream/sellersprite/marketSnapshot";
import { precheckSellerSpriteXlsx } from "@/lib/upstream/sellersprite/precheck";
import { createSellerSpriteShadowSelectionBrief } from "@/lib/upstream/sellersprite/shadowBrief";
import { createSellerSpritePreviewTestWorkbook } from "@/tools/upstream/sellersprite-preview/test-fixtures";
import {
  SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
  SELLERSPRITE_CATEGORY_CURRENT_ROWS,
} from "@/lib/upstream/sellersprite/fixtures/category-current.sanitized.v1";

vi.mock("@/components/WorkspaceSidebar", () => ({
  WorkspaceSidebar: () => createElement("aside", { "data-testid": "sidebar" }),
  WorkspaceMobileNav: () => createElement("nav", { "data-testid": "mobile-nav" }),
}));

import {
  filterAndSortSellerSpritePreviewProducts,
  SellerSpriteOpportunityPreview,
  SellerSpritePreviewResults,
  validateSellerSpritePreviewForm,
} from "./SellerSpriteOpportunityPreview";

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function viewModel(reportType: "search_results" | "category_current" = "search_results") {
  const capturedAt = "2026-07-27T02:00:00.000Z";
  const precheck = precheckSellerSpriteXlsx(createSellerSpritePreviewTestWorkbook(
    reportType === "category_current" ? {
      headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
      rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
    } : {},
  ), {
    capturedAt,
    expectedReportType: reportType,
  });
  const snapshot = buildSellerSpriteMarketSnapshot(precheck);
  const briefCommon = {
    marketplace: "amazon.com",
    market: "US",
    currency: "USD",
    category: "Home & Kitchen",
    priceMin: 10,
    priceMax: 100,
    requiredSignals: ["price", "rating", "reviews", "searchRank"],
    optionalSignals: ["estimatedMonthlySales"],
    createdAt: capturedAt,
    briefSource: "component-test",
  };
  const brief = reportType === "search_results"
    ? createSellerSpriteShadowSelectionBrief({
        ...briefCommon,
        reportType,
        query: "storage box",
      })
    : createSellerSpriteShadowSelectionBrief({
        ...briefCommon,
        reportType,
        query: null,
      });
  const report = buildSellerSpriteBriefBoundShadowReport(snapshot, brief);
  return buildSellerSpriteOpportunityPreviewViewModel({
    requestId: "12345678-0000-0000-0000-000000000000",
    sourceFileName: "sample.xlsx",
    headerColumnCount: precheck.headerColumnCount,
    snapshot,
    report,
  });
}

describe("SellerSprite opportunity preview client validation", () => {
  const validFile = new File([
    asArrayBuffer(createSellerSpritePreviewTestWorkbook()),
  ], "sample.xlsx");
  const valid = {
    file: validFile,
    reportType: "search_results" as const,
    query: "storage box",
    category: "Home & Kitchen",
    priceMin: "10",
    priceMax: "100",
  };

  it("accepts a valid single XLSX Selection Brief", () => {
    expect(validateSellerSpritePreviewForm(valid)).toEqual({ ok: true, message: null });
  });

  it("accepts Category Current without query and rejects a supplied query", () => {
    expect(validateSellerSpritePreviewForm({
      ...valid,
      reportType: "category_current",
      query: "",
    })).toEqual({ ok: true, message: null });
    const rejected = validateSellerSpritePreviewForm({
      ...valid,
      reportType: "category_current",
      query: "not applicable",
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain("不需要查询词");
  });

  it.each([
    [{ ...valid, file: null }, "请选择"],
    [{ ...valid, file: new File(["x"], "sample.csv") }, ".xlsx"],
    [{ ...valid, query: " " }, "查询词"],
    [{ ...valid, category: " " }, "类目"],
    [{ ...valid, priceMin: "-1" }, "非负"],
    [{ ...valid, priceMin: "101", priceMax: "100" }, "最低价"],
  ])("rejects invalid client input before a request", (values, messagePart) => {
    const result = validateSellerSpritePreviewForm(values);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(messagePart);
  });
});

describe("SellerSprite opportunity preview presentation", () => {
  it("does not render upload controls before server-authorized Owner access", () => {
    const html = renderToStaticMarkup(createElement(SellerSpriteOpportunityPreview));
    expect(html).toContain("正在核验 Owner 权限");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("生成市场预览");
  });

  it("renders the safety rail, product-weighted summaries and product table", () => {
    const html = renderToStaticMarkup(createElement(SellerSpritePreviewResults, {
      data: viewModel(),
    }));
    expect(html).toContain("安全轨道");
    expect(html).toContain("第三方估算数据");
    expect(html).toContain("不可晋级");
    expect(html).toContain("商品级口径优先");
    expect(html).toContain("商品级预览");
    expect(html).toContain("B0SAN00001");
    expect(html).toContain("B0SAN00002");
    expect(html).not.toContain("provisionalNumericScore");
    expect(html).not.toContain("extraRaw");
  });

  it("renders Category Current records and BSR without Search placement language", () => {
    const html = renderToStaticMarkup(createElement(SellerSpritePreviewResults, {
      data: viewModel("category_current"),
    }));
    expect(html).toContain("类目当前商品");
    expect(html).toContain("Category Current 记录");
    expect(html).toContain("大类 BSR");
    expect(html).toContain("小类 BSR");
    expect(html).not.toContain("搜索外观");
    expect(html).not.toContain("广告位");
    expect(html).not.toContain("自然位");
    expect(html).not.toContain("最佳位置");
  });

  it("filters price bands and signal states without mutating the source products", () => {
    const data = viewModel();
    const source = [...data.products];
    const within = filterAndSortSellerSpritePreviewProducts(data.products, "within", "all", "asin");
    expect(within).toHaveLength(2);
    const missing = filterAndSortSellerSpritePreviewProducts(data.products, "all", "missing", "asin");
    expect(missing.length).toBeLessThanOrEqual(data.products.length);
    expect(data.products).toEqual(source);
  });

  it("sorts resolved values before missing values", () => {
    const products = viewModel().products;
    const withMissing = [
      ...products,
      { ...products[0], asin: "B0MISSING0", price: null },
    ];
    const sorted = filterAndSortSellerSpritePreviewProducts(withMissing, "all", "all", "price");
    expect(sorted.at(-1)?.asin).toBe("B0MISSING0");
  });
});
