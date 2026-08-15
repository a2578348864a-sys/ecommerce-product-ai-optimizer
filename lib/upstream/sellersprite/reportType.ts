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
 * 仅供「辅助诊断建议」（见 productBatchImportService 的 reportTypeHints），
 * 不参与 reportType 自动判定。
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
 * 分类优先级（Core-Smoke-Fix.1 复核）：
 * deterministic unique structure → validated multi-signal → ambiguous/unknown → manual fallback
 *
 * 1. 确定性结构：含搜索排名列 → search_results（旧格式，表头唯一签名）。
 * 2. 关键词报表表头签名（Reverse ASIN / Keyword Mining）→ 关键词管线（互斥签名）。
 * 3. 无搜索排名列 + 四件套齐全：CC（Category Current）与 PS（Product Search 新格式）
 *    表头完全相同（真实 72 列样本验证），不存在任何确定性结构差异；
 *    行级 BSR 值域未经官方合同证明（存在 Top100/Top400/加载更多导出场景，
 *    CC BSR 可 >10），不得作为单点判别 → 一律 fail-closed unknown，
 *    由人工选择兜底（UI 提供多信号辅助建议，见 productBatchImportService）。
 *
 * rows 为可选：不提供行数据时同样 fail-closed（requires_row_signal）。
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
  // CC 与 PS 新格式在结构上不可区分（表头/列组合/工作表完全一致），
  // 行级 BSR 值域仅作辅助诊断（UI 建议），不参与 reportType 判定 →
  // 一律 fail-closed，人工选择兜底（不允许以未证明的 BSR≤10 合同做单点自动判定）。
  return { reportType: "unknown", evidence, reasonCode: "ambiguous_ps_without_search_rank" };
}
