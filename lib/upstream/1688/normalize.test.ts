/**
 * V3.5 — normalize 单测（fail-closed：schema 不认识/必填缺失即拒绝）
 */
import { describe, expect, it } from "vitest";
import { SourcingAcquisitionError } from "./contracts";
import { normalizeCandidateImageUrl, normalizeOfferDetail, normalizeSearchOffers } from "./normalize";
import { SANITIZED_OFFER_RESPONSE, SANITIZED_SEARCH_RESPONSE } from "./fixtures/sanitized.v1";

const CAPTURED_AT = "2026-08-15T00:00:00.000Z";

describe("normalizeSearchOffers", () => {
  it("关键词搜索：完整字段映射 + 平台元数据分类 + 图片拆分", () => {
    const candidates = normalizeSearchOffers(SANITIZED_SEARCH_RESPONSE.offers, {
      method: "keyword",
      query: "保温杯",
      capturedAt: CAPTURED_AT,
    });
    expect(candidates).toHaveLength(3);
    const first = candidates[0];
    expect(first.schema).toBe("acquisition-candidate.v1");
    expect(first.source).toBe("1688");
    expect(first.offerId).toBe("674035283676");
    expect(first.acquisitionMethod).toBe("keyword");
    expect(first.sourceProductRole).toBe("candidate");
    expect(first.matchState).toBeNull();
    expect(first.displayedPrice).toEqual({ text: "¥16", nature: "displayed_price" });
    expect(first.priceRange).toEqual({ min: 16, max: 16, text: "¥16" });
    expect(first.supplierDisplayName).toBe("永康市迎庆杯业有限公司");
    expect(first.images).toEqual([
      "https://img.example.test/a.jpg",
      "https://img.example.test/b.jpg",
      "https://img.example.test/c.jpg",
    ]);
    // 平台元数据（展示级）
    const metadata = Object.fromEntries(first.platformMetadata.map((field) => [field.name, field.value]));
    expect(metadata.verified).toBe("factory");
    expect(metadata.demandOrderCount).toBe("22010");
    expect(metadata.isP4P).toBe("false");
    expect(metadata.location).toBe("浙江 武义县");
    expect(metadata.supplierYears).toBe("11");
    expect(first.priceTiers).toEqual([]);
    expect(first.displayedMoq).toBeNull();
    expect(first.sellerClaims).toEqual([]);
  });

  it("单图逗号字符串与多图保持一致拆分", () => {
    const candidates = normalizeSearchOffers(SANITIZED_SEARCH_RESPONSE.offers, {
      method: "keyword",
      query: "保温杯",
      capturedAt: CAPTURED_AT,
    });
    expect(candidates[1].images).toEqual(["https://img.example.test/d.jpg"]);
  });

  it("P4P 广告位保留平台标记，不做排序或评分", () => {
    const candidates = normalizeSearchOffers(SANITIZED_SEARCH_RESPONSE.offers, {
      method: "keyword",
      query: "保温杯",
      capturedAt: CAPTURED_AT,
    });
    const p4p = candidates.find((candidate) => candidate.offerId === "930374004918");
    expect(p4p?.platformMetadata.some((field) => field.name === "isP4P" && field.value === "true")).toBe(true);
  });

  it("URL 获取：method=url", () => {
    const candidates = normalizeSearchOffers(SANITIZED_SEARCH_RESPONSE.offers, {
      method: "url",
      query: "https://detail.1688.com/offer/930374004918.html",
      capturedAt: CAPTURED_AT,
    });
    expect(candidates[0].acquisitionMethod).toBe("url");
  });

  it("缺 offers 数组 → fail-closed", () => {
    expect(() => normalizeSearchOffers(undefined, { method: "keyword", query: "x", capturedAt: CAPTURED_AT }))
      .toThrowError(SourcingAcquisitionError);
    expect(() => normalizeSearchOffers({}, { method: "keyword", query: "x", capturedAt: CAPTURED_AT }))
      .toThrowError(SourcingAcquisitionError);
  });

  it("offerId 非法 → fail-closed", () => {
    const bad = [{ ...SANITIZED_SEARCH_RESPONSE.offers[0], offerId: "abc" }];
    expect(() => normalizeSearchOffers(bad, { method: "keyword", query: "x", capturedAt: CAPTURED_AT }))
      .toThrowError(/offerId/);
  });

  it("缺 title / url → fail-closed", () => {
    const noTitle = [{ ...SANITIZED_SEARCH_RESPONSE.offers[0], title: "" }];
    expect(() => normalizeSearchOffers(noTitle, { method: "keyword", query: "x", capturedAt: CAPTURED_AT }))
      .toThrowError(SourcingAcquisitionError);
    const noUrl = [{ ...SANITIZED_SEARCH_RESPONSE.offers[0], url: "", detailUrl: "" }];
    expect(() => normalizeSearchOffers(noUrl, { method: "keyword", query: "x", capturedAt: CAPTURED_AT }))
      .toThrowError(SourcingAcquisitionError);
  });

  it("单次候选超出上限（100）→ fail-closed", () => {
    const many = Array.from({ length: 101 }, (_, index) => ({
      ...SANITIZED_SEARCH_RESPONSE.offers[0],
      offerId: `10000000000${index}`.slice(-15),
    }));
    expect(() => normalizeSearchOffers(many, { method: "keyword", query: "x", capturedAt: CAPTURED_AT }))
      .toThrowError(/上限/);
  });
});

describe("normalizeOfferDetail", () => {
  it("详情：价格三语义分离（显示价≠阶梯价）+ MOQ + SKU + 卖家自报", () => {
    const detail = normalizeOfferDetail(SANITIZED_OFFER_RESPONSE, { capturedAt: CAPTURED_AT });
    expect(detail.offerId).toBe("930374004918");
    // displayedPrice=¥21.30（页面显示价）与 priceTiers[0]=16.5（阶梯价）保留差异，不归一化
    expect(detail.displayedPrice).toEqual({ text: "￥21.30", nature: "displayed_price" });
    expect(detail.priceRange).toEqual({ min: 21.3, max: 21.3, text: "￥21.30" });
    expect(detail.priceTiers).toEqual([{ minQty: 1, price: 16.5, text: "1 件起 ¥16.5" }]);
    // displayedMOQ 语义，不做归一化
    expect(detail.displayedMoq).toEqual({ text: "1 个", value: 1, nature: "displayed_moq" });
    // SKU：multiPrice 为阶梯实价但仍是展示信息
    expect(detail.skuSpecs).toHaveLength(2);
    expect(detail.skuSpecs[0].skuId).toBe("5980020430300");
    expect(detail.skuSpecs[0].multiPrice).toBe(16.5);
    expect(detail.skuSpecs[0].price).toBe(21.3);
    // attributes → seller_claim（≠ 事实）
    expect(detail.sellerClaims.length).toBeGreaterThanOrEqual(8);
    expect(detail.sellerClaims[0]).toEqual({ name: "内胆材质", value: "304不锈钢", evidenceClass: "seller_claim" });
    expect(detail.sellerClaims.every((claim) => claim.evidenceClass === "seller_claim")).toBe(true);
    // 平台元数据
    const metadata = Object.fromEntries(detail.platformMetadata.map((field) => [field.name, field.value]));
    expect(metadata.saledCount).toBe("3081");
    expect(metadata.categoryId).toBe("1043766");
    expect(metadata.unitName).toBe("个");
    expect(metadata.options).toContain("颜色");
    expect(metadata.options).toContain("白色【一杯双饮+手提绳】");
    // 供应商仅展示名
    expect(detail.supplierDisplayName).toBe("永康市希杰工贸有限公司");
    // 图片
    expect(detail.mainImages.length).toBeGreaterThanOrEqual(2);
  });

  it("敏感字段丢弃：receiveAddress / userId / loginId / memberId 绝不出现在输出", () => {
    const detail = normalizeOfferDetail(SANITIZED_OFFER_RESPONSE, { capturedAt: CAPTURED_AT });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("receiveAddress");
    expect(serialized).not.toContain("某省某市");
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("loginId");
    expect(serialized).not.toContain("memberId");
    expect(serialized).not.toContain("0000000000000");
  });

  it("缺 title → fail-closed", () => {
    expect(() => normalizeOfferDetail({ ...SANITIZED_OFFER_RESPONSE, title: "" }, { capturedAt: CAPTURED_AT }))
      .toThrowError(SourcingAcquisitionError);
  });

  it("offerId 非法 → fail-closed", () => {
    expect(() => normalizeOfferDetail({ ...SANITIZED_OFFER_RESPONSE, offerId: "x" }, { capturedAt: CAPTURED_AT }))
      .toThrowError(SourcingAcquisitionError);
  });

  it("非对象输入 → fail-closed", () => {
    expect(() => normalizeOfferDetail(null, { capturedAt: CAPTURED_AT })).toThrowError(SourcingAcquisitionError);
    expect(() => normalizeOfferDetail([SANITIZED_OFFER_RESPONSE], { capturedAt: CAPTURED_AT })).toThrowError(SourcingAcquisitionError);
  });

  it("MOQ 缺失 → displayedMoq=null（unknown 而非推断）", () => {
    const { minOrderQty: _drop, ...withoutMoq } = SANITIZED_OFFER_RESPONSE;
    const detail = normalizeOfferDetail(withoutMoq, { capturedAt: CAPTURED_AT });
    expect(detail.displayedMoq).toBeNull();
  });

  it("价格阶梯超出上限 → fail-closed", () => {
    const manyTiers = {
      ...SANITIZED_OFFER_RESPONSE,
      priceTiers: Array.from({ length: 31 }, (_, index) => ({ minQty: index + 1, price: 10 })),
    };
    expect(() => normalizeOfferDetail(manyTiers, { capturedAt: CAPTURED_AT })).toThrowError(/上限/);
  });
});

// ── V3 Final R14（§5）：候选商品图 URL 规范化（唯一 display 入口） ──

describe("normalizeCandidateImageUrl", () => {
  it("完整 https URL 保留", () => {
    expect(normalizeCandidateImageUrl("https://cbu01.alicdn.com/img/ibank/x.jpg")).toBe("https://cbu01.alicdn.com/img/ibank/x.jpg");
  });

  it("protocol-relative //host → https://host", () => {
    expect(normalizeCandidateImageUrl("//cbu01.alicdn.com/img/ibank/x.jpg")).toBe("https://cbu01.alicdn.com/img/ibank/x.jpg");
  });

  it("相对路径（无可证 base）→ null（禁止猜路径）", () => {
    expect(normalizeCandidateImageUrl("/img/ibank/x.jpg")).toBeNull();
    expect(normalizeCandidateImageUrl("img/ibank/x.jpg")).toBeNull();
  });

  it("http / data: / javascript: / 空白 → null", () => {
    expect(normalizeCandidateImageUrl("http://cbu01.alicdn.com/x.jpg")).toBeNull();
    expect(normalizeCandidateImageUrl("data:image/png;base64,abc")).toBeNull();
    expect(normalizeCandidateImageUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeCandidateImageUrl("   ")).toBeNull();
    expect(normalizeCandidateImageUrl(null)).toBeNull();
  });

  it("keyword 搜索候选 images 经 normalize 后为完整 https（含 protocol-relative 兜底）", () => {
    const offers = SANITIZED_SEARCH_RESPONSE.offers.map((offer, index) => ({
      ...offer,
      image: index === 0 ? "https://cbu01.alicdn.com/img/ibank/a.jpg" : "//cbu01.alicdn.com/img/ibank/b.jpg",
    }));
    const result = normalizeSearchOffers(offers, {
      method: "keyword",
      query: "保温杯",
      capturedAt: "2026-08-17T00:00:00.000Z",
    });
    expect(result[0].images[0]).toBe("https://cbu01.alicdn.com/img/ibank/a.jpg");
    expect(result[1].images[0]).toBe("https://cbu01.alicdn.com/img/ibank/b.jpg");
  });
});
