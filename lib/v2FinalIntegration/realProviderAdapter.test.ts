import { describe, expect, it, vi } from "vitest";
import { createRealListingProvider, resolveListingProviderMode, realListingProviderEnabled } from "@/lib/listingHandoff/realListingProvider";
import { createRealImageProvider, resolveImageProviderMode, realImageProviderEnabled, REAL_IMAGE_PROVIDER_CAPABILITY } from "@/lib/imageHandoff/realImageProvider";
import { setRealAiListingClientForTests } from "@/lib/server/aiListingGenerator";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { ImageGenerationInput } from "@/lib/imageHandoff/imageGenerationInput";

const listingInput: ListingGenerationInput = {
  schema: "listing-generation-input.v1",
  source: { handoffRevision: 1, researchRevision: 1 },
  productFacts: [{ field: "brand", label: "品牌", value: "TestBrand" }],
  stableSourceFacts: [],
  creativeReferences: ["适合户外风格"],
  creativePreferences: { targetMarket: "US", tone: "professional" },
  prohibitedClaims: ["Do not make absolute claims."],
  unknowns: [],
  humanReviewRequired: true,
  researchMode: "market_research_only",
  promotionEligible: false,
};

const imageInput: ImageGenerationInput = {
  schema: "image-generation-input.v1",
  mode: "composition_concept",
  source: { handoffRevision: 1, researchRevision: 1 },
  targetProduct: { displayName: "TestBrand Bottle", brand: "TestBrand", productType: "Water Bottle", seriesOrModel: null, capacity: null },
  productFacts: [{ field: "brand", label: "品牌", value: "TestBrand" }],
  approvedVisualReferences: [],
  compositionReferences: ["适合户外风格"],
  creativePreferences: { targetMarket: "US", imageStyle: "minimalist" },
  prohibitedVisualClaims: [],
  unknowns: [],
  humanReviewRequired: true,
  researchMode: "market_research_only",
  promotionEligible: false,
};

describe("V2-FI-10/11 真实 Listing Provider Adapter", () => {
  it("18. 真实返回合法 JSON → 通过", async () => {
    setRealAiListingClientForTests(async () => ({
      version: 1,
      model: "deepseek-chat",
      source: "real_ai_draft",
      generatedAt: "2026-08-05T00:00:00.000Z",
      humanReviewRequired: true,
      titles: ["TestBrand — practical listing draft (handoff rev 1)"],
      bullets: ["Confirmed: Brand: TestBrand."],
      description: "Confirmed handoff facts only; draft for human review.",
      keywords: ["TestBrand"],
      sellingPoints: ["Brand: TestBrand"],
      riskNotes: ["Human review required."],
      complianceWarnings: [],
      blockedClaims: [],
      reviewChecklist: ["Human review required before publishing."],
    }));
    const provider = createRealListingProvider();
    const result = await provider.generate(listingInput);
    expect(result).toBeTruthy();
    expect((result as { version: number }).version).toBe(1);
  });

  it("19. Markdown code fence 包裹 JSON → 通过", async () => {
    setRealAiListingClientForTests(async () => "```json\n{\"version\":1,\"model\":\"deepseek-chat\",\"source\":\"real_ai_draft\",\"generatedAt\":\"2026-08-05T00:00:00.000Z\",\"humanReviewRequired\":true,\"titles\":[\"T\"],\"bullets\":[\"B\"],\"description\":\"D\",\"keywords\":[\"K\"],\"sellingPoints\":[],\"riskNotes\":[],\"complianceWarnings\":[],\"blockedClaims\":[],\"reviewChecklist\":[]}\n```");
    const provider = createRealListingProvider();
    const result = await provider.generate(listingInput);
    expect((result as { titles: string[] }).titles).toEqual(["T"]);
  });

  it("20. 非 JSON → provider 失败（不保存由阶段C 保证）", async () => {
    setRealAiListingClientForTests(async () => "this is not json");
    const provider = createRealListingProvider();
    await expect(provider.generate(listingInput)).rejects.toThrow(/real_listing_provider_failed:ai_json_parse_failed/);
  });

  it("21. Schema 非法 → provider 失败", async () => {
    setRealAiListingClientForTests(async () => ({ broken: true }));
    const provider = createRealListingProvider();
    await expect(provider.generate(listingInput)).rejects.toThrow(/real_listing_provider_failed:ai_schema_invalid/);
  });

  it("22. 超时 → 错误映射", async () => {
    setRealAiListingClientForTests(async () => {
      const error = new Error("timeout") as Error & { code?: string; name?: string };
      error.name = "TimeoutError";
      throw error;
    });
    const provider = createRealListingProvider();
    await expect(provider.generate(listingInput)).rejects.toThrow(/real_listing_provider_failed:ai_timeout/);
  });

  it("23. 429 → 错误映射", async () => {
    setRealAiListingClientForTests(async () => {
      const error = new Error("rate limited") as Error & { code?: string };
      error.code = "rate_limited";
      throw error;
    });
    const provider = createRealListingProvider();
    await expect(provider.generate(listingInput)).rejects.toThrow(/real_listing_provider_failed:ai_provider_error/);
  });

  it("24. 5xx → 错误映射", async () => {
    setRealAiListingClientForTests(async () => {
      const error = new Error("server error") as Error & { code?: string };
      error.code = "network_error";
      throw error;
    });
    const provider = createRealListingProvider();
    await expect(provider.generate(listingInput)).rejects.toThrow(/real_listing_provider_failed:ai_provider_error/);
  });

  it("25. callCount 递增", async () => {
    setRealAiListingClientForTests(async () => ({
      version: 1, model: "m", source: "real_ai_draft", generatedAt: "2026-08-05T00:00:00.000Z",
      humanReviewRequired: true, titles: ["T"], bullets: ["B"], description: "D", keywords: ["K"],
      sellingPoints: [], riskNotes: [], complianceWarnings: [], blockedClaims: [], reviewChecklist: [],
    }));
    const provider = createRealListingProvider();
    await provider.generate(listingInput);
    await provider.generate(listingInput);
    expect(provider.callCount).toBe(2);
  });
});

describe("V2-FI-10 Provider 模式 fail-closed", () => {
  it("26. 模式缺失 → 配置错误（不静默回退）", () => {
    const prev = process.env.LISTING_PROVIDER_MODE;
    delete process.env.LISTING_PROVIDER_MODE;
    expect(() => resolveListingProviderMode()).toThrow(/LISTING_PROVIDER_MODE/);
    expect(realListingProviderEnabled()).toBe(false);
    if (prev !== undefined) process.env.LISTING_PROVIDER_MODE = prev;
  });

  it("27. mock/real 均合法", () => {
    const prev = process.env.LISTING_PROVIDER_MODE;
    process.env.LISTING_PROVIDER_MODE = "mock";
    expect(resolveListingProviderMode()).toBe("mock");
    process.env.LISTING_PROVIDER_MODE = "real";
    expect(resolveListingProviderMode()).toBe("real");
    if (prev !== undefined) process.env.LISTING_PROVIDER_MODE = prev; else delete process.env.LISTING_PROVIDER_MODE;
  });
});

describe("V2-FI-12/13 真实 Image Provider Adapter", () => {
  it("29. 能力声明：文生图 + 参考图生图（images.edit）", () => {
    expect(REAL_IMAGE_PROVIDER_CAPABILITY.textToImage).toBe(true);
    expect(REAL_IMAGE_PROVIDER_CAPABILITY.referenceImage).toBe(true);
    expect(REAL_IMAGE_PROVIDER_CAPABILITY.supportedModes).toEqual(["composition_concept", "product_visual_draft"]);
  });

  it("30. product_visual_draft 缺参考图 → 安全拒绝（referenceImageDataUrl 缺失）", async () => {
    const provider = createRealImageProvider();
    const visualInput = { ...imageInput, mode: "product_visual_draft" as const, referenceImageDataUrl: undefined };
    await expect(provider.generate(visualInput)).rejects.toThrow(/real_image_provider_reference_missing/);
    expect(provider.callCount).toBe(1);
  });

  it("31. Image 模式 fail-closed", () => {
    const prev = process.env.IMAGE_PROVIDER_MODE;
    delete process.env.IMAGE_PROVIDER_MODE;
    expect(() => resolveImageProviderMode()).toThrow(/IMAGE_PROVIDER_MODE/);
    expect(realImageProviderEnabled()).toBe(false);
    if (prev !== undefined) process.env.IMAGE_PROVIDER_MODE = prev;
  });
});
