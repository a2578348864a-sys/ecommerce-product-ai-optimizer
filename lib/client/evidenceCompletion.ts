/**
 * V3 Final Interaction Correction — R7：Research Material Status 统一 Resolver
 *
 * 唯一权威来源（任务 90 节 Authority Matrix）：
 * - 商品基础资料 → candidateAnalysisContext / 商品身份（任务来源数据）
 * - 竞品资料 → competitorEvidence.asins（persisted）
 * - 关键词 → keywordEvidence（persisted；preview 不算）
 * - Amazon 页面 → browserEvidence.snapshots（human confirmed 持久化）
 * - 买家评论 → reviewEvidence.dataset.reviews（persisted）
 * - 供应线索 → sourcingEvidence.humanConfirmed（人工确认持久化）
 *
 * 语义（任务 91 节）：Requirement（REQUIRED/OPTIONAL）× Collection（AVAILABLE/MISSING）
 * - Optional + Missing → "可选"
 * - Optional + Available → "已有"
 * - Required + Missing → "待补"
 * - Required + Available → "已有"
 *
 * 禁止：维护第二套 completion flag；禁止 AI Summary / VOC Analysis 影响 Evidence 存在性。
 */

export type ResearchMaterialItemKey =
  | "productBasics"
  | "competitor"
  | "keyword"
  | "browser"
  | "voc"
  | "sourcing";

export type ResearchMaterialState = "已有" | "待补" | "可选";

export type ResearchMaterialStatus = Record<ResearchMaterialItemKey, ResearchMaterialState>;

export type ResearchMaterialRow = {
  key: ResearchMaterialItemKey;
  label: string;
  state: ResearchMaterialState;
  /** true 表示该资料在产品定义中为可选（可选+缺失 → "可选"；可选+已有 → "已有"） */
  optional: boolean;
};

export const RESEARCH_MATERIAL_ROWS: readonly ResearchMaterialRow[] = [
  { key: "productBasics", label: "商品基础资料", state: "已有", optional: false },
  { key: "competitor", label: "竞品资料", state: "可选", optional: true },
  { key: "keyword", label: "关键词", state: "待补", optional: false },
  { key: "browser", label: "Amazon 页面", state: "待补", optional: false },
  { key: "voc", label: "买家评论", state: "待补", optional: false },
  { key: "sourcing", label: "供应线索", state: "可选", optional: true },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countArrayPath(result: Record<string, unknown>, key: string, path: Array<string>): number {
  const node = result[key];
  if (!isRecord(node)) return 0;
  let current: unknown = node;
  for (const segment of path) {
    if (!isRecord(current)) return 0;
    current = current[segment];
  }
  return Array.isArray(current) ? current.length : 0;
}

function combine(required: boolean, available: boolean): ResearchMaterialState {
  if (available) return "已有";
  return required ? "待补" : "可选";
}

/**
 * 从 Task resultJson 派生"当前研究资料"状态。
 * 只认 persisted/confirmed 数据：preview / draft / search result / 未确认 一律不算已有。
 */
export function deriveResearchMaterialStatus(
  result: Record<string, unknown> | null | undefined,
): ResearchMaterialStatus {
  if (!result) {
    return {
      productBasics: "已有",
      competitor: "可选",
      keyword: "待补",
      browser: "待补",
      voc: "待补",
      sourcing: "可选",
    };
  }
  // 商品基础资料：任务来源身份存在（productUrl / 商品名 / candidateAnalysisContext / sourceMeta）
  const hasProductIdentity = Boolean(
    result.productUrl
    || result.productName
    || (isRecord(result.candidateAnalysisContext) && Object.keys(result.candidateAnalysisContext).length > 0)
    || isRecord(result.sourceMeta),
  );
  const competitorCount = countArrayPath(result, "competitorEvidence", ["asins"]);
  // keywordEvidence 结构为 { schema, reportType, rows }（persisted 报表）
  const keywordCount = countArrayPath(result, "keywordEvidence", ["rows"]);
  const browserCount = countArrayPath(result, "browserEvidence", ["snapshots"]);
  const vocCount = countArrayPath(result, "reviewEvidence", ["dataset", "reviews"]);
  const sourcingCount = countArrayPath(result, "sourcingEvidence", ["humanConfirmed"]);
  return {
    // 商品基础资料 REQUIRED：有来源身份（productUrl / candidateAnalysisContext / sourceMeta）才算已有
    productBasics: combine(true, hasProductIdentity),
    competitor: combine(false, competitorCount > 0),
    keyword: combine(true, keywordCount > 0),
    browser: combine(true, browserCount > 0),
    voc: combine(true, vocCount > 0),
    sourcing: combine(false, sourcingCount > 0),
  };
}
