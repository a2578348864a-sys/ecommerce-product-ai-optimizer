/**
 * V3 Final PHASE 1 — Canonical Fact Mapping Adapter（唯一映射）
 *
 * 职责：Research Fact（factCandidates 已确认事实）→ Listing/Creative Consumer Field 的
 * 唯一字段映射与 scope 分配。禁止 Research 页面与 Listing 页面各维护一套映射。
 *
 * 规则（SHARED_CONTRACT_FREEZE §8）：
 * - price/rating/reviews/bsr/category：保持 market/internal scope（不成为 Listing 声明）；
 * - material/dimensions/weight/capacity/care/included_components/color_or_variant/
 *   quantity_or_pack_size/compatibility/operation/series_or_model/product_type/
 *   functional_feature：经 Human Confirm 后可消费（internal+listing+image）；
 * - 未知字段：fail-closed（不映射、不静默进入 Listing）。
 *
 * 纯函数：无 DB / 无网络 / 无时间 / 无随机（除确定性 factId 种子）。
 */
import { createHash } from "node:crypto";
import type { ConfirmedFactCandidate } from "@/lib/factCandidates";
import type {
  ProductCreativeHandoffConfirmedFact,
  ProductCreativeHandoffInternalActor,
  ProductCreativeHandoffUsageScope,
} from "@/lib/productCreativeHandoff";

/** Research field → Listing/Consumer field（唯一映射表；同名直通） */
export const RESEARCH_TO_LISTING_FIELD_MAP: Readonly<Record<string, string>> = {
  price: "price_usd",
  rating: "rating",
  reviews: "review_count",
  bsr: "bsr",
  category: "category",
  brand: "brand",
  product_type: "product_type",
  series_or_model: "series_or_model",
  material: "material",
  capacity: "capacity",
  dimensions: "dimensions",
  weight: "weight",
  color_or_variant: "color_or_variant",
  quantity_or_pack_size: "quantity_or_pack_size",
  functional_feature: "functional_feature",
  care: "care",
  construction: "construction",
  included_components: "included_components",
  operation: "operation",
  compatibility: "compatibility",
};

/** 仅 internal scope（市场信号；不成为 Listing 声明） */
const INTERNAL_ONLY_FIELDS: ReadonlySet<string> = new Set(["category", "price", "rating", "reviews", "bsr"]);

/** 经 Human Confirm 后可消费（internal + listing + image） */
const PRODUCT_SCOPE_FIELDS: ReadonlySet<string> = new Set([
  "brand",
  "product_type",
  "series_or_model",
  "material",
  "capacity",
  "dimensions",
  "weight",
  "color_or_variant",
  "quantity_or_pack_size",
  "functional_feature",
  "care",
  "construction",
  "included_components",
  "operation",
  "compatibility",
]);

function usageScopesFor(field: string): ProductCreativeHandoffUsageScope[] {
  if (INTERNAL_ONLY_FIELDS.has(field)) return ["internal"];
  if (PRODUCT_SCOPE_FIELDS.has(field)) return ["internal", "listing", "image"];
  return [];
}

/** 确定性 factId（UUIDv4 格式；与 confirmSelectedProductFacts 同种子规范，幂等基础） */
function factIdFromSeed(seed: string): string {
  const digest = createHash("sha256").update(`confirmed-fact-v1:${seed}`, "utf8").digest("hex");
  const hex = digest.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export type MapResearchConfirmedToHandoffInput = {
  /** 研究侧已确认事实（factCandidates namespace 权威） */
  confirmed: ReadonlyArray<ConfirmedFactCandidate>;
  actor: ProductCreativeHandoffInternalActor;
  candidateId: string;
  /** 桥接发生时间（新 revision 的写入时间；research 原始确认时间保留在 confirmationReference 溯源） */
  confirmedAt: string;
};

/**
 * 研究侧已确认事实 → Handoff confirmedFacts（Bridge）。
 * - 未知字段 fail-closed（跳过；调用方可依据 skipped 统计）；
 * - internal-only 字段带 ["internal"] scope；
 * - 溯源：confirmationReference = `fact-candidates:${candidateId}`（唯一权威来源标记）。
 */
export function mapResearchConfirmedToHandoff(
  input: MapResearchConfirmedToHandoffInput,
): { facts: ProductCreativeHandoffConfirmedFact[]; skipped: Array<{ field: string; reason: string }> } {
  const facts: ProductCreativeHandoffConfirmedFact[] = [];
  const skipped: Array<{ field: string; reason: string }> = [];
  for (const item of input.confirmed) {
    const consumerField = RESEARCH_TO_LISTING_FIELD_MAP[item.field];
    if (!consumerField) {
      skipped.push({ field: item.field, reason: "unknown_field_fail_closed" });
      continue;
    }
    const scopes = usageScopesFor(item.field);
    if (scopes.length === 0) {
      skipped.push({ field: item.field, reason: "scope_not_assigned" });
      continue;
    }
    if (typeof item.value !== "string" && typeof item.value !== "number") {
      skipped.push({ field: item.field, reason: "invalid_value_type" });
      continue;
    }
    const seed = `confirmed:${input.candidateId}:${consumerField}:${JSON.stringify(item.value)}:${item.confirmedAt ?? input.confirmedAt}`;
    facts.push({
      factId: factIdFromSeed(seed),
      field: consumerField,
      label: item.label,
      value: item.value,
      evidenceTier: "human_confirmed",
      usageScopes: scopes,
      sourceRef: {
        sourceKind: "user_confirmation",
        sourceField: consumerField,
        confirmedBy: input.actor,
        confirmedAt: item.confirmedAt ?? input.confirmedAt,
        confirmationReference: `fact-candidates:${input.candidateId}`,
      },
      confirmedAt: item.confirmedAt ?? input.confirmedAt,
      confirmedBy: input.actor,
    });
  }
  return { facts, skipped };
}
