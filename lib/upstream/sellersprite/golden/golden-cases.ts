/**
 * Golden Dataset — 用例清单（30 增强 Phase 1）。
 * 每个用例：识别结果预期 + 是否 fail-closed + 判定依据说明。
 */
import {
  GOLDEN_CC_BSR_BEYOND_BAND_ROWS,
  GOLDEN_CC_CURRENT_ROWS,
  GOLDEN_CURRENT_FORMAT_HEADERS,
  GOLDEN_PS_LEGACY_HEADERS,
  GOLDEN_PS_NO_SEARCH_RANK_ROWS,
  GOLDEN_PS_PARTIAL_CATEGORY_HEADERS,
  GOLDEN_UNSIGNED_HEADERS,
  goldenRowToValues,
} from "./golden-fixtures";
import type { SellerSpriteDetectedReportType } from "../reportType";
import type { SellerSpriteReportTypeReasonCode } from "../reportType";
import type { SellerSpriteReportType } from "../reportType";

export type GoldenReportCase = {
  id: string;
  name: string;
  note: string;
  headers: ReadonlyArray<string>;
  /** 行级 values（可选：不提供时验证「仅表头不可自动判定」路径） */
  rows?: ReadonlyArray<ReadonlyArray<string | null>>;
  /** 自动判定预期（无显式 expectedReportType 时） */
  expectedDetected: SellerSpriteDetectedReportType;
  expectedReasonCode?: SellerSpriteReportTypeReasonCode;
  /** precheck 集成层是否断言 reasonCode（unsupported_sheet 提前返回的用例设为 false） */
  precheckReasonCode?: boolean;
  /** precheck 集成层预期的阻断错误码（默认 unsupported_report_type） */
  precheckErrorCode?: string;
  /** 显式选择预期（提供 expectedReportType 时） */
  expectedWithExplicit?: SellerSpriteReportType;
  /** 显式选择与强证据冲突 → 预期 mismatch 拒绝 */
  expectedExplicitMismatch?: boolean;
};

export const GOLDEN_REPORT_CASES: ReadonlyArray<GoldenReportCase> = [
  {
    id: "ps-legacy",
    name: "旧格式 Product Search（含搜索排名列）",
    note: "旧导出格式含「搜索排名」列 → 表头确定性签名判定 search_results",
    headers: [...GOLDEN_PS_LEGACY_HEADERS],
    expectedDetected: "search_results",
  },
  {
    id: "ps-no-search-rank",
    name: "新格式 Product Search（无搜索排名列，BSR 大值域非升序）",
    note: "真实 Products(10) 模式：无搜索排名列、rootBsr max=750682、非升序、多类目。CC 与 PS 新格式表头完全相同，无确定性结构信号；BSR 值域未经合同证明（Top100/加载更多导出可 >10），不得单点判定 → fail-closed，人工选择",
    headers: [...GOLDEN_CURRENT_FORMAT_HEADERS],
    rows: GOLDEN_PS_NO_SEARCH_RANK_ROWS.map((row) => goldenRowToValues(row, GOLDEN_CURRENT_FORMAT_HEADERS)),
    expectedDetected: "unknown",
    expectedReasonCode: "ambiguous_ps_without_search_rank",
  },
  {
    id: "cc-current",
    name: "新格式 Category Current（BSR 类目榜，值域 1..10）",
    note: "真实 BSR(...Current) 模式：rootBsr ∈ [1..10]。结构上仍与 PS 新格式完全相同，BSR 值域不作单点判定 → fail-closed，人工选择；显式选择 category_current 放行（结构合法）",
    headers: [...GOLDEN_CURRENT_FORMAT_HEADERS],
    rows: GOLDEN_CC_CURRENT_ROWS.map((row) => goldenRowToValues(row, GOLDEN_CURRENT_FORMAT_HEADERS)),
    expectedDetected: "unknown",
    expectedReasonCode: "ambiguous_ps_without_search_rank",
    expectedWithExplicit: "category_current",
  },
  {
    id: "cc-bsr-beyond-band",
    name: "Category Current 对抗样本（BSR 11..100，Top100/加载更多导出场景）",
    note: "脱敏模拟 CC Top100 导出：单一大类目、BSR 11..100（>10）、月销高、Best Seller 多 → 不得因 BSR 数值 >10 误判为 Product Search，必须 fail-closed",
    headers: [...GOLDEN_CURRENT_FORMAT_HEADERS],
    rows: GOLDEN_CC_BSR_BEYOND_BAND_ROWS.map((row) => goldenRowToValues(row, GOLDEN_CURRENT_FORMAT_HEADERS)),
    expectedDetected: "unknown",
    expectedReasonCode: "ambiguous_ps_without_search_rank",
  },
  {
    id: "cc-with-ties",
    name: "Category Current 含并列名次（3,3,5,5）",
    note: "真实并列 BSR：判定不依赖排序形态；无搜索排名 → fail-closed（结构无确定性信号）",
    headers: [...GOLDEN_CURRENT_FORMAT_HEADERS],
    rows: GOLDEN_CC_CURRENT_ROWS.slice(0, 6).map((row) => goldenRowToValues(row, GOLDEN_CURRENT_FORMAT_HEADERS)),
    expectedDetected: "unknown",
    expectedReasonCode: "ambiguous_ps_without_search_rank",
  },
  {
    id: "cc-headers-only",
    name: "Category Current 表头但无行数据",
    note: "仅表头（PS/CC 表头相同）无法证明类型 → fail-closed，禁止仅凭表头判 CC",
    headers: [...GOLDEN_CURRENT_FORMAT_HEADERS],
    expectedDetected: "unknown",
    expectedReasonCode: "requires_row_signal",
  },
  {
    id: "ps-partial-category",
    name: "含搜索排名列但类目列不全",
    note: "搜索排名列是 PS 确定性签名；类目列缺失不影响（旧格式）",
    headers: [...GOLDEN_PS_PARTIAL_CATEGORY_HEADERS],
    expectedDetected: "search_results",
  },
  {
    id: "unsigned",
    name: "无任何报告签名（无搜索排名、无四件套）",
    note: "缺签名 → fail-closed",
    headers: [...GOLDEN_UNSIGNED_HEADERS],
    expectedDetected: "unknown",
    expectedReasonCode: "missing_report_signature",
  },
  {
    id: "missing-identity",
    name: "缺必需身份列",
    note: "缺 asin/productTitle/productUrl → fail-closed（precheck 层由 unsupported_sheet 兜底，detect 层报 missing_required_identity）",
    headers: ["#", "大类目", "大类BSR", "小类目", "小类BSR"],
    expectedDetected: "unknown",
    expectedReasonCode: "missing_required_identity",
    precheckReasonCode: false,
    precheckErrorCode: "unsupported_sheet",
  },
  {
    id: "ps-no-search-rank-explicit",
    name: "新格式 Product Search + 显式人工选择 search_results",
    note: "自动判定 fail-closed（无确定性结构信号）；人工显式选择 search_results 放行（结构合法），检测证据如实保留",
    headers: [...GOLDEN_CURRENT_FORMAT_HEADERS],
    rows: GOLDEN_PS_NO_SEARCH_RANK_ROWS.map((row) => goldenRowToValues(row, GOLDEN_CURRENT_FORMAT_HEADERS)),
    expectedDetected: "unknown",
    expectedReasonCode: "ambiguous_ps_without_search_rank",
    expectedWithExplicit: "search_results",
  },
  {
    id: "cc-explicit-conflict",
    name: "无搜索排名 + 显式选择 search_results（无强证据，结构合法放行）",
    note: "新规则下无搜索排名报表无任何确定性结构信号（BSR 值域不作单点判定）→ 自动 fail-closed；人工显式选择 search_results 结构合法即放行（matched=true），不产生 report_type_mismatch",
    headers: [...GOLDEN_CURRENT_FORMAT_HEADERS],
    rows: GOLDEN_CC_CURRENT_ROWS.map((row) => goldenRowToValues(row, GOLDEN_CURRENT_FORMAT_HEADERS)),
    expectedDetected: "unknown",
    expectedReasonCode: "ambiguous_ps_without_search_rank",
    expectedWithExplicit: "search_results",
  },
];
