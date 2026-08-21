
import { beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  SUPPLIER_ADAPTER_ERROR_CODES,
  SUPPLIER_FIELD_WHITELIST,
  __resetSupplierAdapterCacheForTest,
  buildToolResult,
  buildVariants,
  classifyClaimType,
  deriveVariantKey,
  mapPageStatusToError,
  normalizeDetailToExtraction,
  normalizeSearchToExtraction,
  parseTargetEntity,
  resolveRequestedFields,
  run1688Adapter,
  validateEntity,
  validateToolResult,
  type Supplier1688AdapterOptions,
  type Supplier1688Extraction,
  type Supplier1688LiveExecutor,
  type SupplierResearchData,
} from "@/lib/v4/adapters/1688";
import { validateFactConfirmation } from "@/lib/v4/factStore";
import { SANITIZED_OFFER_RESPONSE, SANITIZED_SEARCH_RESPONSE } from "@/lib/upstream/1688/fixtures/sanitized.v1";
import type { ToolCallEnvelope } from "@/lib/v4/tools/envelope";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures", "1688-recorded");

const WHITE_SPEC = "白色【一杯双饮+手提绳】>600ml【定制联系客服】";
const GREEN_SPEC = "绿色【一杯双饮+手提绳】>600ml【定制联系客服】";
const WHITE_KEY = deriveVariantKey(WHITE_SPEC);
const GREEN_KEY = deriveVariantKey(GREEN_SPEC);

function makeEnvelope(overrides: Partial<ToolCallEnvelope> = {}): ToolCallEnvelope {
  return {
    toolCallId: "call-1",
    runId: "run-1",
    questionId: "q-1",
    toolName: "supplier_1688",
    toolVersion: "1688-supplier.v1",
    targetEntity: "930374004918",
    marketplace: "1688",
    allowedDomains: ["detail.1688.com", "m.1688.com", "www.1688.com", "1688.com"],
    requestedFields: ["offerIdentity", "url", "shop", "displayedPrice", "priceRange", "priceTiers", "moq", "shippingLocation", "sellerClaims", "images", "questions"],
    maxSteps: 5,
    timeoutMs: 60000,
    budget: { maxCost: 1, currency: "USD", maxBrowserSteps: 10 },
    inputHash: "detail-ok-hash",
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

function baseDetail() {
  return {
    offerId: "930374004918",
    sourceUrl: "https://detail.1688.com/offer/930374004918.html",
    capturedAt: "2026-08-21T12:00:00.000Z",
    title: "新款不锈钢保温杯钢盖简约保温杯女生高颜值便携手提杯真空保温杯",
    mainImages: ["https://img.example.test/main.jpg", "https://img.example.test/sub1.jpg"],
    displayedPrice: { text: "￥21.30", nature: "displayed_price" as const },
    priceRange: { min: 21.3, max: 21.3, text: "￥21.30" },
    priceTiers: [{ minQty: 1, price: 16.5, text: "1 件起 ¥16.5" }],
    displayedMoq: { text: "1 个", value: 1, nature: "displayed_moq" as const },
    skuSpecs: [
      { skuId: "5980020430300", specs: GREEN_SPEC, price: 21.3, multiPrice: 16.5, stock: 5293 },
      { skuId: "5980020430298", specs: WHITE_SPEC, price: 21.3, multiPrice: 16.5, stock: 3914 },
    ],
    sellerClaims: [
      { name: "内胆材质", value: "304不锈钢", evidenceClass: "seller_claim" as const },
      { name: "材质", value: "内304外201", evidenceClass: "seller_claim" as const },
      { name: "功能", value: "加厚,便携,真空,保温,可定制,防摔", evidenceClass: "seller_claim" as const },
    ],
    platformMetadata: [
      { name: "saledCount", value: "3081", evidenceClass: "platform_metadata" as const },
      { name: "options", value: "颜色:白色【一杯双饮+手提绳】,粉色【一杯双饮+手提绳】", evidenceClass: "platform_metadata" as const },
    ],
    supplierDisplayName: "永康市希杰工贸有限公司",
  };
}

function makeDetailExtraction(overrides: Partial<Supplier1688Extraction> = {}): Supplier1688Extraction {
  return {
    operation: "detail",
    observedEntity: "930374004918",
    context: {
      host: "detail.1688.com",
      pageUrl: "https://detail.1688.com/offer/930374004918.html",
      pageStatus: "ok",
      selectedVariantKey: null,
      shippingLocation: { province: "浙江", city: "金华市", text: "浙江 金华市" },
      capturedAt: "2026-08-21T12:00:00.000Z",
    },
    candidates: [],
    detail: baseDetail(),
    rawCardCount: 1,
    rawArtifactSample: null,
    cost: { usedBrowserSteps: 1, usedCost: 0.05, currency: "USD" },
    ...overrides,
  };
}

describe("pure helpers", () => {
  it("parseTargetEntity distinguishes offerId / offerId#variant / keyword", () => {
    expect(parseTargetEntity("930374004918")).toEqual({ offerId: "930374004918", variantKey: null, keyword: null });
    expect(parseTargetEntity("930374004918#sk-1234567890abcdef")).toEqual({ offerId: "930374004918", variantKey: "sk-1234567890abcdef", keyword: null });
    expect(parseTargetEntity("保温杯")).toEqual({ offerId: null, variantKey: null, keyword: "保温杯" });
  });

  it("deriveVariantKey is a stable, order-independent fingerprint of the spec combination", () => {
    expect(deriveVariantKey(WHITE_SPEC)).toBe(WHITE_KEY);
    expect(deriveVariantKey(WHITE_SPEC)).toBe(deriveVariantKey("600ml【定制联系客服】>白色【一杯双饮+手提绳】"));
    expect(WHITE_KEY).not.toBe(GREEN_KEY);
    expect(deriveVariantKey(null)).toBe("unspecified");
    expect(deriveVariantKey("")).toBe("unspecified");
    expect(deriveVariantKey("   ")).toBe("unspecified");
  });

  it("classifyClaimType maps 304/材质 to material, others to their domain", () => {
    expect(classifyClaimType("内胆材质", "304不锈钢")).toBe("material");
    expect(classifyClaimType("材质等级", "SUS304")).toBe("material");
    expect(classifyClaimType("容量", "600ml")).toBe("size");
    expect(classifyClaimType("颜色", "白色")).toBe("color");
    expect(classifyClaimType("功能", "保温")).toBe("feature");
    expect(classifyClaimType("加工定制", "是")).toBe("restriction");
    expect(classifyClaimType("交期", "7天")).toBe("lead_time");
    expect(classifyClaimType("备注", "任意")).toBe("other");
  });

  it("buildVariants yields a stable variant per skuSpec, unspecified for no-spec offer", () => {
    const variants = buildVariants(makeDetailExtraction().detail);
    expect(variants).toHaveLength(2);
    expect(variants[0].variantKey).toBe(GREEN_KEY);
    expect(variants[1].variantKey).toBe(WHITE_KEY);
    expect(buildVariants({ ...makeDetailExtraction().detail!, skuSpecs: [] })).toEqual([{ variantKey: "unspecified", skuId: "unspecified", specs: "", price: null, multiPrice: null, stock: null }]);
  });

  it("resolveRequestedFields keeps only whitelist fields", () => {
    const { allowed, rejected } = resolveRequestedFields(makeEnvelope({ requestedFields: ["offerIdentity", "moq", "secretField"] }));
    expect(allowed.has("offerIdentity")).toBe(true);
    expect(allowed.has("moq")).toBe(true);
    expect(rejected).toEqual(["secretField"]);
  });

  it("mapPageStatusToError maps mandatory auth/entity codes", () => {
    expect(mapPageStatusToError("login_wall")?.code).toBe("AUTH_REQUIRED");
    expect(mapPageStatusToError("captcha")?.code).toBe("CAPTCHA_OR_BOT_CHECK");
    expect(mapPageStatusToError("unknown_page")?.code).toBe("DOM_CHANGED");
    expect(mapPageStatusToError("error_page")?.code).toBe("RATE_LIMITED");
    expect(mapPageStatusToError("loading")?.code).toBe("TIMEOUT");
    expect(mapPageStatusToError("ok")).toBeNull();
  });

  it("exports all 13 project error codes", () => {
    expect(SUPPLIER_ADAPTER_ERROR_CODES).toContain("WRONG_ENTITY");
    expect(SUPPLIER_ADAPTER_ERROR_CODES).toContain("AUTH_REQUIRED");
    expect(SUPPLIER_ADAPTER_ERROR_CODES).toContain("CAPTCHA_OR_BOT_CHECK");
    expect(SUPPLIER_ADAPTER_ERROR_CODES).toHaveLength(13);
  });
});

describe("normalize reuse (upstream/1688/normalize)", () => {
  const CAPTURED_AT = "2026-08-21T12:00:00.000Z";

  it("normalizeSearchToExtraction reuses upstream normalize (fail-closed) -> candidates", () => {
    const extraction = normalizeSearchToExtraction(SANITIZED_SEARCH_RESPONSE.offers, {
      method: "keyword",
      query: "保温杯",
      capturedAt: CAPTURED_AT,
      host: "detail.1688.com",
      pageUrl: "https://s.1688.com/selloffer/offer_search.html?keywords=保温杯",
      pageStatus: "ok",
    });
    expect(extraction.operation).toBe("search");
    expect(extraction.observedEntity).toBe("保温杯");
    expect(extraction.candidates).toHaveLength(3);
    expect(extraction.candidates[0].offerId).toBe("674035283676");
    expect(extraction.candidates[0].displayedPrice).toEqual({ text: "¥16", nature: "displayed_price" });
  });

  it("normalizeDetailToExtraction reuses upstream normalize -> detail with 304 claim and price gradient", () => {
    const extraction = normalizeDetailToExtraction(SANITIZED_OFFER_RESPONSE, {
      capturedAt: CAPTURED_AT,
      host: "detail.1688.com",
      pageUrl: "https://detail.1688.com/offer/930374004918.html",
      pageStatus: "ok",
      shippingLocation: { province: "浙江", city: "金华市", text: "浙江 金华市" },
    });
    expect(extraction.operation).toBe("detail");
    expect(extraction.detail?.offerId).toBe("930374004918");
    // 价格梯度保留（displayed ¥21.30 vs tier ¥16.5）
    expect(extraction.detail?.displayedPrice).toEqual({ text: "￥21.30", nature: "displayed_price" });
    expect(extraction.detail?.priceTiers[0]).toEqual({ minQty: 1, price: 16.5, text: "1 件起 ¥16.5" });
    expect(extraction.detail?.sellerClaims.some((c) => c.value.includes("304"))).toBe(true);
    expect(extraction.context.shippingLocation?.text).toBe("浙江 金华市");
  });

  it("normalizeDetailToExtraction fails closed on invalid offer (null)", () => {
    expect(() => normalizeDetailToExtraction(null, { capturedAt: CAPTURED_AT, host: "detail.1688.com", pageUrl: "x", pageStatus: "ok" })).toThrow();
  });
});

describe("validateEntity", () => {
  it("rejects non-allowed host", () => {
    const err = validateEntity(makeEnvelope(), makeDetailExtraction({ context: { ...makeDetailExtraction().context, host: "evil.com" } }));
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("host_not_allowed");
  });

  it("rejects offerId mismatch on detail (WRONG_ENTITY)", () => {
    const err = validateEntity(makeEnvelope({ targetEntity: "930374004918" }), makeDetailExtraction({ detail: { ...baseDetail(), offerId: "99999999999" } }));
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("offerId_mismatch");
  });

  it("accepts matching offerId (variant not required)", () => {
    expect(validateEntity(makeEnvelope({ targetEntity: "930374004918" }), makeDetailExtraction())).toBeNull();
  });

  it("rejects variant mismatch (expected variant not present)", () => {
    const err = validateEntity(makeEnvelope({ targetEntity: "930374004918#sk-deadbeef12345678" }), makeDetailExtraction());
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("variant_mismatch");
  });

  it("accepts a matching variant via envelope targetEntity", () => {
    const err = validateEntity(makeEnvelope({ targetEntity: "930374004918#" + WHITE_KEY }), makeDetailExtraction());
    expect(err).toBeNull();
  });

  it("rejects variant mismatch via context.selectedVariantKey", () => {
    const err = validateEntity(makeEnvelope({ targetEntity: "930374004918" }), makeDetailExtraction({ context: { ...makeDetailExtraction().context, selectedVariantKey: "sk-deadbeef12345678" } }));
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("variant_mismatch");
  });

  it("accepts a matching variant via context.selectedVariantKey", () => {
    const err = validateEntity(makeEnvelope({ targetEntity: "930374004918" }), makeDetailExtraction({ context: { ...makeDetailExtraction().context, selectedVariantKey: WHITE_KEY } }));
    expect(err).toBeNull();
  });

  it("rejects keyword mismatch on search", () => {
    const err = validateEntity(makeEnvelope({ targetEntity: "跑步鞋" }), makeDetailExtraction({ operation: "search", observedEntity: "保温杯", candidates: [], detail: null }));
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("keyword_mismatch");
  });
});

describe("buildToolResult — ok path and boundaries", () => {
  it("produces a valid envelope with ok status and continue", () => {
    const result = buildToolResult(makeEnvelope({ targetEntity: "930374004918" }), makeDetailExtraction());
    expect(validateToolResult(result).ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
    expect(result.errors).toEqual([]);
    const data = result.data as SupplierResearchData;
    expect(data.schemaVersion).toBe("1688-supplier-research.v1");
    expect(data.operation).toBe("detail");
    expect(data.offerIdentity).toBe("930374004918");
    expect(data.selectedOffer).not.toBeNull();
    expect(data.selectedOffer!.variants).toHaveLength(2);
  });

  it("preserves price gradient / tier prices — NOT normalized to a single unit price", () => {
    const result = buildToolResult(makeEnvelope({ targetEntity: "930374004918" }), makeDetailExtraction());
    const data = result.data as SupplierResearchData;
    expect(data.selectedOffer!.displayedPrice).toEqual({ text: "￥21.30", nature: "displayed_price" });
    expect(data.selectedOffer!.priceRange).toEqual({ min: 21.3, max: 21.3, text: "￥21.30" });
    expect(data.selectedOffer!.priceTiers).toEqual([{ minQty: 1, price: 16.5, text: "1 件起 ¥16.5" }]);
    // 不归一：显示价（21.30）与阶梯价（16.5）保留差异，不自动取最低单价
    expect(data.selectedOffer!.displayedPrice!.text).not.toBe("16.5");
    expect(data.priceTiers).toEqual([{ minQty: 1, price: 16.5, text: "1 件起 ¥16.5" }]);
    expect(result.warnings.some((w) => w.code === "PRICE_TIER_NOT_NORMALIZED")).toBe(true);
  });

  it("page 304 promo is a SupplierClaim (seller_claim), NOT a confirmed fact", () => {
    const result = buildToolResult(makeEnvelope({ targetEntity: "930374004918" }), makeDetailExtraction());
    const data = result.data as SupplierResearchData;
    const claims = data.supplierClaims;
    const material = claims.filter((c) => c.claimType === "material");
    expect(material.length).toBeGreaterThan(0);
    for (const c of material) {
      expect(c.evidenceClass).toBe("seller_claim");
    }
    // 304 只在 claim，不产生任何 confirmed 语义
    expect(claims.every((c) => c.evidenceClass === "seller_claim")).toBe(true);
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/"confirmed"/);
    expect(json).not.toMatch(/"isConfirmed"/);
    expect(json).not.toMatch(/"status"s*:s*"confirmed"/);
    // 待询问题包含材质等级确认
    expect(data.questions.some((q) => q.reason === "material_grade_unconfirmed")).toBe(true);
    expect(result.warnings.some((w) => w.code === "MATERIAL_GRADE_IS_CLAIM")).toBe(true);
  });

  it("does not emit evidence on WRONG_ENTITY (data null)", () => {
    const result = buildToolResult(makeEnvelope({ targetEntity: "930374004918#sk-deadbeef12345678" }), makeDetailExtraction());
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("stop");
    expect(result.errors[0].code).toBe("WRONG_ENTITY");
    expect(result.data).toBeNull();
  });

  it("maps login_wall and captcha to waiting_auth", () => {
    const login = buildToolResult(makeEnvelope({ targetEntity: "930374004918" }), makeDetailExtraction({ context: { ...makeDetailExtraction().context, pageStatus: "login_wall" } }));
    expect(login.status).toBe("waiting_auth");
    expect(login.nextAction).toBe("wait_human");
    expect(login.errors[0].code).toBe("AUTH_REQUIRED");
    const captcha = buildToolResult(makeEnvelope({ targetEntity: "930374004918" }), makeDetailExtraction({ context: { ...makeDetailExtraction().context, pageStatus: "captcha" } }));
    expect(captcha.status).toBe("waiting_auth");
    expect(captcha.errors[0].code).toBe("CAPTCHA_OR_BOT_CHECK");
  });

  it("BUDGET_EXCEEDED when cost/steps exceed budget", () => {
    const result = buildToolResult(makeEnvelope({ targetEntity: "930374004918", budget: { maxCost: 1, currency: "USD", maxBrowserSteps: 1 } }), makeDetailExtraction({ cost: { usedBrowserSteps: 5, usedCost: 0.05, currency: "USD" } }));
    expect(result.status).toBe("budget_exceeded");
    expect(result.nextAction).toBe("wait_human");
    expect(result.errors[0].code).toBe("BUDGET_EXCEEDED");
  });
});

describe("run1688Adapter — recorded replay", () => {
  beforeEach(() => __resetSupplierAdapterCacheForTest());

  it("replays a search fixture -> ok with supplier candidates", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "保温杯", inputHash: "search-ok-hash", requestedFields: ["offerIdentity", "url", "shop", "displayedPrice", "shippingLocation"] }), { fixturesDir });
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
    const data = result.data as SupplierResearchData;
    expect(data.operation).toBe("search");
    expect(data.supplierCandidates).toHaveLength(2);
    expect(data.supplierCandidates[0].offerIdentity).toBe("674035283676");
    expect(data.supplierCandidates[1].offerIdentity).toBe("930374004918");
    expect(validateToolResult(result).ok).toBe(true);
  });

  it("replays a detail fixture -> ok with variants, claims, questions", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918", inputHash: "detail-ok-hash" }), { fixturesDir });
    expect(result.status).toBe("ok");
    const data = result.data as SupplierResearchData;
    expect(data.offerIdentity).toBe("930374004918");
    expect(data.selectedOffer).not.toBeNull();
    expect(data.selectedOffer!.variants).toHaveLength(2);
    expect(data.supplierClaims.length).toBeGreaterThan(0);
    expect(data.questions.length).toBeGreaterThan(0);
    expect(data.shippingLocation?.text).toBe("浙江 金华市");
  });

  it("returns no_results when no fixture matches", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918", inputHash: "does-not-exist" }), { fixturesDir });
    expect(result.status).toBe("no_results");
    expect(result.nextAction).toBe("revise_plan");
    expect(result.warnings.some((w) => w.code === "FIXTURE_NOT_FOUND")).toBe(true);
  });

  it("WRONG_ENTITY on offer identity mismatch (observed != target)", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918", inputHash: "detail-wrong-entity-hash" }), { fixturesDir });
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("stop");
    expect(result.errors[0].code).toBe("WRONG_ENTITY");
    expect(result.observedEntity).toBe("99999999999");
    expect(result.data).toBeNull();
  });

  it("WRONG_ENTITY on variant mismatch (preview-selected variant not in detail)", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918", inputHash: "detail-variant-mismatch-hash" }), { fixturesDir });
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("stop");
    expect(result.errors[0].code).toBe("WRONG_ENTITY");
    expect(result.errors[0].safeMessage).toContain("variant_mismatch");
    expect(result.data).toBeNull();
  });

  it("login_wall -> waiting_auth (never bypassed)", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918", inputHash: "login-wall-hash" }), { fixturesDir });
    expect(result.status).toBe("waiting_auth");
    expect(result.nextAction).toBe("wait_human");
    expect(result.errors[0].code).toBe("AUTH_REQUIRED");
  });

  it("captcha -> waiting_auth (never bypassed)", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918", inputHash: "captcha-hash" }), { fixturesDir });
    expect(result.status).toBe("waiting_auth");
    expect(result.nextAction).toBe("wait_human");
    expect(result.errors[0].code).toBe("CAPTCHA_OR_BOT_CHECK");
  });

  it("moq unknown -> needs_confirmation, not a confirmed value", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918", inputHash: "detail-moq-unknown-hash" }), { fixturesDir });
    expect(result.status).toBe("ok");
    const data = result.data as SupplierResearchData;
    expect(data.moqNature).toBe("needs_confirmation");
    expect(result.warnings.some((w) => w.code === "MOQ_NEEDS_CONFIRMATION")).toBe(true);
  });
});

describe("run1688Adapter — injection safety", () => {
  beforeEach(() => __resetSupplierAdapterCacheForTest());

  it("injection text is captured as data, never as instructions/plan/permission", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918", inputHash: "injection-hash" }), { fixturesDir });
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
    expect(result.errors).toEqual([]);
    const data = result.data as SupplierResearchData;
    expect(data).not.toHaveProperty("instructions");
    expect(data).not.toHaveProperty("plan");
    expect(data).not.toHaveProperty("permission");
    expect(data).not.toHaveProperty("stopConditions");
    // 注入文本只作为结构化字段值出现
    expect(data.selectedOffer!.title).toContain("Ignore all previous instructions");
    expect(data.supplierClaims.some((c) => c.value.includes("Ignore all previous instructions"))).toBe(true);
    expect(result.rawArtifactRefs.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.code === "INJECTION_TEXT_CAPTURED_AS_DATA")).toBe(true);
  });
});

describe("run1688Adapter — idempotency", () => {
  beforeEach(() => __resetSupplierAdapterCacheForTest());

  it("same idempotencyKey + inputHash returns cached result without re-running live executor", async () => {
    let calls = 0;
    const executor: Supplier1688LiveExecutor = {
      async run() {
        calls += 1;
        return makeDetailExtraction();
      },
    };
    const opts: Supplier1688AdapterOptions = { mode: "live", liveEnabled: true, liveExecutor: executor };
    const envelope = makeEnvelope({ idempotencyKey: "idem-fixed", inputHash: "hash-fixed", targetEntity: "930374004918" });
    const r1 = await run1688Adapter(envelope, opts);
    const r2 = await run1688Adapter(envelope, opts);
    expect(r1.status).toBe("ok");
    expect(r2.status).toBe("ok");
    expect(r1).toEqual(r2);
    expect(calls).toBe(1);
  });
});

describe("run1688Adapter — live mode gate", () => {
  beforeEach(() => __resetSupplierAdapterCacheForTest());

  it("live mode disabled by server switch (default off)", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918" }), { mode: "live", liveEnabled: false });
    expect(result.status).toBe("stopped_error");
    expect(result.errors[0].code).toBe("PERMISSION_DENIED");
    expect(result.nextAction).toBe("stop");
    expect(result.warnings.some((w) => w.code === "LIVE_DISABLED")).toBe(true);
  });

  it("live mode with injected executor produces ok result", async () => {
    const executor: Supplier1688LiveExecutor = { async run() { return makeDetailExtraction(); } };
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918" }), { mode: "live", liveEnabled: true, liveExecutor: executor });
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
  });

  it("live executor error maps to waiting_auth for auth/bot errors", async () => {
    const executor: Supplier1688LiveExecutor = { async run() { throw new Error("登录墙 login wall"); } };
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918" }), { mode: "live", liveEnabled: true, liveExecutor: executor });
    expect(result.status).toBe("waiting_auth");
    expect(result.nextAction).toBe("wait_human");
    expect(result.errors[0].code).toBe("AUTH_REQUIRED");
  });
});

describe("P3-C review — claim pollution blocked by Fact validator", () => {
  beforeEach(() => __resetSupplierAdapterCacheForTest());

  it("adapter 304 claim cannot auto-promote to confirmed fact (no confirmationMethod)", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918", inputHash: "detail-claim-304-hash" }), { fixturesDir });
    expect(result.status).toBe("ok");
    const data = result.data as SupplierResearchData;
    const claim = data.supplierClaims.find((c) => c.claimType === "material" && c.value.includes("304"));
    expect(claim).toBeDefined();
    expect(claim!.evidenceClass).toBe("seller_claim");
    // 直接用 adapter 输出的 claim 试图晋级 → validator 阻断（无 confirmationMethod）
    const r = validateFactConfirmation({
      runId: "run-1",
      candidateId: "cand-1",
      offerIdentity: claim!.offerIdentity,
      variantKey: claim!.variantKey ?? "unspecified",
      field: claim!.field,
      value: claim!.value,
      status: "confirmed",
      claimRefs: [claim!.claimId],
      actor: "owner",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("auto_promotion_blocked");
  });

  it("page 304 claim is never surfaced as confirmed semantics anywhere in output", async () => {
    const result = await run1688Adapter(makeEnvelope({ targetEntity: "930374004918", inputHash: "detail-claim-304-hash" }), { fixturesDir });
    const json = JSON.stringify(result.data);
    expect(json).toContain("304");
    expect(json).not.toMatch(/"confirmed"/);
    expect(json).not.toMatch(/"status"s*:s*"confirmed"/);
  });
});

describe("P3-D — variant matrix identity", () => {
  beforeEach(() => __resetSupplierAdapterCacheForTest());

  it("different offer / different variant selections yield correct distinct identities", async () => {
    // Offer 930374004918 variant WHITE vs GREEN -> distinct variantKey
    const whiteEnvelope = makeEnvelope({ targetEntity: "930374004918#" + WHITE_KEY, inputHash: "detail-ok-hash" });
    const greenEnvelope = makeEnvelope({ targetEntity: "930374004918#" + GREEN_KEY, inputHash: "detail-ok-hash" });
    const white = await run1688Adapter(whiteEnvelope, { fixturesDir });
    const green = await run1688Adapter(greenEnvelope, { fixturesDir });
    expect(white.status).toBe("ok");
    expect(green.status).toBe("ok");
    const wd = white.data as SupplierResearchData;
    const gd = green.data as SupplierResearchData;
    expect(wd.selectedOffer!.variants.map((v) => v.variantKey)).toContain(WHITE_KEY);
    expect(gd.selectedOffer!.variants.map((v) => v.variantKey)).toContain(GREEN_KEY);
    expect(WHITE_KEY).not.toBe(GREEN_KEY);
    // 不同 offer 在同一 search 结果中具有不同 offerIdentity
    const otherOffer = await run1688Adapter(makeEnvelope({ targetEntity: "保温杯", inputHash: "search-ok-hash" }), { fixturesDir });
    const od = otherOffer.data as SupplierResearchData;
    expect(od.supplierCandidates.some((c) => c.offerIdentity === "674035283676")).toBe(true);
    expect(od.supplierCandidates.some((c) => c.offerIdentity === "930374004918")).toBe(true);
  });

  it("same offer+same variant -> deterministic variantKey across fixtures (stability)", async () => {
    const a = deriveVariantKey(WHITE_SPEC);
    const b = deriveVariantKey(WHITE_SPEC);
    expect(a).toBe(b);
    expect(a).toMatch(/^sk-[0-9a-f]{16}$/);
  });
});

describe("contract", () => {
  it("field whitelist matches the frozen 1688 Supplier Tool fields", () => {
    expect([...SUPPLIER_FIELD_WHITELIST]).toEqual([
      "offerIdentity", "url", "shop", "displayedPrice", "priceRange", "priceTiers", "moq", "shippingLocation", "sellerClaims", "images", "questions",
    ]);
  });
});
