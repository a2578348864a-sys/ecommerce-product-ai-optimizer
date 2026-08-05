import "server-only";

/**
 * V2 Final Integration: 真实 Listing Provider Adapter（复用现有 aiListingGenerator + aiClient）。
 *
 * 不重造 Provider：包装既有 generateRealAiListingDraft（其内部已含：
 *   - callAiJson 真实模型调用（openai/deepseek，env 配置）
 *   - JSON/Markdown code fence/文本解析
 *   - validateAiListingPackDraft Schema 校验
 *   - filterListingClaims Claim 过滤（prohibitedClaims + 竞品词）
 *   - 超时/429/5xx/非JSON/空响应错误映射
 * )
 *
 * Provider 模式由服务端环境变量决定（LISTING_PROVIDER_MODE=mock|real），fail-closed：
 * - 配置缺失/非法 → 稳定配置错误（绝不静默回退 mock 或 real）
 * - real 模式缺 Key → aiClient 返回 missing_api_key 配置错误
 *
 * 新链只替换阶段B 的 Provider Adapter；阶段A/C 门禁、Schema、Claim Evidence、原子保存均不变。
 */

import { generateRealAiListingDraft } from "@/lib/server/aiListingGenerator";
import { createMockListingProvider, type MockListingProvider } from "@/lib/listingHandoff/mockListingProvider";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { StudioListingPreferences } from "@/lib/studioListingInput";

export type ListingProviderMode = "mock" | "real";

/** 从服务端环境读取 Provider 模式（fail-closed：缺失/非法 → 配置错误） */
export function resolveListingProviderMode(): ListingProviderMode {
  const mode = process.env.LISTING_PROVIDER_MODE?.trim().toLowerCase();
  if (mode === "real") return "real";
  if (mode === "mock") return "mock";
  throw new Error("LISTING_PROVIDER_MODE 未配置或非法（必须为 mock 或 real）；已阻止生成。");
}

export function realListingProviderEnabled(): boolean {
  try {
    return resolveListingProviderMode() === "real";
  } catch {
    return false;
  }
}

/** 从新链安全输入构造现有真实 Provider 所需上下文（仅允许字段） */
function buildRealListingContext(input: ListingGenerationInput) {
  const productName = input.productFacts.find((f) => f.field === "productName")?.value
    || input.productFacts.find((f) => f.field === "brand")?.value
    || input.productFacts.find((f) => f.field === "title")?.value
    || "Handoff Product";
  const targetMarket = (input.creativePreferences.targetMarket as string) || "US";
  const tone = (input.creativePreferences.tone as string) || "professional";
  const preferences: StudioListingPreferences = {
    targetMarket: (["US", "UK", "DE", "CA"].includes(targetMarket) ? targetMarket : "US") as StudioListingPreferences["targetMarket"],
    outputLanguage: "en",
    tone: (["professional", "conversion", "concise", "brand"].includes(tone) ? tone : "professional") as StudioListingPreferences["tone"],
    listingObjective: "balanced",
    coreFunction: "",
    targetAudience: "",
    problemSolved: "",
    differentiators: [],
    primaryKeywords: [],
    secondaryKeywords: [],
    competitorKeywords: [],
    confirmedFacts: input.productFacts.map((f) => `${f.label}: ${f.value}`),
    unverifiedFacts: input.unknowns,
    prohibitedClaims: input.prohibitedClaims,
  };
  return {
    taskTitle: null,
    productName,
    decisionSummary: "Market research only; human review required before any use.",
    riskLevel: "medium",
    category: input.productFacts.find((f) => f.field === "category")?.value || "",
    sellingPoints: input.productFacts.slice(0, 8).map((f) => `${f.label}: ${f.value}`),
    studioPreferences: preferences,
  };
}

export type RealListingProviderOptions = {
  onProviderCallStart?: () => void | Promise<void>;
};

export type RealListingProvider = {
  model: string;
  callCount: number;
  generate(input: ListingGenerationInput, options?: RealListingProviderOptions): Promise<unknown>;
};

/** 真实 Listing Provider Adapter：安全输入 → 现有真实 Provider → ai_listing_pack 合同输出 */
export function createRealListingProvider(): RealListingProvider {
  let calls = 0;
  return {
    get model() {
      return "real-ai-provider";
    },
    get callCount() {
      return calls;
    },
    async generate(input: ListingGenerationInput, options: RealListingProviderOptions = {}) {
      calls += 1;
      const result = await generateRealAiListingDraft(buildRealListingContext(input), {
        onProviderCallStart: options.onProviderCallStart,
      });
      if (!result.ok) {
        throw new Error(`real_listing_provider_failed:${result.error.code}:${result.error.message}`);
      }
      // 输出直接是合法 AiListingPackDraft（新链阶段C 将再次 validate + Claim Evidence）
      return result.data as unknown;
    },
  };
}

/** 默认 Provider 工厂：按服务端环境选择 mock 或 real（fail-closed） */
export function createListingProviderByMode(): MockListingProvider {
  const mode = resolveListingProviderMode();
  if (mode === "real") {
    return createRealListingProvider() as unknown as MockListingProvider;
  }
  return createMockListingProvider();
}
