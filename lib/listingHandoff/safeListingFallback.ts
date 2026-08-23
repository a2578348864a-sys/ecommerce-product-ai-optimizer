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
import { composeOptimizedListingDraft } from "@/lib/listingHandoff/listingComposition";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";

/** 冻结中性文案允许集（与 Claim Evidence 的 NEUTRAL_COPY_ALLOWLIST 同源语义；English-only） */
const NEUTRAL_ALLOWLIST = Object.freeze([
  "A practical everyday choice",
  "A simple and practical choice",
  "Clear product highlights",
  "Modern minimal design",
  "Clean and simple design",
  "A trusted quality choice",
  "Fits easily into daily use",
  "A practical everyday choice for daily use",
  "A practical pick",
  "Simple and elegant design",
  "A practical product",
  "Suitable for everyday scenarios",
  "Adds convenience to daily life",
  "A simple, easy-to-use choice",
  "Meets everyday needs",
]);

/** 字段标签的英文映射（仅用于 bullet 前缀，不含额外声明） */
const FIELD_LABEL_EN: Record<string, string> = {
  品牌: "Brand",
  商品类型: "Product Type",
  系列: "Series",
  型号: "Model",
  材质: "Material",
  容量: "Capacity",
  颜色: "Color",
  "颜色/变体": "Color/Variant",
  数量: "Quantity",
  包装: "Packaging",
  功能特性: "Feature",
  功能特点: "Feature",
  使用场景: "Usage",
  清洁保养: "Care",
  结构与做工: "Construction",
  兼容性: "Compatibility",
  随附组件: "Included Components",
  操作: "Operation",
  其他: "Other",
  尺寸: "Dimensions",
  长度: "Length",
  宽度: "Width",
  高度: "Height",
  直径: "Diameter",
  重量: "Weight",
  净重: "Net Weight",
};

function neutralCopy(seed: number): string {
  return NEUTRAL_ALLOWLIST[seed % NEUTRAL_ALLOWLIST.length];
}

/** label → 英文（已知字段映射，否则保留原 label 并透传） */
function enLabel(label: string): string {
  const normalized = label.normalize("NFC").trim();
  return FIELD_LABEL_EN[normalized] ?? normalized;
}

function factLine(label: string, value: string): string {
  return `${label}: ${value}`;
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

  // 轮 16：升级为自然卖点句（复用 composeOptimizedListingDraft：≥8 词 + 自动关键词），
  // 仅当事实能支持时；否则回退为"标签: 值"保守行（不伪装成品）。
  const plan = buildListingPlan(input.generationInput, null);
  const optimized = composeOptimizedListingDraft(input.generationInput, plan, null);
  const naturalBullets = optimized.bullets.filter((b) => b.trim().split(/\s+/).filter(Boolean).length >= 8);
  const bullets = naturalBullets.length >= 1
    ? naturalBullets
    : facts.slice(0, 5).map((fact) => factLine(enLabel(fact.label || fact.field), fact.value));

  // Title：商品名（来自第一个事实字段词 + 中性后缀，无主观卖点）
  const firstFact = facts[0];
  const field = enLabel(firstFact.label || firstFact.field);
  const title = `${field} ${neutralCopy(0)}`;
  const titles = [title];

  // 轮 16：keywords 优先 auto_suggested（SEO 参考），无则回退事实词
  let keywords = optimized.keywords.slice(0, 12);
  if (keywords.length === 0) {
    keywords = facts
      .flatMap((fact) => [enLabel(fact.label), fact.value])
      .map((word) => word.normalize("NFC").trim().slice(0, 40))
      .filter((word) => word.length > 0)
      .slice(0, 12);
  }
  if (keywords.length === 0) keywords.push(field);

  // sellingPoints：仅中性文案（1-6 条，无事实性声明）
  const sellingPoints = [neutralCopy(1), neutralCopy(2)];

  // riskNotes / reviewChecklist：中性安全提示（不含内部信息；English-only）
  const riskNotes = ["Listing facts come from human-confirmed product facts; nothing unverified is stated."];
  const reviewChecklist = ["Please review facts, wording and search terms before finalizing."];

  const description = `${field}. ${neutralCopy(3)}.`;

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
