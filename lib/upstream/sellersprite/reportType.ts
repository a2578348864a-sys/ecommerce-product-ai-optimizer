import {
  mapSellerSpriteHeaders,
  normalizeSellerSpriteField,
  REQUIRED_SELLERSPRITE_FIELDS,
} from "./fields";

export type SellerSpriteReportType = "search_results" | "category_current" | "reverse_asin" | "keyword_mining";
export type SellerSpriteDetectedReportType = SellerSpriteReportType | "unknown";

export interface SellerSpriteReportTypeDetectionEvidence {
  hasSearchRankColumn: boolean;
  hasRootCategoryColumn: boolean;
  hasRootCategoryBsrColumn: boolean;
  hasSubCategoryColumn: boolean;
  hasSubCategoryBsrColumn: boolean;
}

/**
 * unknown 判定的原因码（fail-closed 可解释性）：
 * - missing_required_identity: 缺必需身份列（asin/productTitle/productUrl）
 * - ambiguous_headers: 必需/判定字段存在多列歧义
 * - missing_report_signature: 四件套不齐，无任何报告签名
 * - requires_row_signal: 表头无搜索排名且四件套齐全，但未提供行数据或行内无 BSR 值
 *   （无法自动判定，fail-closed → 人工选择兜底）
 * - ambiguous_ps_without_search_rank: 保留（历史兼容，不再产生）——旧规则下
 *   「无搜索排名 + BSR 含 >10」视为歧义；现规则按 BSR 值域确定性判定
 *   （见 detectSellerSpriteReportType）
 */
export type SellerSpriteReportTypeReasonCode =
  | "missing_required_identity"
  | "ambiguous_headers"
  | "missing_report_signature"
  | "requires_row_signal"
  | "ambiguous_ps_without_search_rank";

export interface SellerSpriteReportTypeDetection {
  reportType: SellerSpriteDetectedReportType;
  evidence: SellerSpriteReportTypeDetectionEvidence;
  /** unknown 时的原因码；成功判定时为 undefined */
  reasonCode?: SellerSpriteReportTypeReasonCode;
}

/**
 * 类目榜单行级信号：真实 Category Current（BSR 当前类目 Top10）报表
 * 的大类 BSR 值域为 [1..10]（12/12 真实样本验证）；真实 Product Search
 * 报表（无搜索排名列的新格式）大类 BSR 无此约束（样本 max=750682）。
 * 值域互斥（CC 榜单不可能出现 >10）→ 含 >10 确定性判定 search_results，
 * 全部 ∈[1..10] 判定 category_current；无行级 BSR 数据时 fail-closed
 * （requires_row_signal），由人工选择兜底。
 */
const CATEGORY_CURRENT_BSR_MAX = 10;

/**
 * 关键词报表（Reverse ASIN / Keyword Mining）表头签名（真实样本验证：
 * ReverseASIN 32 列含「流量词/自然排名/流量占比」；KeywordMining 21 列含
 * 「关键词/相关度/ABA月排名」；两者与 PS/CC 商品报表表头互斥）。
 */
const REVERSE_ASIN_HEADER_SIGNATURE = ["流量词", "自然排名", "流量占比"] as const;
const KEYWORD_MINING_HEADER_SIGNATURE = ["关键词", "相关度", "ABA月排名"] as const;

export type KeywordReportType = "reverse_asin" | "keyword_mining";

function hasAllHeaders(
  headers: ReadonlyArray<string | null>,
  signature: ReadonlyArray<string>,
): boolean {
  const normalized = new Set(headers.map((header) => header?.trim() ?? ""));
  return signature.every((header) => normalized.has(header));
}

export function detectKeywordReportType(
  headers: ReadonlyArray<string | null>,
): KeywordReportType | null {
  if (hasAllHeaders(headers, REVERSE_ASIN_HEADER_SIGNATURE)) return "reverse_asin";
  if (hasAllHeaders(headers, KEYWORD_MINING_HEADER_SIGNATURE)) return "keyword_mining";
  return null;
}

/**
 * 从行数据提取大类 BSR 有效值（与 fields 规范一致：千分位、多值取首个）。
 */
function collectRootCategoryBsrValues(
  rows: ReadonlyArray<ReadonlyArray<string | null>>,
  mapping: ReturnType<typeof mapSellerSpriteHeaders>,
): number[] {
  const index = mapping.fieldIndexes.rootCategoryBsr;
  if (index === undefined) return [];
  const values: number[] = [];
  for (const row of rows) {
    const raw = row[index];
    if (typeof raw !== "string") continue;
    const result = normalizeSellerSpriteField("rootCategoryBsr", raw.trim() === "" ? null : raw);
    const normalized = result.normalized;
    if (normalized === null) continue;
    const first = Array.isArray(normalized) ? normalized[0] : normalized;
    if (typeof first === "number" && Number.isFinite(first)) values.push(first);
  }
  return values;
}

/**
 * 三层判断（10_PHASE1_TASK.md）：
 * 1. 确定性表头特征：含搜索排名列 → search_results（旧格式，确定性）。
 * 2. 行级信号（被真实双样本验证）：无搜索排名 + 四件套齐全时，
 *    大类 BSR 值域 ⊆ [1..10] → category_current。
 * 3. 仍歧义 → fail-closed unknown + reasonCode（绝不静默猜测）。
 *
 * rows 为可选：不提供行数据时，无搜索排名 + 四件套齐全只返回
 * unknown(requires_row_signal)，禁止仅凭表头判定 Category Current。
 */
export function detectSellerSpriteReportType(
  headers: ReadonlyArray<string | null>,
  rows?: ReadonlyArray<ReadonlyArray<string | null>>,
): SellerSpriteReportTypeDetection {
  // 关键词报表（Reverse ASIN / Keyword Mining）优先：表头签名与商品报表互斥，
  // 识别即返回（关键词报表由关键词管线处理，不走 precheck 商品管线）。
  const keywordType = detectKeywordReportType(headers);
  if (keywordType !== null) {
    const mapping = mapSellerSpriteHeaders(headers);
    const has = (field: keyof typeof mapping.fieldIndexes) => (
      mapping.fieldIndexes[field] !== undefined
    );
    return {
      reportType: keywordType,
      evidence: {
        hasSearchRankColumn: has("searchRank"),
        hasRootCategoryColumn: has("rootCategory"),
        hasRootCategoryBsrColumn: has("rootCategoryBsr"),
        hasSubCategoryColumn: has("subCategory"),
        hasSubCategoryBsrColumn: has("subCategoryBsr"),
      },
    };
  }
  const mapping = mapSellerSpriteHeaders(headers);
  const has = (field: keyof typeof mapping.fieldIndexes) => (
    mapping.fieldIndexes[field] !== undefined
  );
  const evidence: SellerSpriteReportTypeDetectionEvidence = {
    hasSearchRankColumn: has("searchRank"),
    hasRootCategoryColumn: has("rootCategory"),
    hasRootCategoryBsrColumn: has("rootCategoryBsr"),
    hasSubCategoryColumn: has("subCategory"),
    hasSubCategoryBsrColumn: has("subCategoryBsr"),
  };
  const hasRequiredIdentity = REQUIRED_SELLERSPRITE_FIELDS.every(has);
  const relevantAmbiguity = mapping.ambiguousFields.some((field) => (
    REQUIRED_SELLERSPRITE_FIELDS.includes(field)
    || field === "searchRank"
    || field === "rootCategory"
    || field === "rootCategoryBsr"
    || field === "subCategory"
    || field === "subCategoryBsr"
  ));
  if (!hasRequiredIdentity) {
    return { reportType: "unknown", evidence, reasonCode: "missing_required_identity" };
  }
  if (relevantAmbiguity) {
    return { reportType: "unknown", evidence, reasonCode: "ambiguous_headers" };
  }
  if (evidence.hasSearchRankColumn) {
    return { reportType: "search_results", evidence };
  }
  const hasCategorySignature = evidence.hasRootCategoryColumn
    && evidence.hasRootCategoryBsrColumn
    && evidence.hasSubCategoryColumn
    && evidence.hasSubCategoryBsrColumn;
  if (!hasCategorySignature) {
    return { reportType: "unknown", evidence, reasonCode: "missing_report_signature" };
  }
  if (rows === undefined || rows.length === 0) {
    return { reportType: "unknown", evidence, reasonCode: "requires_row_signal" };
  }
  const bsrValues = collectRootCategoryBsrValues(rows, mapping);
  if (bsrValues.length === 0) {
    return { reportType: "unknown", evidence, reasonCode: "requires_row_signal" };
  }
  if (bsrValues.every((value) => value >= 1 && value <= CATEGORY_CURRENT_BSR_MAX)) {
    return { reportType: "category_current", evidence };
  }
  // 存在 >10 的大类 BSR：类目榜单（Category Current Top10）的 BSR 必 ∈ [1..10]
  // （12/12 真实样本验证），含 >10 必然不是 CC 榜单 → 无搜索排名列的新格式
  // Product Search 报表（真实 Products(10) 样本 max=750682）。确定性判定，不误判。
  return { reportType: "search_results", evidence };
}
