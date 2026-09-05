/**
 * Reference Material Filter
 *
 * 负责从当前任务已保存资料中筛选允许用于「参考初稿」的内容（小白名单 + 严格值校验）。
 * 纯函数：无 DB / 无网络 / 无副作用。
 */

import { createHash } from "node:crypto";
import {
  extractFactCandidates,
  getFactCandidates,
  type FactCandidate,
  type ConfirmedFactCandidate,
} from "@/lib/factCandidates";
import { deriveTitleProductFacts } from "@/lib/titleDerivedProductFacts";
import type {
  ReferenceMaterialItem,
  ExcludedMaterialItem,
  ReferenceDraftReadiness,
  ReferenceMaterialSourceKind,
} from "./referenceDraftContract";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (typeof val === "number" && Number.isFinite(val)) return String(val).trim();
  return "";
}

/** 允许提取的候选字段白名单 */
const ALLOWED_FIELDS = new Set<string>([
  "brand",
  "series_or_model",
  "product_type",
  "color_or_variant",
  "quantity_or_pack_size",
  "dimensions",
  "included_components",
  "capacity",
]);

const FIELD_CHINESE_LABELS: Record<string, string> = {
  brand: "品牌",
  series_or_model: "系列/型号",
  product_type: "商品类型",
  color_or_variant: "颜色/款式",
  quantity_or_pack_size: "数量/包装",
  dimensions: "尺寸",
  included_components: "随附组件",
  capacity: "容量",
  material: "材质",
  price: "参考价格",
  rating: "评分",
  reviews: "评论数",
  bsr: "大类排名",
  category: "类目",
  weight: "重量",
  functional_feature: "功能特性",
};

/** 高风险声明模式校验（值级审查） */
const HIGH_RISK_VALUE_RULES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(?:\b(?:\d+\s*(?:lb|lbs|kg|g)|load(?:\s*capacity)?|bearing|heavy\s*duty|hold\s*up\s*to)\b)|(?:承重|承载|负重|\d+\s*(?:斤|磅))/i,
    reason: "包含未核实的高风险承重声明",
  },
  {
    pattern: /(?:\b(?:waterproof|water-proof|leakproof|leak-proof|water-resistant|water\s*resistant|spill-proof)\b)|(?:防水|防漏|防泼水)/i,
    reason: "包含未核实的高风险防水/防漏声明",
  },
  {
    pattern: /(?:\b(?:food\s*safe|food-grade|bpa-free|bpa\s*free|medical|fda|ce\s*cert|certified|certification|lead-free)\b)|(?:食品级|无毒|认证|医疗)/i,
    reason: "包含未核实的食品安全/医疗/认证声明",
  },
  {
    pattern: /(?:\b(?:304|316|stainless\s*steel|titanium)\b)|(?:不锈钢|纯钛)/i,
    reason: "包含未核实的材料等级声明",
  },
  {
    pattern: /(?:\b(?:rustproof|rust-proof|rust-resistant|heat-resistant|dishwasher-safe|dishwasher\s*safe)\b)|(?:防锈|耐高温|洗碗机)/i,
    reason: "包含未核实的防锈/耐热/洗碗机兼容性声明",
  },
  {
    pattern: /(?:\b(?:no-trace|never\s*fall|fall-off|permanent|lifetime|guarantee|warranty)\b)|(?:永不脱落|无痕|终身|保修)/i,
    reason: "包含绝对化或未核实的品质保证声明",
  },
  {
    pattern: /(?:\b(?:premium|perfect|best|durable)\b)|(?:极佳|顶级|完美)/i,
    reason: "包含空泛营销词，不作为客观规格",
  },
];

/** 市场观察字段 */
const MARKET_OBSERVATION_FIELDS = new Set(["price", "rating", "reviews", "bsr", "category"]);

/** 身份字段（用于标题/主语，不能单独作为卖点） */
export const IDENTITY_FIELDS = new Set<string>([
  "brand",
  "series_or_model",
  "product_type",
]);

/** 客观实质规格属性字段（必须至少有 1 项才算可生成初稿） */
export const SUBSTANTIVE_FIELDS = new Set<string>([
  "color_or_variant",
  "quantity_or_pack_size",
  "dimensions",
  "included_components",
  "capacity",
]);

/**
 * 校验值是否包含高风险内容
 */
export function checkValueRisk(value: string): string | null {
  for (const rule of HIGH_RISK_VALUE_RULES) {
    if (rule.pattern.test(value)) {
      return rule.reason;
    }
  }
  return null;
}

/**
 * 来源种类转为中文可读说明
 */
function toSourceLabel(sourceKind: ReferenceMaterialSourceKind, isConfirmed: boolean): string {
  if (isConfirmed) return "人工已确认事实";
  switch (sourceKind) {
    case "amazon_browser_evidence":
      return "Amazon 页面规格快照";
    case "product_title":
      return "Amazon 页面已保存标题";
    case "seller_sprite_product_facts":
      return "SellerSprite 基础事实";
    case "confirmed_fact":
      return "人工已确认事实";
    default:
      return "已保存来源资料";
  }
}

export function normalizeMarket(str?: string | null): string {
  if (!str) return "";
  const s = str.trim().toLowerCase();
  if (s === "us" || s.includes("amazon.com") || s.includes("美国站") || s.includes(".com")) return "US";
  if (s === "uk" || s === "gb" || s.includes("amazon.co.uk") || s.includes("英国站") || s.includes(".co.uk")) return "UK";
  if (s === "de" || s.includes("amazon.de") || s.includes("德国站") || s.includes(".de")) return "DE";
  if (s === "jp" || s.includes("amazon.co.jp") || s.includes("日本站") || s.includes(".co.jp")) return "JP";
  if (s === "ca" || s.includes("amazon.ca") || s.includes("加拿大站") || s.includes(".ca")) return "CA";
  return s.toUpperCase();
}

export function normalizeSpecValue(val: string): string {
  return val
    .trim()
    .toLowerCase()
    .replace(/\bmatt\b/gi, "matte")
    .replace(/[\s\-_]+/g, " ");
}

export type FilterReferenceMaterialsInput = {
  resultJson: unknown;
  taskContext?: {
    title?: string | null;
    platform?: string | null;
    productUrl?: string | null;
  };
};

/**
 * 主筛选函数：从任务资料中提取符合参考初稿白名单与安全要求的资料
 */
export function filterReferenceMaterials(input: FilterReferenceMaterialsInput): ReferenceDraftReadiness {
  const result = isRecord(input.resultJson) ? input.resultJson : {};
  const context = input.taskContext ?? {};

  // 1. 确认商品身份
  let productName = "";
  const sourceMeta = isRecord(result.sourceMeta) ? result.sourceMeta : null;
  const candidateSnapshot = sourceMeta && isRecord(sourceMeta.candidateSnapshot)
    ? sourceMeta.candidateSnapshot
    : null;
  if (candidateSnapshot && typeof candidateSnapshot.productName === "string" && candidateSnapshot.productName.trim()) {
    productName = candidateSnapshot.productName.trim();
  } else if (typeof result.productName === "string" && result.productName.trim()) {
    productName = result.productName.trim();
  } else if (context.title && context.title.trim()) {
    productName = context.title.trim();
  }

  const batchSnapshot = sourceMeta && isRecord(sourceMeta.productBatchSnapshot)
    ? sourceMeta.productBatchSnapshot
    : null;
  const asin = cleanStr(batchSnapshot?.asin) || cleanStr(result.asin) || null;
  const targetMarket =
    normalizeMarket(context.platform) ||
    normalizeMarket(context.productUrl) ||
    normalizeMarket(cleanStr(batchSnapshot?.marketplace)) ||
    normalizeMarket(cleanStr(result.marketplace)) ||
    "US";
  const market = targetMarket;

  // 缺少明确商品名称或完全无资料时
  if (!productName && !asin && Object.keys(result).length === 0) {
    return {
      status: "blocked",
      reason: "缺少明确商品身份，无法生成参考初稿。",
      productName: "",
      market: "Amazon 美国站",
      asin: null,
      adoptedCount: 0,
      excludedCount: 0,
      adoptedMaterials: [],
      excludedMaterials: [],
      sourceFingerprint: "",
    };
  }

  // 2. 提取候选与已确认事实
  const factCandidatesData = getFactCandidates(result);
  let confirmedList: ConfirmedFactCandidate[] = factCandidatesData?.confirmed ?? [];
  if (
    confirmedList.length === 0 &&
    isRecord(result.factCandidates) &&
    Array.isArray(result.factCandidates.confirmed)
  ) {
    confirmedList = result.factCandidates.confirmed as ConfirmedFactCandidate[];
  }
  const extractedCandidates: FactCandidate[] = extractFactCandidates(result);

  const adoptedMap = new Map<string, ReferenceMaterialItem>();
  const excludedMaterials: ExcludedMaterialItem[] = [];
  const conflictedFields = new Set<string>();

  // 辅助函数：尝试采纳或记录排除
  const evaluateItem = (
    field: string,
    rawVal: string,
    sourceKind: ReferenceMaterialSourceKind,
    isConfirmed: boolean,
  ) => {
    if (conflictedFields.has(field)) return;
    const val = cleanStr(rawVal);
    const label = FIELD_CHINESE_LABELS[field] || field;
    if (!val) return;

    // 检查是否为市场观察字段
    if (MARKET_OBSERVATION_FIELDS.has(field)) {
      excludedMaterials.push({
        field,
        label,
        value: val,
        reason: "属于平台市场观察数据（BSR/价格/评论），不作为商品本身规格",
      });
      return;
    }

    // 检查字段白名单
    if (!ALLOWED_FIELDS.has(field)) {
      // 常见排除字段的友好说明
      let reason = "字段不在参考初稿基础规格白名单内";
      if (field === "material") {
        reason = "材质字段未确认安全等级，暂不用于参考初稿";
      } else if (field === "weight") {
        reason = "重量/承重属性需专项核验，暂不用于参考初稿";
      } else if (field === "functional_feature") {
        reason = "功能特性需人工核实真实依据，暂不作为硬属性";
      }
      excludedMaterials.push({ field, label, value: val, reason });
      return;
    }

    // 特殊：容量 capacity 只能是明确的液体容积 (fl oz / ml / L)，绝不能是重量 (lb/kg) 或仅写 oz
    if (field === "capacity") {
      const isExplicitLiquidVolume = /\b(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz\.?|fluid\s*ounces?|ml|milliliters?|l|liters?|gallons?|qt|quarts?)\b/i.test(val);
      if (!isExplicitLiquidVolume) {
        excludedMaterials.push({
          field,
          label,
          value: val,
          reason: "容量必须明确为液体容积单位（fl oz / ml / L），仅标注 oz 可能为重量盎司，暂不采用",
        });
        return;
      }
    }

    // 检查值是否含高风险声明
    const riskReason = checkValueRisk(val);
    if (riskReason) {
      excludedMaterials.push({
        field,
        label,
        value: val,
        reason: riskReason,
      });
      return;
    }

    // 检查是否存在同字段冲突
    const existing = adoptedMap.get(field);
    if (existing) {
      const existingNorm = normalizeSpecValue(existing.value);
      const valNorm = normalizeSpecValue(val);

      // 规范化后完全相同
      if (existingNorm === valNorm) {
        if (!existing.isConfirmed && isConfirmed) {
          adoptedMap.set(field, {
            id: `confirmed:${field}`,
            field,
            label,
            value: val,
            sourceKind: "confirmed_fact",
            sourceLabel: toSourceLabel("confirmed_fact", true),
            isConfirmed: true,
          });
        }
        return;
      }

      // 只要值不完全相同（如 4-Pack vs 14-Pack, 12 vs 312, Black vs Matte Black），一律视为冲突排除，不使用模糊 includes
      conflictedFields.add(field);
      adoptedMap.delete(field);
      excludedMaterials.push({
        field,
        label,
        value: `${existing.value} vs ${val}`,
        reason: `存在多源值冲突（${existing.value} vs ${val}），需人工核实`,
      });
      return;
    }

    // 正常通过采纳
    adoptedMap.set(field, {
      id: `${sourceKind}:${field}`,
      field,
      label,
      value: val,
      sourceKind,
      sourceLabel: toSourceLabel(sourceKind, isConfirmed),
      isConfirmed,
    });
  };

  // 1. 先处理已确认事实（权威最高）
  for (const item of confirmedList) {
    evaluateItem(item.field, String(item.value), "confirmed_fact", true);
  }

  // 2. 处理直接 Amazon 页面产品规格表（优先级高于标题粗推），严格验证 ASIN 与站点
  const browser = isRecord(result.browserEvidence) ? result.browserEvidence : null;
  const snapshots = browser && Array.isArray(browser.snapshots) ? browser.snapshots : [];
  const rejectedSnapshotIndices = new Set<number>();
  const rejectedSnapshotAsins = new Set<string>();
  const rejectedSnapshotFactSignatures = new Set<string>();

  for (let snapIdx = 0; snapIdx < snapshots.length; snapIdx++) {
    const snapshot = snapshots[snapIdx];
    if (!isRecord(snapshot)) continue;
    const snapAsin = cleanStr(snapshot.asin);
    const snapMarket = normalizeMarket(cleanStr(snapshot.marketplace) || cleanStr(snapshot.domain) || cleanStr(snapshot.url));

    let rejected = false;
    if (asin && snapAsin && snapAsin.toUpperCase() !== asin.toUpperCase()) {
      rejected = true;
      excludedMaterials.push({
        field: "snapshot_asin_mismatch",
        label: "页面规格快照",
        value: snapAsin,
        reason: `快照 ASIN (${snapAsin}) 与当前商品 ASIN (${asin}) 不一致，已排除`,
      });
    } else if (targetMarket && snapMarket && snapMarket !== targetMarket) {
      rejected = true;
      excludedMaterials.push({
        field: "snapshot_market_mismatch",
        label: "页面规格快照",
        value: snapMarket,
        reason: `快照站点 (${snapMarket}) 与任务目标站点 (${targetMarket}) 不一致，已排除`,
      });
    }

    if (rejected) {
      rejectedSnapshotIndices.add(snapIdx);
      if (snapAsin) rejectedSnapshotAsins.add(snapAsin.toUpperCase());
      if (isRecord(snapshot.productInfo) && isRecord(snapshot.productInfo.canonicalFacts)) {
        for (const [field, value] of Object.entries(snapshot.productInfo.canonicalFacts)) {
          rejectedSnapshotFactSignatures.add(`${field}:${normalizeSpecValue(String(value))}`);
        }
      }
      continue;
    }

    if (isRecord(snapshot.productInfo) && isRecord(snapshot.productInfo.canonicalFacts)) {
      for (const [field, value] of Object.entries(snapshot.productInfo.canonicalFacts)) {
        evaluateItem(field, String(value), "amazon_browser_evidence", false);
      }
    }
  }

  // 3. 再处理提取候选事实及其并列来源（含直接传入的候选）
  const rawFactCandidates = isRecord(result.factCandidates) ? result.factCandidates : null;
  const directCandidates = rawFactCandidates && Array.isArray(rawFactCandidates.candidates)
    ? rawFactCandidates.candidates
    : [];
  const allCandidates = [...extractedCandidates, ...directCandidates];

  const KNOWN_SOURCE_MAP: Record<string, ReferenceMaterialSourceKind> = {
    confirmed_fact: "confirmed_fact",
    amazon_browser_evidence: "amazon_browser_evidence",
    amazon_product_info: "amazon_browser_evidence",
    seller_sprite_product_facts: "seller_sprite_product_facts",
    product_title: "product_title",
  };

  const processCandidateItem = (cand: unknown) => {
    if (!isRecord(cand) || typeof cand.field !== "string" || cand.value === undefined) return;
    const rawKind = String(cand.sourceKind || "");
    const mappedKind = KNOWN_SOURCE_MAP[rawKind];
    if (!mappedKind) {
      excludedMaterials.push({
        field: cand.field,
        label: FIELD_CHINESE_LABELS[cand.field] || cand.field,
        value: String(cand.value),
        reason: `来源类型未知或未授权 (${rawKind || "unknown"})，直接排除`,
      });
      return;
    }

    // 快照 ASIN 与当前商品不匹配或错站点时，拒绝采纳来自该快照的候选
    const sourceRefStr = typeof cand.sourceRef === "string" ? cand.sourceRef : "";
    const snapIdxMatch = sourceRefStr.match(/snapshots\[(\d+)\]/);
    const isFromRejectedSnapshotIndex = snapIdxMatch && rejectedSnapshotIndices.has(Number(snapIdxMatch[1]));
    const containsRejectedAsin = Array.from(rejectedSnapshotAsins).some((badAsin) =>
      sourceRefStr.toUpperCase().includes(badAsin)
    );
    const matchesRejectedFact = rejectedSnapshotFactSignatures.has(
      `${cand.field}:${normalizeSpecValue(String(cand.value))}`
    );

    if (
      mappedKind === "amazon_browser_evidence" &&
      (isFromRejectedSnapshotIndex || containsRejectedAsin || matchesRejectedFact)
    ) {
      excludedMaterials.push({
        field: cand.field,
        label: FIELD_CHINESE_LABELS[cand.field] || cand.field,
        value: String(cand.value),
        reason: "来自已被排除的快照或不匹配来源，已拦截",
      });
      return;
    }

    evaluateItem(cand.field, String(cand.value), mappedKind, false);
  };

  for (const item of allCandidates) {
    if (!isRecord(item)) continue;
    processCandidateItem(item);

    if (Array.isArray(item.alternateSources)) {
      for (const alt of item.alternateSources) {
        if (!isRecord(alt) || alt.value === undefined) continue;
        processCandidateItem({
          field: item.field,
          value: alt.value,
          sourceKind: alt.sourceKind,
          sourceRef: alt.sourceRef || item.sourceRef,
        });
      }
    }
  }

  // 记录未采纳的外部资料（1688、买家评论、竞品）
  if (result.sourcingEvidence || result.sourcingSnapshot || (result.agentOutputSnapshot && isRecord(result.agentOutputSnapshot) && result.agentOutputSnapshot.sourcingSnapshot)) {
    excludedMaterials.push({
      field: "sourcing",
      label: "1688货源",
      value: "已有货源线索或报价记录",
      reason: "属于 1688 供应链货源线索，暂不用于当前商品初稿",
    });
  }
  if (result.reviewEvidence || result.vocAnalysis || result.painPoints) {
    excludedMaterials.push({
      field: "voc",
      label: "买家评论与痛点",
      value: "已有买家声音分析记录",
      reason: "属于买家评论声音，暂不作为商品硬属性",
    });
  }
  if (result.competitorEvidence || result.competitors) {
    excludedMaterials.push({
      field: "competitor",
      label: "竞品资料",
      value: "已有竞品 ASIN 资料",
      reason: "属于竞品对比参考，不直接作为本商品规格",
    });
  }

  const adoptedMaterials = Array.from(adoptedMap.values());

  // 计算指纹
  const fingerprintRaw = [
    productName,
    asin || "",
    market,
    ...adoptedMaterials.map((m) => `${m.field}:${m.value}`),
  ].join("|");
  const sourceFingerprint = createHash("sha256").update(fingerprintRaw, "utf8").digest("hex").slice(0, 16);

  // 必须至少有 1 项实质规格属性（非单纯品牌/型号等身份属性）才算 ready
  const substantiveCount = adoptedMaterials.filter((m) => SUBSTANTIVE_FIELDS.has(m.field)).length;
  const status = substantiveCount >= 1 ? "ready" : "insufficient";
  const reason = status === "insufficient"
    ? "当前未提取到符合安全白名单的基础规格资料（缺少颜色/尺寸/包装等客观规格属性）。"
    : undefined;

  return {
    status,
    reason,
    productName,
    market: market === "US" ? "Amazon 美国站" : market,
    asin,
    adoptedCount: adoptedMaterials.length,
    excludedCount: excludedMaterials.length,
    adoptedMaterials,
    excludedMaterials,
    sourceFingerprint,
  };
}
