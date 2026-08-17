import "server-only";

import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";

/**
 * PR2-2 隔离 Mock Provider：
 * - 确定性（不联网、不读正式环境变量、不写数据库）
 * - 可记录调用次数与收到的安全输入（供证据证明只收到允许字段）
 * - 可返回 Schema 合法/非法输出、可含 unsupported claim
 * - 可延迟返回，用于制造 Provider 调用期间的 Handoff 并发变化
 * - 不接收完整 Task / resultJson / 内部主体 / Ledger / 完整 Hash
 */

export type MockListingProviderOptions = {
  /** 延迟返回毫秒数（制造竞态） */
  delayMs?: number;
  /** 返回 Schema 非法输出（结构错误） */
  forceInvalidSchema?: boolean;
  /** 返回含 unsupported claim 的输出（Claim Filter 必须拦截） */
  forceUnsupportedClaim?: boolean;
  /** 返回含禁止声明的输出（Claim Filter 必须拦截） */
  forceProhibitedClaim?: boolean;
  /** 使输出非 JSON（解析失败路径） */
  forceNonJson?: boolean;
  /** 使输出包含某事实的“AI 发明值”（无依据事实化检测） */
  fabricatedFact?: string;
  /** 标记该项输出由 Mock Provider 生成 */
  tag?: string;
};

export type MockProviderCallRecord = {
  order: number;
  received: {
    schema: string;
    source: { handoffRevision: number; researchRevision: number };
    productFactFields: string[];
    stableSourceFactFields: string[];
    creativeReferenceCount: number;
    prohibitedClaimCount: number;
    unknownCount: number;
    hasInternalKey: boolean;
    inputKeyCount: number;
  };
};

const MOCK_MODEL = "mock-listing-provider-v1";
/** ai_listing_pack 合同要求 mock 草稿的 model 必须为 "mock"（validateAiListingPackDraft） */
const MOCK_DRAFT_MODEL = "mock";

function cleanText(value: string): string {
  return value.trim().replace(/\s{2,}/g, " ").slice(0, 500);
}

function fieldValue(fact: { value: string }, fallback: string): string {
  const v = cleanText(fact.value);
  return v || fallback;
}

/**
 * 从安全 Listing Input 构造确定性 Mock 草稿（schema 合法）。
 * 只使用允许字段：productFacts / stableSourceFacts / creativePreferences / 商品名输入。
 */
export function buildMockListingDraftFromInput(
  input: ListingGenerationInput,
  options: MockListingProviderOptions = {},
) {
  const productName = input.productFacts.find((f) => f.field === "brand")?.value
    || input.productFacts.find((f) => f.field === "productName")?.value
    || "Handoff Product";
  const primary = input.productFacts[0];
  const factLine = primary ? fieldValue(primary, "confirmed product fact") : "confirmed product facts";

  const unknownNote = input.unknowns.length
    ? `Unknown details require manual confirmation and were not stated as facts: ${input.unknowns.join("; ")}.`
    : "All stated product details come from confirmed handoff facts.";

  const title = `${productName} — ${input.creativePreferences.tone ?? "practical"} listing draft (handoff rev ${input.source.handoffRevision})`;

  const bullets = [
    `Confirmed: ${factLine}.`,
    unknownNote,
    `Research mode: market research only. Draft is not published, certified or approved.`,
    `Human review against supplier documents and platform rules is required before any use.`,
  ];

  return {
    source: "mock_ai_draft" as const,
    version: 1,
    generatedAt: new Date("2026-08-05T00:00:00.000Z").toISOString(),
    model: MOCK_DRAFT_MODEL,
    humanReviewRequired: true,
    titles: [title, `${productName} for ${input.creativePreferences.targetMarket ?? "the target market"}`],
    bullets,
    description: `${productName} listing draft generated from a confirmed creative handoff. ${factLine}. ${unknownNote} This is a draft for human review only; nothing here is published, certified, or approved.`,
    keywords: [productName, input.creativePreferences.targetMarket ?? "cross-border product", "listing draft", "human review required"].filter(Boolean),
    sellingPoints: input.productFacts.slice(0, 3).map((f) => `${f.label}: ${fieldValue(f, "confirmed")}`),
    riskNotes: [
      "Supplier documents, platform rules, IP risk and local compliance must be reviewed before publishing.",
      `Handoff revision ${input.source.handoffRevision} (research ${input.source.researchRevision}); human review required.`,
    ],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: [
      "Human review required before publishing.",
      "Confirm material, dimensions, package contents and compatibility with supplier documents.",
    ],
  };
}

/**
 * 隔离 Mock Provider 调用器。
 * 记录每次调用的安全输入摘要，供测试断言 Mock 只收到允许字段。
 */
export function createMockListingProvider() {
  let calls = 0;

  const records: MockProviderCallRecord[] = [];

  return {
    get model() {
      return MOCK_MODEL;
    },
    get callCount() {
      return calls;
    },
    get records(): ReadonlyArray<MockProviderCallRecord> {
      return records;
    },
    async generate(input: ListingGenerationInput, options: MockListingProviderOptions = {}): Promise<unknown> {
      calls += 1;
      records.push({
        order: calls,
        received: {
          schema: input.schema,
          source: { handoffRevision: input.source.handoffRevision, researchRevision: input.source.researchRevision },
          productFactFields: input.productFacts.map((f) => f.field),
          stableSourceFactFields: input.stableSourceFacts.map((f) => f.field),
          creativeReferenceCount: input.creativeReferences.length,
          prohibitedClaimCount: input.prohibitedClaims.length,
          unknownCount: input.unknowns.length,
          hasInternalKey: false,
          inputKeyCount: Object.keys(input).length,
        },
      });
      if (options.delayMs && options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (options.forceNonJson) return "not-json";
      if (options.forceInvalidSchema) return { broken: true };
      const draft = buildMockListingDraftFromInput(input, options);
      if (options.forceUnsupportedClaim) {
        draft.bullets = [...draft.bullets, "FDA Approved for this product."];
      }
      if (options.forceProhibitedClaim) {
        draft.bullets = [...draft.bullets, `100% Safe guarantee.`];
      }
      if (options.fabricatedFact) {
        draft.bullets = [...draft.bullets, `New material claim: ${options.fabricatedFact}`];
      }
      return draft;
    },
  };
}

export type MockListingProvider = ReturnType<typeof createMockListingProvider>;

/** 验证 Mock Provider 只收到允许字段（供证据断言） */
export function assertMockInputIsSafe(records: readonly MockProviderCallRecord[]) {
  for (const record of records) {
    if (record.received.hasInternalKey) return false;
    const allowedKeys = ["schema", "source", "productFacts", "stableSourceFacts", "creativeReferences", "creativePreferences", "prohibitedClaims", "unknowns", "humanReviewRequired", "researchMode", "promotionEligible", "creativeContext", "listingBrief", "englishRenderings"];
    if (record.received.inputKeyCount > allowedKeys.length) return false;
  }
  return true;
}

/**
 * 从安全 Listing Input 构造确定性 Mock 草稿（与 Provider 输出同源，保证 Schema 合法）。
 * 输出为 ai_listing_pack 形态；由调用方执行 Schema Validation 与 Claim Filter。
 */
export function buildMockAiListingDraftFromInput(input: {
  productName: string;
  decisionSummary: string;
  riskLevel: string;
  category: string;
  sellingPoints: string[];
  outputLanguage?: string;
}, generationInput: ListingGenerationInput): AiListingPackDraft {
  const productName = input.productName.trim() || "Handoff Product";
  const factLine = generationInput.productFacts[0]
    ? `${generationInput.productFacts[0].label}: ${generationInput.productFacts[0].value}`
    : "confirmed product facts";
  const unknownNote = generationInput.unknowns.length
    ? `Unknown details require manual confirmation and were not stated as facts: ${generationInput.unknowns.join("; ")}.`
    : "All stated product details come from confirmed handoff facts.";
  const tone = generationInput.creativePreferences.tone ?? "practical";
  const targetMarket = generationInput.creativePreferences.targetMarket ?? "the target market";

  return {
    source: "mock_ai_draft",
    version: 1,
    generatedAt: new Date("2026-08-05T00:00:00.000Z").toISOString(),
    model: MOCK_DRAFT_MODEL,
    humanReviewRequired: true,
    titles: [
      `${productName} — ${tone} listing draft (handoff rev ${generationInput.source.handoffRevision})`,
      `${productName} for ${targetMarket}`,
    ],
    bullets: [
      `Confirmed: ${factLine}.`,
      unknownNote,
      "Research mode: market research only. Draft is not published, certified or approved.",
      "Human review against supplier documents and platform rules is required before any use.",
    ],
    description: `${productName} listing draft generated from a confirmed creative handoff. ${factLine}. ${unknownNote} This is a draft for human review only; nothing here is published, certified, or approved.`,
    keywords: [productName, targetMarket, "listing draft", "human review required"].filter(Boolean),
    sellingPoints: generationInput.productFacts.slice(0, 3).map((f) => `${f.label}: ${f.value.slice(0, 200)}`),
    riskNotes: [
      "Supplier documents, platform rules, IP risk and local compliance must be reviewed before publishing.",
      `Handoff revision ${generationInput.source.handoffRevision} (research ${generationInput.source.researchRevision}); human review required.`,
    ],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: [
      "Human review required before publishing.",
      "Confirm material, dimensions, package contents and compatibility with supplier documents.",
    ],
  };
}
