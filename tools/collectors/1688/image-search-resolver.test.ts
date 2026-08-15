/**
 * V3.5 — 图搜 Resolver 单测（§63 deterministic fixture / replay）
 *
 * Wrong Upload / Wrong Click fixture 必须 fail：任何 proof 不满足 → 解析结果带 reasonCodes，
 * 由调用方（driver）fail-closed——本测试锁定解析层的判定。
 */
import { describe, expect, it } from "vitest";
import {
  buildResultCardsExtractionExpression,
  buildResultPageClassificationExpression,
  buildSubmitTargetProofExpression,
  buildUploadStateProofExpression,
  buildUploadTargetProofExpression,
  isAllowedImageSearchPageUrl,
  isResultPageUrl,
  isUploadPageUrl,
  parseResultCards,
  parseResultPageClassification,
  parseSubmitTargetProof,
  parseUploadStateProof,
  parseUploadTargetProof,
  validateImageResultCards,
} from "./image-search-resolver";

describe("DOM 表达式可编译（replay 前置）", () => {
  it("全部表达式语法有效（new Function 编译）", () => {
    for (const expression of [
      buildUploadTargetProofExpression(),
      buildSubmitTargetProofExpression(),
      buildUploadStateProofExpression(),
      buildResultPageClassificationExpression(),
      buildResultCardsExtractionExpression(),
    ]) {
      expect(() => new Function(expression)).not.toThrow();
    }
  });
});

describe("Upload Target Proof（Wrong Upload 门禁）", () => {
  const valid = {
    found: true, unique: true, visible: true, enabled: true,
    tagName: "INPUT", accept: "image/*", pageUrlAllowed: true,
    x: 998, y: 109, width: 200, height: 60, reasonCodes: [],
  };

  it("合法 target → 通过 + live 坐标", () => {
    const proof = parseUploadTargetProof(valid);
    expect(proof.found).toBe(true);
    expect(proof.x).toBe(998);
    expect(proof.reasonCodes).toEqual([]);
  });

  it("target 缺失 → fail-closed（upload_target_not_found）", () => {
    const proof = parseUploadTargetProof({ ...valid, found: false, reasonCodes: ["upload_target_not_found"] });
    expect(proof.found).toBe(false);
    expect(proof.reasonCodes).toContain("upload_target_not_found");
  });

  it("重复 target → fail-closed（not_unique）", () => {
    const proof = parseUploadTargetProof({ ...valid, unique: false, reasonCodes: ["upload_target_not_unique"] });
    expect(proof.unique).toBe(false);
  });

  it("错误页面（非 s.1688.com）→ fail-closed", () => {
    const proof = parseUploadTargetProof({ ...valid, pageUrlAllowed: false, reasonCodes: ["page_url_not_allowed"] });
    expect(proof.pageUrlAllowed).toBe(false);
  });

  it("非对象报告 → fail-closed", () => {
    const proof = parseUploadTargetProof(null);
    expect(proof.found).toBe(false);
    expect(proof.reasonCodes).toContain("upload_target_report_invalid");
  });
});

describe("Submit Target Proof（Wrong Click 门禁）", () => {
  const valid = {
    found: true, unique: true, visible: true, enabled: true,
    tagName: "DIV", text: "搜索图片", pageUrlAllowed: true,
    x: 1029, y: 340, width: 120, height: 40, reasonCodes: [],
  };

  it("合法按钮（search-btn class 命中 + 文本'搜索图片'）→ 通过 + live 坐标", () => {
    const proof = parseSubmitTargetProof(valid);
    expect(proof.found).toBe(true);
    expect(proof.text).toBe("搜索图片");
    expect(proof.x).toBe(1029);
  });

  it("按钮缺失 → fail-closed", () => {
    const proof = parseSubmitTargetProof({ ...valid, found: false, reasonCodes: ["submit_target_not_found"] });
    expect(proof.found).toBe(false);
  });

  it("重复按钮 → fail-closed（not_unique）", () => {
    const proof = parseSubmitTargetProof({ ...valid, unique: false, reasonCodes: ["submit_target_not_unique"] });
    expect(proof.unique).toBe(false);
  });

  it("坐标缺失 → 不可点击（driver 会拒绝）", () => {
    const proof = parseSubmitTargetProof({ ...valid, x: null, y: null, reasonCodes: [] });
    expect(proof.x).toBeNull();
  });

  it("非对象报告 → fail-closed", () => {
    const proof = parseSubmitTargetProof("nope");
    expect(proof.found).toBe(false);
    expect(proof.reasonCodes).toContain("submit_target_report_invalid");
  });
});

describe("Upload State Proof（上传结果真实性）", () => {
  it("预览图出现 → confirmed", () => {
    const proof = parseUploadStateProof({
      confirmed: true, previewImageCount: 1, previewImageSrc: "data:image/jpeg;base64,AAAA",
      selectedFileName: null, pageUrl: "https://s.1688.com/", reasonCodes: [],
    });
    expect(proof.confirmed).toBe(true);
  });

  it("无预览图 → fail-closed", () => {
    const proof = parseUploadStateProof({
      confirmed: false, previewImageCount: 0, previewImageSrc: null,
      selectedFileName: null, pageUrl: "https://s.1688.com/", reasonCodes: ["upload_state_not_confirmed"],
    });
    expect(proof.confirmed).toBe(false);
  });
});

describe("Result Page 分类（Fallback Recommendation ≠ Native Result，§38）", () => {
  it("native 结果页（tab=imageSearch + imageId + 无 fallback marker）→ resultsReady", () => {
    const proof = parseResultPageClassification({
      resultsReady: true, isFallbackRecommendation: false, imageIdInUrl: true, resultCount: 8,
      pageUrl: "https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch&imageId=1737808815218637218",
      reasonCodes: [],
    });
    expect(proof.resultsReady).toBe(true);
    expect(proof.isFallbackRecommendation).toBe(false);
  });

  it("fallback（无 imageId / 推荐流标记）→ isFallbackRecommendation", () => {
    const proof = parseResultPageClassification({
      resultsReady: false, isFallbackRecommendation: true, imageIdInUrl: false, resultCount: 0,
      pageUrl: "https://s.1688.com/youhua/offer_search.htm",
      reasonCodes: ["result_tab_missing", "image_id_missing"],
    });
    expect(proof.resultsReady).toBe(false);
    expect(proof.isFallbackRecommendation).toBe(true);
  });
});

describe("结果卡片解析（同卡片实体绑定 + 实体键校验）", () => {
  const validCards = {
    cards: [
      {
        offerId: "917424058724", title: "跨境史努比联名红色房子午餐冷藏便当包",
        priceText: "¥35.9", moqText: "50件起批", supplierName: "白沟新城卓诗箱包厂",
        imageUrl: "https://img.example.test/snoopy.jpg",
        detailUrl: "https://detail.1688.com/offer/917424058724.html", entityBound: true,
      },
      {
        offerId: "832349758315", title: "冰霸杯",
        priceText: "¥6.38", moqText: null, supplierName: null,
        imageUrl: null, detailUrl: "https://detail.1688.com/offer/832349758315.html", entityBound: true,
      },
    ],
  };

  it("合法卡片 → 全部解析 + entityBound", () => {
    const cards = parseResultCards(validCards);
    expect(cards).toHaveLength(2);
    expect(cards[0].offerId).toBe("917424058724");
    expect(cards[0].entityBound).toBe(true);
  });

  it("非法 offerId / 缺 title 卡片 → 丢弃；跨卡片风险卡保留标记（driver 层拒绝）", () => {
    const cards = parseResultCards({
      cards: [
        ...validCards.cards,
        { offerId: "abc", title: "x", entityBound: true },
        { offerId: "12345", title: "", entityBound: true },
        { offerId: "98765432101", title: "ok", entityBound: false },
      ],
    });
    expect(cards).toHaveLength(3);
    // entityBound=false 卡片携带风险标记，driver 的 Wrong Entity 门禁会拒绝整批
    expect(cards.some((card) => card.offerId === "98765432101" && card.entityBound === false)).toBe(true);
  });

  it("空结果 → 校验抛错（IMAGE_RESULTS_EMPTY）", () => {
    expect(() => validateImageResultCards([])).toThrowError("IMAGE_RESULTS_EMPTY");
  });

  it("重复 offerId → 校验抛错", () => {
    expect(() => validateImageResultCards([...parseResultCards(validCards), ...parseResultCards(validCards)]))
      .toThrowError("IMAGE_RESULTS_DUPLICATE_OFFER_ID");
  });

  it("超出上限 → 校验抛错", () => {
    const many = Array.from({ length: 61 }, (_, index) => ({
      offerId: String(10000000000 + index), title: "x", entityBound: true,
      priceText: null, moqText: null, supplierName: null, imageUrl: null, detailUrl: null,
    }));
    expect(() => validateImageResultCards(many)).toThrowError("IMAGE_RESULTS_OVER_LIMIT");
  });
});

describe("URL 判定", () => {
  it("上传页：s.1688.com 任意路径", () => {
    expect(isUploadPageUrl("https://s.1688.com/?t=abc")).toBe(true);
    expect(isUploadPageUrl("https://s.1688.com/youhua/offer_search.htm")).toBe(true);
    expect(isUploadPageUrl("https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch&imageId=1")).toBe(false);
    expect(isUploadPageUrl("http://s.1688.com/")).toBe(false);
  });

  it("结果页：tab=imageSearch", () => {
    expect(isResultPageUrl("https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch&imageId=123")).toBe(true);
    expect(isResultPageUrl("https://s.1688.com/")).toBe(false);
  });

  it("允许域白名单", () => {
    expect(isAllowedImageSearchPageUrl("https://s.1688.com/")).toBe(true);
    expect(isAllowedImageSearchPageUrl("https://air.1688.com/")).toBe(true);
    expect(isAllowedImageSearchPageUrl("https://evil.example.com/")).toBe(false);
    expect(isAllowedImageSearchPageUrl("https://s.1688.com.evil.example.com/")).toBe(false);
  });
});
