/**
 * Listing Readiness（Quality.1）
 *
 * 建立两个独立概念：
 * 1. Claim Safety —— 这些事实是否允许用于 Listing（由 listingEligibleFacts 表达）
 * 2. Listing Quality Readiness —— 现有资料是否足够产生有实际价值的 Amazon Listing
 *
 * fact role 分类（通用，不硬编码水杯字段）：
 * - identity：product_type / brand / series_or_model
 * - specification：material / capacity / color_or_variant / quantity_or_pack_size
 * - functional：其他已确认可 listing 的事实（功能/使用/构造/兼容等，通过 factCategory=product_fact 表达）
 *
 * 输出：
 * - claimSafe：listingEligibleFacts > 0 且无 blocking issue
 * - copyReady：identity + specification(≥2) + functional(≥1)
 * - keywordReady：Keyword Brief 存在
 * - missingForQuality[]：缺失项的中文说明
 */

import type { ProductCreativeHandoffConfirmedFact } from "@/lib/productCreativeHandoff";
import type { ListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";

export type ListingFactRole = "identity" | "specification" | "functional" | "market_signal" | "unknown";

export const LISTING_IDENTITY_FIELDS = new Set(["brand", "product_type", "series_or_model"]);
export const LISTING_SPECIFICATION_FIELDS = new Set([
  "material",
  "capacity",
  "color_or_variant",
  "quantity_or_pack_size",
  "dimension",
  "weight",
  "size",
]);

export function listingFactRole(fact: ProductCreativeHandoffConfirmedFact): ListingFactRole {
  if (LISTING_IDENTITY_FIELDS.has(fact.field)) return "identity";
  if (LISTING_SPECIFICATION_FIELDS.has(fact.field)) return "specification";
  if (["category", "price_usd", "rating", "review_count"].includes(fact.field)) return "market_signal";
  // 其他字段（功能/使用/构造/兼容等手工确认事实）→ functional
  if (fact.usageScopes.includes("listing")) return "functional";
  return "unknown";
}

export type ListingReadiness = {
  claimSafe: boolean;
  copyReady: boolean;
  keywordReady: boolean;
  missingForQuality: string[];
  counts: {
    identity: number;
    specification: number;
    functional: number;
    listingEligible: number;
  };
};

const MIN_SPECIFICATION_COUNT = 2;
const MIN_FUNCTIONAL_COUNT = 1;

export function buildListingReadiness(input: {
  confirmedFacts: ProductCreativeHandoffConfirmedFact[];
  listingEligibleFacts: number;
  hasBlockingIssue: boolean;
  keywordBrief: ListingKeywordBrief | null;
}): ListingReadiness {
  const listingFacts = input.confirmedFacts.filter((f) => f.usageScopes.includes("listing"));
  const roles = listingFacts.map((f) => listingFactRole(f));
  const count = (role: ListingFactRole) => roles.filter((r) => r === role).length;

  const claimSafe = input.listingEligibleFacts > 0 && !input.hasBlockingIssue;
  const identity = count("identity");
  const specification = count("specification");
  const functional = count("functional");
  const copyReady = claimSafe && identity >= 1 && specification >= MIN_SPECIFICATION_COUNT && functional >= MIN_FUNCTIONAL_COUNT;
  const keywordReady = input.keywordBrief !== null;

  const missingForQuality: string[] = [];
  if (!claimSafe) missingForQuality.push("当前没有可用于 Listing 的已确认商品事实。");
  if (claimSafe && identity < 1) missingForQuality.push("缺少商品身份事实（品牌/商品类型/系列型号至少一项）。");
  if (claimSafe && specification < MIN_SPECIFICATION_COUNT) {
    missingForQuality.push(`缺少规格事实（材质/容量/颜色/数量等至少 ${MIN_SPECIFICATION_COUNT} 项，当前 ${specification} 项）。`);
  }
  if (claimSafe && functional < MIN_FUNCTIONAL_COUNT) {
    missingForQuality.push("缺少功能/使用相关事实（功能特性、使用场景、构造、兼容性等至少 1 项）。");
  }
  if (!keywordReady) missingForQuality.push("缺少关键词资料（主搜索词/辅助词），无法进行搜索词优化。");

  return {
    claimSafe,
    copyReady,
    keywordReady,
    missingForQuality,
    counts: {
      identity,
      specification,
      functional,
      listingEligible: input.listingEligibleFacts,
    },
  };
}
