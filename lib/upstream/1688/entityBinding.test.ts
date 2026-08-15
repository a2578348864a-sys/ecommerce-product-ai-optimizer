/**
 * V3.5 — Entity Binding 门禁单测（Wrong Entity = 0）
 */
import { describe, expect, it } from "vitest";
import { SourcingAcquisitionError } from "./contracts";
import {
  assertSingleOfferRecord,
  crossValidateCandidateWithDetail,
  parseOfferIdFromUrl,
  validate1688OfferUrl,
} from "./entityBinding";
import type { AcquisitionCandidate, OfferDetail } from "./contracts";

const CAPTURED_AT = "2026-08-15T00:00:00.000Z";

function sampleCandidate(offerId = "930374004918"): AcquisitionCandidate {
  return {
    schema: "acquisition-candidate.v1",
    source: "1688",
    offerId,
    sourceUrl: `https://detail.1688.com/offer/${offerId}.html`,
    capturedAt: CAPTURED_AT,
    acquisitionMethod: "keyword",
    sourceProductRole: "candidate",
    title: "新款不锈钢保温杯",
    images: [],
    displayedPrice: { text: "¥16.5", nature: "displayed_price" },
    priceRange: { min: 16.5, max: 16.5, text: "¥16.5" },
    priceTiers: [],
    displayedMoq: null,
    skuSpecs: [],
    sellerClaims: [],
    platformMetadata: [],
    supplierDisplayName: "永康市希杰工贸有限公司",
    matchState: null,
  };
}

function sampleDetail(offerId = "930374004918"): OfferDetail {
  return {
    offerId,
    sourceUrl: `https://detail.1688.com/offer/${offerId}.html`,
    capturedAt: CAPTURED_AT,
    title: "新款不锈钢保温杯钢盖简约保温杯",
    mainImages: [],
    displayedPrice: { text: "￥21.30", nature: "displayed_price" },
    priceRange: { min: 21.3, max: 21.3, text: "￥21.30" },
    priceTiers: [{ minQty: 1, price: 16.5, text: "1 件起 ¥16.5" }],
    displayedMoq: { text: "1 个", value: 1, nature: "displayed_moq" },
    skuSpecs: [],
    sellerClaims: [],
    platformMetadata: [],
    supplierDisplayName: "永康市希杰工贸有限公司",
  };
}

describe("assertSingleOfferRecord", () => {
  it("对象 + 合法 offerId → 通过", () => {
    expect(() => assertSingleOfferRecord({ offerId: "930374004918", title: "x" }, "ctx")).not.toThrow();
  });

  it("数组（多记录混入）→ fail-closed", () => {
    expect(() => assertSingleOfferRecord([{ offerId: "930374004918" }], "ctx"))
      .toThrowError(SourcingAcquisitionError);
  });

  it("缺 offerId / 非法 offerId → fail-closed", () => {
    expect(() => assertSingleOfferRecord({ title: "x" }, "ctx")).toThrowError(/offerId/);
    expect(() => assertSingleOfferRecord({ offerId: "abc" }, "ctx")).toThrowError(/offerId/);
    expect(() => assertSingleOfferRecord(null, "ctx")).toThrowError(SourcingAcquisitionError);
  });
});

describe("crossValidateCandidateWithDetail", () => {
  it("offerId 一致 → 通过并给出诊断", () => {
    const result = crossValidateCandidateWithDetail(sampleCandidate(), sampleDetail());
    expect(result.ok).toBe(true);
    expect(result.offerIdMatch).toBe(true);
    expect(result.titleMatch).toBe(true); // 包含关系
  });

  it("offerId 不一致 → ENTITY_BINDING_FAILED（硬门禁）", () => {
    expect(() => crossValidateCandidateWithDetail(sampleCandidate("11111111111"), sampleDetail("22222222222")))
      .toThrowError(SourcingAcquisitionError);
  });

  it("搜索候选 vs 详情：即使 title 全不同但 offerId 一致 → 不阻止（仅诊断）", () => {
    const candidate = { ...sampleCandidate(), title: "完全不同的标题" };
    const result = crossValidateCandidateWithDetail(candidate, sampleDetail());
    expect(result.ok).toBe(true);
    expect(result.titleMatch).toBe(false);
  });
});

describe("parseOfferIdFromUrl / validate1688OfferUrl", () => {
  it("detail.1688.com 路径格式 → 解析 offerId", () => {
    expect(validate1688OfferUrl("https://detail.1688.com/offer/930374004918.html"))
      .toEqual({ url: "https://detail.1688.com/offer/930374004918.html", offerId: "930374004918" });
  });

  it("m.1688.com query 格式 → 解析 offerId", () => {
    expect(parseOfferIdFromUrl("https://m.1688.com/offer/930374004918.html")).toBe("930374004918");
    expect(parseOfferIdFromUrl("https://m.1688.com/winport/offer?offerId=930374004918")).toBe("930374004918");
  });

  it("http（非 https）→ 拒绝", () => {
    expect(validate1688OfferUrl("http://detail.1688.com/offer/930374004918.html")).toBeNull();
  });

  it("非 1688 域 → 拒绝（防 SSRF）", () => {
    expect(validate1688OfferUrl("https://evil.example.com/offer/930374004918.html")).toBeNull();
    expect(validate1688OfferUrl("https://detail.1688.com.evil.example.com/offer/930374004918.html")).toBeNull();
  });

  it("无 offerId / 非法 offerId → 拒绝", () => {
    expect(validate1688OfferUrl("https://detail.1688.com/offer/abc.html")).toBeNull();
    expect(validate1688OfferUrl("https://detail.1688.com/")).toBeNull();
  });

  it("带凭据 URL → 拒绝", () => {
    expect(validate1688OfferUrl("https://user:pass@detail.1688.com/offer/930374004918.html")).toBeNull();
  });

  it("超长 URL → 拒绝", () => {
    expect(validate1688OfferUrl(`https://detail.1688.com/offer/930374004918.html?x=${"a".repeat(2100)}`)).toBeNull();
  });

  it("非法输入类型 → 拒绝", () => {
    expect(validate1688OfferUrl("")).toBeNull();
    expect(validate1688OfferUrl("not a url")).toBeNull();
  });
});
