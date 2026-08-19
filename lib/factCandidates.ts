/**
 * V3 UX Closure — Fact Candidate 提取（Evidence → Fact Candidate）
 *
 * 从已有确定性证据提取「可人工确认的商品事实候选」。安全原则：
 * - 只提取确定性来源（SellerSprite productFacts / browserEvidence / 商品标题派生）；
 * - AI Summary / VOC / Competitor / Sourcing Seller Claims 一律不进入（禁止自动升权）；
 * - 输出永远是 candidate（humanConfirmationRequired=true），只有人工确认后才成为 Confirmed Fact；
 * - 宁缺勿错：来源不支持就不提取，不强制填满字段（动态 Fact Set）。
 *
 * 纯函数：无 DB / 无网络 / 无时间 / 无随机。
 */
import { deriveTitleProductFacts } from "@/lib/titleDerivedProductFacts";

export const FACT_CANDIDATES_SCHEMA = "fact-candidates.v1" as const;
export const FACT_CANDIDATES_VERSION = 1 as const;

export type FactCandidateSourceKind =
  | "seller_sprite_product_facts"
  | "amazon_browser_evidence"
  | "product_title"
  | "human_manual";

export type FactCandidate = {
  candidateId: string;
  field: string;
  label: string;
  value: string | number;
  /** 确定性来源分类（禁止 AI/VOC/competitor/seller claims 升权） */
  sourceKind: FactCandidateSourceKind;
  /** 可追溯来源引用（如 evidenceRef / 字段路径） */
  sourceRef: string;
  humanConfirmationRequired: true;
};

export type ConfirmedFactCandidate = FactCandidate & {
  confirmedAt: string;
  confirmedBy: string;
};

export type FactCandidatesV1 = {
  schema: typeof FACT_CANDIDATES_SCHEMA;
  version: typeof FACT_CANDIDATES_VERSION;
  /** 已确认候选（持久化权威；确认即从候选升级，来源与值保留） */
  confirmed: ConfirmedFactCandidate[];
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayValue(value: unknown): string | number | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function candidateIdFor(field: string, sourceKind: FactCandidateSourceKind): string {
  // 确定性 id：field+source 的稳定指纹（重复提取同一候选可去重）
  return `${sourceKind}:${field}`;
}

const LABELS: Record<string, string> = {
  brand: "品牌",
  product_type: "商品类型",
  series_or_model: "系列/型号",
  capacity: "容量",
  material: "材质",
  dimensions: "尺寸",
  weight: "重量",
  color_or_variant: "颜色/款式",
  quantity_or_pack_size: "数量/包装",
  category: "类目",
  price: "参考价格 (USD)",
  rating: "评分",
  reviews: "评论数",
  bsr: "大类 BSR",
  functional_feature: "功能特性",
  care: "清洁保养",
  construction: "构造",
  included_components: "随附组件",
  operation: "操作方式",
  compatibility: "兼容性",
};

/**
 * 手动补充事实的可选字段注册表（供 [+手动补充商品事实] 下拉使用）。
 * 与既有 canonical fact field 一致；不同商品可只填相关字段（动态 Fact Set）。
 */
export const MANUAL_FACT_FIELDS: ReadonlyArray<{ field: string; label: string }> = [
  { field: "brand", label: "品牌" },
  { field: "product_type", label: "商品类型" },
  { field: "series_or_model", label: "系列/型号" },
  { field: "material", label: "材质" },
  { field: "capacity", label: "容量" },
  { field: "dimensions", label: "尺寸" },
  { field: "weight", label: "重量" },
  { field: "color_or_variant", label: "颜色/款式" },
  { field: "quantity_or_pack_size", label: "数量/包装" },
  { field: "functional_feature", label: "功能特性" },
  { field: "care", label: "清洁保养" },
  { field: "construction", label: "构造" },
  { field: "included_components", label: "随附组件" },
  { field: "operation", label: "操作方式" },
  { field: "compatibility", label: "兼容性" },
];

/** 手动补充事实的确定性 candidateId（sourceKind=human_manual） */
export function humanManualCandidateId(field: string): string {
  return `human_manual:${field}`;
}

/**
 * 从 resultJson 提取 Fact Candidates。
 * @param resultJson 任务 resultJson（含 candidateAnalysisContext / browserEvidence / sourceMeta）
 */
export function extractFactCandidates(resultJson: unknown): FactCandidate[] {
  if (!isRecord(resultJson)) return [];
  const candidates: FactCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: Omit<FactCandidate, "candidateId" | "humanConfirmationRequired">) => {
    // 同字段只保留一个候选（优先级 = 先提取的来源：SellerSprite > browserEvidence > 标题派生），
    // 避免同字段多来源重复（如 reviews：SellerSprite 48110 vs Amazon 48116）。
    if (seen.has(candidate.field)) return;
    seen.add(candidate.field);
    const id = candidateIdFor(candidate.field, candidate.sourceKind);
    candidates.push({ ...candidate, candidateId: id, humanConfirmationRequired: true });
  };

  // 1) SellerSprite productFacts（sourceMeta.productBatchSnapshot 或 candidateAnalysisContext.facts）
  let productFacts: Record<string, unknown> | null = null;
  const sourceMeta = isRecord(resultJson.sourceMeta) ? resultJson.sourceMeta : null;
  const batchSnapshot = sourceMeta && isRecord(sourceMeta.productBatchSnapshot)
    ? sourceMeta.productBatchSnapshot
    : null;
  if (batchSnapshot && isRecord(batchSnapshot.productFacts)) {
    productFacts = batchSnapshot.productFacts;
  } else {
    const cac = isRecord(resultJson.candidateAnalysisContext) ? resultJson.candidateAnalysisContext : null;
    const cacFacts = cac && isRecord(cac.facts) ? cac.facts : null;
    if (cacFacts && isRecord(cacFacts.productFacts)) productFacts = cacFacts.productFacts;
  }
  if (productFacts) {
    const brand = displayValue(productFacts.brand);
    if (brand) push({ field: "brand", label: LABELS.brand, value: brand, sourceKind: "seller_sprite_product_facts", sourceRef: "seller_sprite.productFacts.brand" });
    const category = displayValue(productFacts.rootCategory) ?? displayValue(productFacts.subCategory);
    if (category) push({ field: "category", label: LABELS.category, value: category, sourceKind: "seller_sprite_product_facts", sourceRef: "seller_sprite.productFacts.rootCategory" });
    const price = displayValue(productFacts.price);
    if (price !== null) push({ field: "price", label: LABELS.price, value: price, sourceKind: "seller_sprite_product_facts", sourceRef: "seller_sprite.productFacts.price" });
    const rating = displayValue(productFacts.rating);
    if (rating !== null) push({ field: "rating", label: LABELS.rating, value: rating, sourceKind: "seller_sprite_product_facts", sourceRef: "seller_sprite.productFacts.rating" });
    const reviews = displayValue(productFacts.reviews);
    if (reviews !== null) push({ field: "reviews", label: LABELS.reviews, value: reviews, sourceKind: "seller_sprite_product_facts", sourceRef: "seller_sprite.productFacts.reviews" });
    const bsr = displayValue(productFacts.rootCategoryBsr);
    if (bsr !== null) push({ field: "bsr", label: LABELS.bsr, value: bsr, sourceKind: "seller_sprite_product_facts", sourceRef: "seller_sprite.productFacts.rootCategoryBsr" });
    // capacity 派生：标题含 "12oz" 等明确单位
    const title = displayValue(productFacts.productTitle);
    if (typeof title === "string") {
      const capacityMatch = title.match(/(\d+(?:\.\d+)?)\s*(oz|ml|l)\b/i);
      if (capacityMatch) {
        push({ field: "capacity", label: LABELS.capacity, value: `${capacityMatch[1]}${capacityMatch[2].toLowerCase()}`, sourceKind: "seller_sprite_product_facts", sourceRef: "seller_sprite.productFacts.productTitle" });
      }
    }
  }

  // 2) 商品标题派生（复用既有 titleDerivedProductFacts：material/capacity/color/quantity/product_type/series）
  //    标题优先级：Amazon 页面完整标题（browserEvidence）> SellerSprite productTitle > sourceMeta 快照
  let titleForDerivation: string | null = null;
  const browserTitle = (() => {
    const b = isRecord(resultJson.browserEvidence) ? resultJson.browserEvidence : null;
    const s = b && Array.isArray(b.snapshots) && b.snapshots.length > 0 ? b.snapshots[0] : null;
    if (!isRecord(s) || !isRecord(s.fields) || !isRecord(s.fields.title)) return null;
    const t = s.fields.title.value;
    return typeof t === "string" && t.trim() ? t.trim() : null;
  })();
  if (browserTitle) {
    titleForDerivation = browserTitle;
  } else if (productFacts && typeof displayValue(productFacts.productTitle) === "string") {
    titleForDerivation = displayValue(productFacts.productTitle) as string;
  } else {
    const sourceMeta2 = isRecord(resultJson.sourceMeta) ? resultJson.sourceMeta : null;
    const candidateSnapshot = sourceMeta2 && isRecord(sourceMeta2.candidateSnapshot)
      ? sourceMeta2.candidateSnapshot
      : null;
    const name = candidateSnapshot && typeof candidateSnapshot.productName === "string"
      ? candidateSnapshot.productName.trim()
      : "";
    if (name) titleForDerivation = name;
  }
  if (titleForDerivation) {
    const derived = deriveTitleProductFacts({ title: titleForDerivation });
    for (const fact of derived.facts ?? []) {
      push({
        field: fact.field,
        label: LABELS[fact.field] ?? fact.label,
        value: fact.value,
        sourceKind: "product_title",
        sourceRef: "product_title.derived",
      });
    }
  }

  // 3) browserEvidence（Amazon 页面观察：price/rating/reviews/bsr——与 productFacts 去重后补充）
  const browser = isRecord(resultJson.browserEvidence) ? resultJson.browserEvidence : null;
  const snapshot = browser && Array.isArray(browser.snapshots) && browser.snapshots.length > 0
    ? browser.snapshots[0]
    : null;
  if (isRecord(snapshot) && isRecord(snapshot.fields)) {
    const fields = snapshot.fields;
    const price = displayValue(isRecord(fields.price) ? fields.price.value : null);
    if (price !== null) push({ field: "price", label: LABELS.price, value: price, sourceKind: "amazon_browser_evidence", sourceRef: "browserEvidence.snapshots[0].fields.price" });
    const rating = displayValue(isRecord(fields.rating) ? fields.rating.value : null);
    if (rating !== null) push({ field: "rating", label: LABELS.rating, value: rating, sourceKind: "amazon_browser_evidence", sourceRef: "browserEvidence.snapshots[0].fields.rating" });
    const reviewCount = displayValue(isRecord(fields.reviewCount) ? fields.reviewCount.value : null);
    if (reviewCount !== null) push({ field: "reviews", label: LABELS.reviews, value: reviewCount, sourceKind: "amazon_browser_evidence", sourceRef: "browserEvidence.snapshots[0].fields.reviewCount" });
    const bsr = displayValue(isRecord(fields.bsr) ? fields.bsr.value : null);
    if (bsr !== null) push({ field: "bsr", label: LABELS.bsr, value: bsr, sourceKind: "amazon_browser_evidence", sourceRef: "browserEvidence.snapshots[0].fields.bsr" });
  }

  return candidates;
}

/** 从 resultJson 读取已确认事实候选（factCandidates namespace） */
export function getFactCandidates(resultJson: unknown): FactCandidatesV1 | null {
  if (!isRecord(resultJson)) return null;
  const raw = resultJson.factCandidates;
  if (!isRecord(raw) || raw.schema !== FACT_CANDIDATES_SCHEMA) return null;
  if (!Array.isArray(raw.confirmed)) return null;
  const confirmed: ConfirmedFactCandidate[] = [];
  for (const item of raw.confirmed) {
    if (!isRecord(item)) return null;
    if (typeof item.candidateId !== "string" || typeof item.field !== "string") return null;
    if (typeof item.label !== "string" || !(typeof item.value === "string" || typeof item.value === "number")) return null;
    if (typeof item.sourceKind !== "string" || typeof item.sourceRef !== "string") return null;
    if (typeof item.confirmedAt !== "string" || typeof item.confirmedBy !== "string") return null;
    confirmed.push(item as unknown as ConfirmedFactCandidate);
  }
  return {
    schema: FACT_CANDIDATES_SCHEMA,
    version: FACT_CANDIDATES_VERSION,
    confirmed,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
  };
}

/** 合并视图：候选（未确认）+ 已确认（权威持久化） */
export function buildFactCandidateView(
  resultJson: unknown,
): { candidates: FactCandidate[]; confirmed: ConfirmedFactCandidate[] } {
  const extracted = extractFactCandidates(resultJson);
  const stored = getFactCandidates(resultJson);
  const confirmedMap = new Map((stored?.confirmed ?? []).map((item) => [item.candidateId, item]));
  const candidates = extracted.filter((candidate) => !confirmedMap.has(candidate.candidateId));
  return { candidates, confirmed: stored?.confirmed ?? [] };
}
