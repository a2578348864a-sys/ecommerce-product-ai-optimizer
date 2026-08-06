import "server-only";

/**
 * Listing 安全降级草稿（确定性保守草稿）。
 *
 * 用途：真实 Provider 已成功响应，但输出被 Schema 或 Claim Evidence 门禁拒绝
 * （listing_claims_unsupported / listing_schema_invalid / 必填字段不完整）时，
 * 不再调用 Provider，由服务端根据 confirmedFacts 与冻结中性文案生成
 * “保守安全草稿”。Claim Evidence 规则零放宽。
 *
 * 安全约束：
 *  - 只使用 productFacts（confirmedFacts 且 usageScopes 含 listing）的原始字段和值；
 *  - 每条 Bullet 只表达一个事实（字段 + 值），不加等级/性能/认证/兼容性/效果/适用范围/主观卖点；
 *  - 缺少的必填文案仅使用 NEUTRAL_COPY_ALLOWLIST 中性文案；
 *  - safeFallbackApplied=true 明确记录（不得冒充 AI 原始输出）；
 *  - humanReviewRequired=true；
 *  - 输出必须通过 ai_listing_pack v1 Schema 与 Claim Evidence。
 */

import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

/** 冻结中性文案允许集（与 Claim Evidence 的 NEUTRAL_COPY_ALLOWLIST 同源语义） */
const NEUTRAL_ALLOWLIST = Object.freeze([
  "日常使用的实用选择",
  "简洁实用的选择",
  "清晰呈现产品特点",
  "现代简约风格",
  "简洁现代的设计",
  "值得信赖的优质之选",
  "轻松融入日常使用",
  "适合日常使用的实用选择",
  "实用之选",
  "设计简约大方",
  "一款实用的产品",
  "适用于日常场景",
  "为生活增添便利",
  "简单好用的选择",
  "满足日常需求",
]);

function neutralCopy(seed: number): string {
  return NEUTRAL_ALLOWLIST[seed % NEUTRAL_ALLOWLIST.length];
}

function factLine(label: string, value: string): string {
  return `${label}: ${value}`;
}

/** 从 label 派生安全字段词（仅用于 bullet 前缀，不含额外声明） */
function fieldTerm(label: string): string {
  const normalized = label.normalize("NFC").trim();
  if (!normalized) return "商品";
  return normalized;
}

/**
 * 构造确定性保守草稿（纯函数，无 Provider 调用、无随机）。
 * 仅当 productFacts 非空时可用；事实不足返回 null（调用方抛稳定 422）。
 */
export function buildSafeFallbackListingDraft(input: {
  generationInput: ListingGenerationInput;
  generatedAt: string;
  model: string;
}): {
  draft: Record<string, unknown>;
  safeFallbackApplied: true;
} | null {
  const facts = input.generationInput.productFacts;
  if (!facts.length) return null;

  // Bullet：每条只表达一个事实（字段: 值）；数量 1-5（Schema 下限 1）
  const bullets = facts
    .slice(0, 5)
    .map((fact) => factLine(fact.label || fact.field, fact.value));

  // Title：商品名（来自第一个事实字段词 + 中性后缀，无主观卖点）
  const firstFact = facts[0];
  const field = fieldTerm(firstFact.label || firstFact.field);
  const title = `${field} ${neutralCopy(0)}`;
  const titles = [title];

  // Keywords：仅事实字段词与值词（可安全检索，无声明）
  const keywords = facts
    .flatMap((fact) => [fact.label, fact.value])
    .map((word) => word.normalize("NFC").trim().slice(0, 40))
    .filter((word) => word.length > 0)
    .slice(0, 12);
  if (keywords.length === 0) keywords.push(field);

  // sellingPoints：仅中性文案（1-6 条，无事实性声明）
  const sellingPoints = [neutralCopy(1), neutralCopy(2)];

  // riskNotes / reviewChecklist：中性安全提示（不含内部信息）
  const riskNotes = ["商品信息来自已人工确认的事实，未包含未经验证的声明。"];
  const reviewChecklist = ["请人工核对事实字段与值后完善表达。"];

  const description = `${field}。${neutralCopy(3)}`;

  const draft: Record<string, unknown> = {
    source: "real_ai_draft" as const,
    version: 1,
    generatedAt: input.generatedAt,
    model: input.model,
    humanReviewRequired: true,
    titles,
    bullets,
    description,
    keywords,
    sellingPoints,
    riskNotes,
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist,
    // 明确记录：安全降级草稿，非 AI 原始输出
    safeFallbackApplied: true,
  };

  return { draft, safeFallbackApplied: true };
}
