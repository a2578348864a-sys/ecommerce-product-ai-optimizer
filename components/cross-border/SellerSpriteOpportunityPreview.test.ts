import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildSellerSpriteOpportunityPreviewViewModel } from "@/lib/sellerSpriteOpportunityPreview";
import { buildSellerSpriteBriefBoundShadowReport } from "@/lib/upstream/sellersprite/briefBoundShadowReport";
import { buildSellerSpriteMarketSnapshot } from "@/lib/upstream/sellersprite/marketSnapshot";
import { precheckSellerSpriteXlsx } from "@/lib/upstream/sellersprite/precheck";
import { createSellerSpriteShadowSelectionBrief } from "@/lib/upstream/sellersprite/shadowBrief";
import { createSellerSpritePreviewTestWorkbook } from "@/tools/upstream/sellersprite-preview/test-fixtures";

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

function viewModel() {
  const capturedAt = "2026-07-27T02:00:00.000Z";
  const precheck = precheckSellerSpriteXlsx(createSellerSpritePreviewTestWorkbook(), {
    capturedAt,
  });
  const snapshot = buildSellerSpriteMarketSnapshot(precheck);
  const brief = createSellerSpriteShadowSelectionBrief({
    marketplace: "amazon.com",
    market: "US",
    currency: "USD",
    query: "storage box",
    category: "Home & Kitchen",
    priceMin: 10,
    priceMax: 100,
    requiredSignals: ["price", "rating", "reviews", "searchRank"],
    optionalSignals: ["estimatedMonthlySales"],
    createdAt: capturedAt,
    briefSource: "component-test",
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
    query: "storage box",
    category: "Home & Kitchen",
    priceMin: "10",
    priceMax: "100",
  };

  it("accepts a valid single XLSX Selection Brief", () => {
    expect(validateSellerSpritePreviewForm(valid)).toEqual({ ok: true, message: null });
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
