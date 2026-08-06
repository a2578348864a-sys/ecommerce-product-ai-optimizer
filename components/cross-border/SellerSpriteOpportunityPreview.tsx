"use client";

import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  FileSpreadsheet,
  Filter,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TableProperties,
  Upload,
} from "lucide-react";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { AMAZON_US_TOP_LEVEL_CATEGORIES } from "@/lib/productBatchPresentation";
import type {
  SellerSpriteOpportunityPreviewViewModel,
  SellerSpritePreviewProduct,
  SellerSpritePreviewRankingProduct,
} from "@/lib/sellerSpriteOpportunityPreview";

type AccessState = "checking" | "authorized" | "denied";
type PriceBandFilter = "all" | SellerSpritePreviewProduct["priceBandStatus"];
type SignalFilter = "all" | "missing" | "conflict" | "complete";
type ProductSort = "asin" | "price" | "sales" | "reviews";
type RankingView = "products" | "families";
type RankingPriorityFilter =
  | "all"
  | SellerSpritePreviewRankingProduct["researchPriority"];
type RankingEvidenceFilter =
  | "all"
  | SellerSpritePreviewRankingProduct["evidenceStatus"];
type RankingConflictFilter = "all" | "with_conflict" | "without_conflict";
type RankingRepresentativeFilter = "all" | "representative" | "member";
type RankingSort = "signalScore" | "evidenceCoverage" | "price" | "sales" | "reviews";

interface PreviewFormValues {
  file: File | null;
  reportType: "" | "search_results" | "category_current";
  query: string;
  category: string;
  priceMin: string;
  priceMax: string;
}

interface PreviewFormValidation {
  ok: boolean;
  message: string | null;
}

const API_PATH = "/api/opportunities/sellersprite-preview";
const ERROR_COPY: Record<string, string> = {
  owner_required: "仅管理员可使用此本地预览。请先用管理员身份登录。",
  origin_not_allowed: "请求来源校验失败，请从当前本地页面重新发起。",
  missing_file: "请选择一个 SellerSprite 官方 .xlsx 文件。",
  unsupported_file_extension: "仅支持单个 .xlsx 文件，不能上传目录或其他格式。",
  file_too_large: "文件超过 10 MiB，请换用更小的 SellerSprite 官方导出文件。",
  report_type_required: "请选择关键词搜索报表或类目当前商品报表。",
  unsupported_report_type: "当前不支持所选 SellerSprite 报表类型。",
  report_type_mismatch: "所选报表类型与文件结构不一致，请确认文件来源。",
  query_not_applicable: "类目当前商品报表不需要查询词。",
  client_computed_ranking_not_allowed: "预览请求包含不允许的客户端排序字段，请刷新页面后重试。",
  unsafe_xlsx: "文件未通过 XLSX 安全门禁，未继续解析。",
  unsupported_sheet: "没有识别到受支持的 SellerSprite US 商品工作表。",
  invalid_workbook: "工作簿结构或字段不符合当前离线预检合同。",
  brief_validation_failed: "请检查查询词、类目与 USD 价格范围。",
  no_accepted_rows: "文件中没有可用于预览的有效商品行。",
  ranking_integrity_failed: "市场排序未通过服务端完整性检查，本次没有返回部分结果。",
  internal_error: "本地预览生成失败，请核对文件后重试。",
};

export function validateSellerSpritePreviewForm(
  values: PreviewFormValues,
): PreviewFormValidation {
  if (!values.file) return { ok: false, message: ERROR_COPY.missing_file };
  if (
    values.file.name.includes("/")
    || values.file.name.includes("\\")
    || !values.file.name.toLowerCase().endsWith(".xlsx")
  ) {
    return { ok: false, message: ERROR_COPY.unsupported_file_extension };
  }
  if (values.file.size === 0) return { ok: false, message: "文件为空，无法生成预览。" };
  if (values.file.size > 10 * 1024 * 1024) {
    return { ok: false, message: ERROR_COPY.file_too_large };
  }
  if (!values.reportType) return { ok: false, message: ERROR_COPY.report_type_required };
  if (values.reportType === "search_results" && !values.query.trim()) {
    return { ok: false, message: "请输入市场查询词。" };
  }
  if (values.reportType === "category_current" && values.query.trim()) {
    return { ok: false, message: "类目当前商品报表不需要查询词。" };
  }
  if (!values.category.trim()) return { ok: false, message: "请输入商品类目。" };
  const numberPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
  if (!numberPattern.test(values.priceMin.trim()) || !numberPattern.test(values.priceMax.trim())) {
    return { ok: false, message: "USD 价格必须是非负数字。" };
  }
  const minimum = Number(values.priceMin);
  const maximum = Number(values.priceMax);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
    return { ok: false, message: "最低价不能高于最高价。" };
  }
  return { ok: true, message: null };
}

export function filterAndSortSellerSpritePreviewProducts(
  products: ReadonlyArray<SellerSpritePreviewProduct>,
  priceBand: PriceBandFilter,
  signal: SignalFilter,
  sort: ProductSort,
): SellerSpritePreviewProduct[] {
  const filtered = products.filter((product) => {
    const matchesPrice = priceBand === "all" || product.priceBandStatus === priceBand;
    const matchesSignal = signal === "all"
      || (signal === "missing" && product.missingSignals.length > 0)
      || (signal === "conflict" && product.conflictingSignals.length > 0)
      || (
        signal === "complete"
        && product.missingSignals.length === 0
        && product.conflictingSignals.length === 0
      );
    return matchesPrice && matchesSignal;
  });
  return [...filtered].sort((left, right) => {
    if (sort === "asin") return left.asin.localeCompare(right.asin);
    const leftValue = sort === "price"
      ? left.price
      : sort === "sales"
        ? left.estimatedMonthlySales
        : left.reviews;
    const rightValue = sort === "price"
      ? right.price
      : sort === "sales"
        ? right.estimatedMonthlySales
        : right.reviews;
    if (leftValue === null && rightValue === null) return left.asin.localeCompare(right.asin);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return rightValue - leftValue || left.asin.localeCompare(right.asin);
  });
}

function formatNumber(value: number | null): string {
  return value === null ? "缺失" : new Intl.NumberFormat("zh-CN").format(value);
}

function formatBsr(value: number | ReadonlyArray<number> | null): string {
  if (value === null) return "缺失";
  if (Array.isArray(value)) return value.map((item) => formatNumber(item)).join(" / ");
  return formatNumber(value as number);
}

function formatUsd(value: number | null): string {
  return value === null
    ? "缺失"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatShare(value: number | null): string {
  return value === null ? "缺失" : `${(value * 100).toFixed(1)}%`;
}

function priceBandLabel(status: SellerSpritePreviewProduct["priceBandStatus"]): string {
  return {
    within: "价格带内",
    outside: "价格带外",
    missing: "价格缺失",
    conflict: "价格冲突",
  }[status];
}

function dispositionLabel(value: SellerSpritePreviewProduct["provisionalDisposition"]): string {
  return {
    provisional_score_only: "仅兼容性预览",
    insufficient_hard_gate_evidence: "缺硬门禁证据",
    conflicting_provider_metrics: "供应商指标冲突",
    insufficient_required_signals: "必需信号不足",
  }[value];
}

function SummaryCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="surface-card-soft p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p> : null}
    </div>
  );
}

function NumericSummaryCard({
  label,
  summary,
  currency = false,
}: {
  label: string;
  summary: SellerSpriteOpportunityPreviewViewModel["productWeightedStatistics"]["price"];
  currency?: boolean;
}) {
  const formatter = currency ? formatUsd : formatNumber;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <span className="status-badge px-2 py-1 text-[11px]">
          有效 {summary.validCount} · 缺失 {summary.missingCount}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-slate-400">最小</dt>
          <dd className="mt-1 font-semibold text-slate-700">{formatter(summary.minimum)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">中位数</dt>
          <dd className="mt-1 font-semibold text-teal-700">{formatter(summary.median)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">最大</dt>
          <dd className="mt-1 font-semibold text-slate-700">{formatter(summary.maximum)}</dd>
        </div>
      </dl>
      {summary.conflictCount > 0 ? (
        <p className="mt-3 text-xs font-medium text-amber-700">冲突 {summary.conflictCount} 项，未计入统计。</p>
      ) : null}
    </div>
  );
}

function SafetyRail({ data }: { data?: SellerSpriteOpportunityPreviewViewModel }) {
  const checks = [
    "第三方估算数据",
    "非权威",
    "不可晋级",
    "未运行正式 Stage 1",
    "未写数据库",
    "未注册 Manifest",
  ];
  return (
    <section
      className="rounded-2xl border border-teal-200 bg-teal-50/70 p-4"
      aria-label="只读安全轨道"
      data-testid="safety-rail"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-teal-900">
          <ShieldCheck className="size-4" />
          安全轨道
        </span>
        {checks.map((check) => (
          <span
            key={check}
            className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-white px-2.5 py-1 text-xs font-semibold text-teal-800"
          >
            <CheckCircle2 className="size-3.5" />
            {check}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs leading-5 text-teal-700">
        SellerSprite 指标仅作本地市场预筛证据；结果不等于正式选品结论。
        {data ? ` 当前请求 ${data.requestId.slice(0, 8)} 已确认全部生产影响标志为 false。` : ""}
      </p>
    </section>
  );
}

function ConcentrationCard({
  title,
  data,
}: {
  title: string;
  data: SellerSpriteOpportunityPreviewViewModel["brandConcentration"];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <span className="status-badge px-2 py-1 text-[11px]">
          {data.status === "available" ? "官方聚合表可用" : data.status === "missing" ? "官方聚合表缺失" : "官方聚合表无效"}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-slate-400">Top 1</dt>
          <dd className="mt-1 truncate font-semibold text-slate-800">{data.topEntity ?? "缺失"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Top 1 份额</dt>
          <dd className="mt-1 font-semibold text-slate-800">{formatShare(data.topShare)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Top 3 份额</dt>
          <dd className="mt-1 font-semibold text-slate-800">{formatShare(data.top3Share)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">实体数</dt>
          <dd className="mt-1 font-semibold text-slate-800">{data.entityCount}</dd>
        </div>
      </dl>
    </div>
  );
}

function formatScore(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function formatCoverage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function researchPriorityLabel(
  value: SellerSpritePreviewRankingProduct["researchPriority"],
): string {
  return {
    priority_1: "优先研究组 1",
    priority_2: "优先研究组 2",
    priority_3: "优先研究组 3",
    unranked_insufficient_evidence: "暂不排名：证据不足",
  }[value];
}

function evidenceStatusLabel(
  value: SellerSpritePreviewRankingProduct["evidenceStatus"],
): string {
  return {
    sufficient_for_comparison: "证据可比较",
    limited_evidence: "证据有限",
    insufficient_evidence: "证据不足",
  }[value];
}

const RANKING_REASON_LABELS: Readonly<Record<string, string>> = {
  best_available_non_authoritative_evidence: "当前非权威证据中最适合作为该研究分组代表",
  estimated_monthly_sales_at_or_above_report_midpoint: "估算月销量不低于本报表中位水平",
  estimated_monthly_sales_below_report_midpoint: "估算月销量低于本报表中位水平",
  multiple_variations_context_only_no_score: "变体较多，仅作上下文，不参与计分",
  organic_and_sponsored_coverage: "同时具备自然位与广告位记录",
  organic_visibility_observed: "观察到有效自然搜索位置",
  organic_visibility_zero_with_sponsored_evidence: "只有广告位，自然位信号为 0",
  placement_coverage_limited: "搜索位置覆盖有限",
  price_outside_brief_range: "价格在 Brief 目标区间外",
  price_within_brief_range: "价格在 Brief 目标区间内",
  rating_quality_limited: "评分质量支持有限",
  rating_quality_supported: "评分质量有评论量支持",
  root_category_bsr_comparable: "大类 BSR 可比较",
  sales_review_efficiency_at_or_above_neutral: "估算销量—评论相对效率不低于中性水平",
  sales_review_efficiency_below_neutral: "估算销量—评论相对效率低于中性水平",
  sponsored_only_visibility: "仅观察到广告曝光位置",
  subcategory_bsr_comparable_within_exact_group: "同一小类内的小类 BSR 可比较",
  subcategory_bsr_not_comparable: "小类 BSR 证据不足，未跨小类比较",
};

function rankingReasonLabel(reason: string): string {
  return RANKING_REASON_LABELS[reason] ?? reason.replaceAll("_", " · ");
}

function RankingProductDetails({
  product,
}: {
  product: SellerSpritePreviewRankingProduct;
}) {
  return (
    <details className="min-w-[250px] rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-teal-700">展开详情</summary>
      <div className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
        <div className="grid gap-2 sm:grid-cols-3">
          <p>
            <span className="block text-slate-400">已知证据条件分（不用于排名）</span>
            <strong className="text-slate-700">{formatScore(product.conditionalSignalScore)}</strong>
          </p>
          <p>
            <span className="block text-slate-400">证据不完整差额</span>
            <strong className="text-slate-700">{formatScore(product.coveragePenalty)}</strong>
          </p>
          <p>
            <span className="block text-slate-400">可用权重 / 已得加权分</span>
            <strong className="text-slate-700">
              {product.availableWeight} / {formatScore(product.earnedWeightedPoints)}
            </strong>
          </p>
        </div>
        <p className="rounded-lg bg-white px-2.5 py-2 text-slate-500">
          证据不完整差额是条件分与固定分母市场信号分之间的差值，仅用于解释证据完整度。
        </p>
        {product.dominanceWarning ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 font-medium text-amber-800">
            该商品分数可能由单一组件主导，请展开查看。
          </p>
        ) : null}
        <div>
          <p className="font-semibold text-slate-700">组件分解</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {product.componentScores.map((component) => (
              <div key={component.component} className="rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-slate-700">{component.label}</span>
                  <span className="font-mono text-slate-500">
                    {component.available ? formatScore(component.weightedPoints) : "不可用"}
                    {" / "}
                    {component.weight}
                  </span>
                </div>
                <p className="mt-1 text-slate-500">{component.explanation}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {component.metricNature === "estimate"
                    ? "第三方估算"
                    : component.metricNature === "derived"
                      ? "派生信号"
                      : "时点快照"}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <p className="font-semibold text-emerald-700">正向理由</p>
            <p>
              {product.positiveReasons.length
                ? product.positiveReasons.map(rankingReasonLabel).join("；")
                : "暂无明确正向理由"}
            </p>
          </div>
          <div>
            <p className="font-semibold text-amber-700">主要反例</p>
            <p>
              {product.counterSignals.length
                ? product.counterSignals.map(rankingReasonLabel).join("；")
                : "暂无已计算反例"}
            </p>
          </div>
        </div>
        {product.missingSignals.length || product.conflictingSignals.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-800">
            <p>缺失信号：{product.missingSignals.join("、") || "无"}</p>
            <p>冲突信号：{product.conflictingSignals.join("、") || "无"}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function RankingProductTable({
  products,
  sourceByAsin,
  rankable,
}: {
  products: ReadonlyArray<SellerSpritePreviewRankingProduct>;
  sourceByAsin: ReadonlyMap<string, SellerSpritePreviewProduct>;
  rankable: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="min-w-[1040px] w-full border-collapse text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
          <tr>
            <th className="px-3 py-3">{rankable ? "名次" : "状态"}</th>
            <th className="px-3 py-3">商品</th>
            <th className="px-3 py-3">市场信号分</th>
            <th className="px-3 py-3">证据覆盖度</th>
            <th className="px-3 py-3">研究优先级</th>
            <th className="px-3 py-3">研究说明</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {products.map((product) => {
            const source = sourceByAsin.get(product.asin);
            return (
              <tr key={product.asin} className="align-top">
                <td className="px-3 py-3">
                  {rankable ? (
                    <span className="inline-flex min-w-8 items-center justify-center rounded-full bg-teal-50 px-2 py-1 font-semibold text-teal-800">
                      {product.scoreRank}
                      {product.scoreTie ? "=" : ""}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                      未排名
                    </span>
                  )}
                </td>
                <td className="max-w-[260px] px-3 py-3">
                  <p className="font-mono text-xs font-semibold text-teal-700">{product.asin}</p>
                  <p className="mt-1 line-clamp-2 font-medium text-slate-800">
                    {product.title ?? "标题缺失"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {product.brand ?? "品牌缺失"} · {formatUsd(source?.price ?? null)}
                  </p>
                  {product.familyRepresentative ? (
                    <span className="mt-2 inline-flex rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] text-teal-700">
                      家族代表
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <p className="text-xl font-semibold tracking-tight text-slate-950">
                    {rankable ? formatScore(product.signalScore) : "—"}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">固定 100 分母</p>
                </td>
                <td className="px-3 py-3">
                  <p className="font-semibold text-slate-800">{formatCoverage(product.evidenceCoverage)}</p>
                  <p className="mt-1 max-w-[170px] text-[11px] leading-4 text-slate-400">
                    表示本模型预期信号中实际可计算的比例。
                  </p>
                </td>
                <td className="px-3 py-3">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${
                    rankable
                      ? "border-teal-200 bg-teal-50 text-teal-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}>
                    {researchPriorityLabel(product.researchPriority)}
                  </span>
                  <p className="mt-2 text-xs text-slate-500">
                    {evidenceStatusLabel(product.evidenceStatus)}
                  </p>
                </td>
                <td className="px-3 py-3"><RankingProductDetails product={product} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {products.length === 0 ? (
        <div className="bg-white px-4 py-8 text-center text-sm text-slate-500">
          当前筛选条件下暂无商品。
        </div>
      ) : null}
    </div>
  );
}

function SellerSpriteRankingPreview({
  data,
}: {
  data: SellerSpriteOpportunityPreviewViewModel;
}) {
  const [view, setView] = useState<RankingView>("products");
  const [priority, setPriority] = useState<RankingPriorityFilter>("all");
  const [evidence, setEvidence] = useState<RankingEvidenceFilter>("all");
  const [conflict, setConflict] = useState<RankingConflictFilter>("all");
  const [representative, setRepresentative] = useState<RankingRepresentativeFilter>("all");
  const [rankingSort, setRankingSort] = useState<RankingSort>("signalScore");
  const sourceByAsin = useMemo(
    () => new Map(data.products.map((product) => [product.asin, product])),
    [data.products],
  );
  const visibleRankingProducts = useMemo(() => {
    const products = data.ranking.products.filter((product) => (
      (priority === "all" || product.researchPriority === priority)
      && (evidence === "all" || product.evidenceStatus === evidence)
      && (
        conflict === "all"
        || (conflict === "with_conflict" && product.conflictingSignals.length > 0)
        || (conflict === "without_conflict" && product.conflictingSignals.length === 0)
      )
      && (
        representative === "all"
        || (representative === "representative" && product.familyRepresentative)
        || (representative === "member" && !product.familyRepresentative)
      )
    ));
    return [...products].sort((left, right) => {
      const leftSource = sourceByAsin.get(left.asin);
      const rightSource = sourceByAsin.get(right.asin);
      const leftValue = rankingSort === "signalScore"
        ? left.signalScore
        : rankingSort === "evidenceCoverage"
          ? left.evidenceCoverage
          : rankingSort === "price"
            ? leftSource?.price ?? null
            : rankingSort === "sales"
              ? leftSource?.estimatedMonthlySales ?? null
              : leftSource?.reviews ?? null;
      const rightValue = rankingSort === "signalScore"
        ? right.signalScore
        : rankingSort === "evidenceCoverage"
          ? right.evidenceCoverage
          : rankingSort === "price"
            ? rightSource?.price ?? null
            : rankingSort === "sales"
              ? rightSource?.estimatedMonthlySales ?? null
              : rightSource?.reviews ?? null;
      if (leftValue === null && rightValue === null) return left.asin.localeCompare(right.asin);
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      return rightValue - leftValue || left.asin.localeCompare(right.asin);
    });
  }, [
    conflict,
    data.ranking.products,
    evidence,
    priority,
    rankingSort,
    representative,
    sourceByAsin,
  ]);
  const comparableProducts = visibleRankingProducts.filter(
    (product) => product.evidenceStatus === "sufficient_for_comparison",
  );
  const unrankedProducts = visibleRankingProducts.filter(
    (product) => product.evidenceStatus !== "sufficient_for_comparison",
  );

  return (
    <section className="surface-card-strong overflow-hidden">
      <div className="border-b border-slate-200 bg-gradient-to-br from-teal-50 via-white to-emerald-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="eyebrow">只读研究优先级</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
              市场信号排序（非正式）
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              本排序仅用于决定先研究哪个商品，不是正式选品、采购或上架结论。
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
            <SummaryCard label="可比较" value={data.ranking.rankableProductCount} />
            <SummaryCard label="未排名" value={data.ranking.unrankedProductCount} />
            <SummaryCard
              label="研究分组数量"
              value={data.ranking.familyResearchListCount}
              note="不同于显式父子家族数量"
            />
          </div>
        </div>
        <div className="mt-4 grid gap-2 text-xs leading-5 md:grid-cols-2">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            价格适配采用区间内/区间外二元规则。即使只超过边界 0.01 美元，也会失去该项分数，请结合原始价格人工判断。
          </p>
          {data.reportType === "search_results" ? (
            <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sky-800">
              广告位不是自然需求；只有广告位时自然位得分为 0，但不是缺失；销量是 SellerSprite 第三方估算。
            </p>
          ) : (
            <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sky-800">
              搜索位置：不适用。BSR 是类目排名信号，不代表 Amazon 后台订单。
            </p>
          )}
        </div>
      </div>

      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setView("products")}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                view === "products" ? "bg-white text-teal-800 shadow-sm" : "text-slate-500"
              }`}
            >
              产品榜
            </button>
            <button
              type="button"
              onClick={() => setView("families")}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                view === "families" ? "bg-white text-teal-800 shadow-sm" : "text-slate-500"
              }`}
            >
              家族研究列表
            </button>
          </div>
          <span className="status-badge px-3 py-1.5 text-xs">
            {data.ranking.modelVersion}
          </span>
        </div>

        {view === "products" ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <label className="text-xs font-semibold text-slate-500">
                研究优先级
                <select
                  aria-label="研究优先级筛选"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as RankingPriorityFilter)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="all">全部</option>
                  <option value="priority_1">优先研究组 1</option>
                  <option value="priority_2">优先研究组 2</option>
                  <option value="priority_3">优先研究组 3</option>
                  <option value="unranked_insufficient_evidence">暂不排名：证据不足</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-500">
                证据状态
                <select
                  aria-label="证据状态筛选"
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value as RankingEvidenceFilter)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="all">全部</option>
                  <option value="sufficient_for_comparison">证据可比较</option>
                  <option value="limited_evidence">证据有限</option>
                  <option value="insufficient_evidence">证据不足</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-500">
                冲突
                <select
                  aria-label="冲突筛选"
                  value={conflict}
                  onChange={(event) => setConflict(event.target.value as RankingConflictFilter)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="all">全部</option>
                  <option value="with_conflict">存在冲突</option>
                  <option value="without_conflict">无冲突</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-500">
                家族角色
                <select
                  aria-label="家族角色筛选"
                  value={representative}
                  onChange={(event) => setRepresentative(
                    event.target.value as RankingRepresentativeFilter,
                  )}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="all">全部</option>
                  <option value="representative">家族代表</option>
                  <option value="member">其他成员</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-500">
                展示排序
                <select
                  aria-label="市场信号商品排序"
                  value={rankingSort}
                  onChange={(event) => setRankingSort(event.target.value as RankingSort)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="signalScore">市场信号分</option>
                  <option value="evidenceCoverage">证据覆盖度</option>
                  <option value="price">原始价格</option>
                  <option value="sales">估算月销量</option>
                  <option value="reviews">评论数</option>
                </select>
              </label>
            </div>
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-900">可比较商品</h3>
                <span className="text-xs text-slate-400">{comparableProducts.length} 个</span>
              </div>
              <RankingProductTable
                products={comparableProducts}
                sourceByAsin={sourceByAsin}
                rankable
              />
            </div>
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-900">证据不足或冲突商品</h3>
                <span className="text-xs text-slate-400">{unrankedProducts.length} 个</span>
              </div>
              <RankingProductTable
                products={unrankedProducts}
                sourceByAsin={sourceByAsin}
                rankable={false}
              />
            </div>
          </>
        ) : (
          <div className="mt-5 space-y-3">
            <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm leading-6 text-teal-800">
              每个明确 Parent ASIN 默认只保留一个代表商品；无 Parent ASIN 的商品作为独立研究项；
              其他子体仍完整保留，不相加父子体销量。
            </p>
            {data.ranking.familyResearchList.map((family) => (
              <details key={family.familyIdentity} className="rounded-2xl border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer">
                  <span className="font-mono text-xs font-semibold text-teal-700">
                    {family.familyIdentity}
                  </span>
                  <span className="ml-3 text-sm font-semibold text-slate-800">
                    代表 {family.representativeAsin}
                  </span>
                  <span className="ml-3 text-xs text-slate-400">
                    {family.members.length} 个成员 · {family.rankableMemberCount} 个可比较
                  </span>
                </summary>
                <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <p>代表原因：{family.representativeReason}</p>
                  <p>成员：{family.members.join("、")}</p>
                  <p>分组警告：{family.familyWarnings.join("、") || "无"}</p>
                </div>
              </details>
            ))}
          </div>
        )}

        <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">模型诊断</summary>
          <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
            <p>模型版本：{data.ranking.modelVersion}</p>
            <p>Ranking Hash：{data.ranking.rankingHash.slice(0, 12)}…</p>
            <p>销量 Top 3：{data.ranking.diagnostics.salesOnlyTop3.join("、") || "无"}</p>
            <p>市场信号 Top 3：{data.ranking.diagnostics.marketSignalTop3.join("、") || "无"}</p>
            <p>Top 3 与销量榜重合：{data.ranking.diagnostics.top3SalesOverlap}</p>
            <p>单组件主导警告：{data.ranking.diagnostics.dominanceWarningCount}</p>
            <p className="md:col-span-2">
              主导组件分布：
              {Object.entries(data.ranking.diagnostics.dominantComponentDistribution)
                .map(([component, count]) => `${component} ${count}`)
                .join("、") || "无"}
            </p>
            <p className="md:col-span-2 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-slate-500">
              这些指标用于检查模型是否过度依赖某一个信号；不是预测准确率，也不是盈利概率。
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

export function SellerSpritePreviewResults({
  data,
}: {
  data: SellerSpriteOpportunityPreviewViewModel;
}) {
  const [priceBand, setPriceBand] = useState<PriceBandFilter>("all");
  const [signal, setSignal] = useState<SignalFilter>("all");
  const [sort, setSort] = useState<ProductSort>("asin");
  const visibleProducts = useMemo(
    () => filterAndSortSellerSpritePreviewProducts(data.products, priceBand, signal, sort),
    [data.products, priceBand, signal, sort],
  );

  return (
    <div className="space-y-5" data-testid="preview-results">
      <SafetyRail data={data} />

      <section className="surface-card-strong p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">数据质量</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">工作簿预检与覆盖度</h2>
            <p className="mt-1 text-sm text-slate-500">
              {data.sourceFileName} · {data.sheetName} · {data.marketplace} / {data.market}
            </p>
          </div>
          <span className={`status-badge px-3 py-1.5 text-xs ${
            data.reportStatus === "complete"
              ? "border-teal-200 bg-teal-50 text-teal-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}>
            {data.reportStatus === "complete" ? "完整预检" : "部分接受"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="原始行" value={data.totalRows} note={`表头 ${data.headerColumnCount} 列`} />
          <SummaryCard label="接受行" value={data.acceptedRows} />
          <SummaryCard label="拒绝行" value={data.rejectedRows} />
          <SummaryCard label="字段冲突" value={data.conflictCount} />
          <SummaryCard label="缺失信号" value={data.missingSignals.length} />
        </div>
        {data.missingSignals.length > 0 ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            缺失信号：{data.missingSignals.join("、")}
          </p>
        ) : null}
      </section>

      <section className="surface-card-strong p-5">
        <div className="flex items-center gap-3">
          <div className="linear-icon size-9 rounded-xl"><BarChart3 className="size-4" /></div>
          <div>
            <p className="eyebrow">市场图景</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {data.reportType === "search_results"
                ? "商品级口径优先"
                : "类目当前商品 · 商品级口径优先"}
            </h2>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label={data.reportType === "search_results" ? "关键词搜索出现次数" : "类目当前商品记录"}
            value={data.occurrenceCount}
          />
          <SummaryCard label="唯一商品" value={data.productCount} note={`唯一 ASIN ${data.uniqueAsinCount}`} />
          <SummaryCard label="父子家族" value={data.familyCount} />
          <SummaryCard
            label="重复记录商品组"
            value={data.duplicateOccurrenceGroupCount}
            note={data.reportType === "search_results"
              ? "保留各次搜索出现，不合并指标"
              : "保留各条类目当前商品记录，不合并指标"}
          />
        </div>
        {data.reportType === "search_results" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <SummaryCard label="广告位" value={data.sponsoredAppearanceCount ?? 0} />
            <SummaryCard label="自然位" value={data.organicAppearanceCount ?? 0} />
            <SummaryCard label="未知位置" value={data.unknownAppearanceCount ?? 0} />
          </div>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <NumericSummaryCard label="大类 BSR" summary={data.categoryBsrSummary.rootCategoryBsr} />
            <NumericSummaryCard label="小类 BSR" summary={data.categoryBsrSummary.subCategoryBsr} />
          </div>
        )}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <NumericSummaryCard label="商品价格（USD）" summary={data.productWeightedStatistics.price} currency />
          <NumericSummaryCard label="预估月销量" summary={data.productWeightedStatistics.estimatedMonthlySales} />
          <NumericSummaryCard label="评分" summary={data.productWeightedStatistics.rating} />
          <NumericSummaryCard label="评论数" summary={data.productWeightedStatistics.reviews} />
        </div>
        {data.reportType === "search_results" && data.appearanceWeightedStatistics ? (
          <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
              查看 Appearance 级统计（同一 ASIN 可重复出现）
            </summary>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <NumericSummaryCard label="Appearance 价格（USD）" summary={data.appearanceWeightedStatistics.price} currency />
              <NumericSummaryCard label="Appearance 预估月销量" summary={data.appearanceWeightedStatistics.estimatedMonthlySales} />
            </div>
          </details>
        ) : null}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <ConcentrationCard title="品牌集中度" data={data.brandConcentration} />
        <ConcentrationCard title="卖家集中度" data={data.sellerConcentration} />
      </section>

      <SellerSpriteRankingPreview data={data} />

      <section className="surface-card-strong p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="linear-icon size-9 rounded-xl"><TableProperties className="size-4" /></div>
            <div>
              <p className="eyebrow">商品级预览</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">
                {visibleProducts.length} / {data.products.length} 个商品
              </h2>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-slate-500">
              价格带
              <select
                aria-label="价格带筛选"
                value={priceBand}
                onChange={(event) => setPriceBand(event.target.value as PriceBandFilter)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
              >
                <option value="all">全部</option>
                <option value="within">价格带内</option>
                <option value="outside">价格带外</option>
                <option value="missing">价格缺失</option>
                <option value="conflict">价格冲突</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-500">
              信号状态
              <select
                aria-label="信号状态筛选"
                value={signal}
                onChange={(event) => setSignal(event.target.value as SignalFilter)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
              >
                <option value="all">全部</option>
                <option value="missing">有缺失</option>
                <option value="conflict">有冲突</option>
                <option value="complete">无缺失冲突</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-500">
              排序
              <select
                aria-label="商品排序"
                value={sort}
                onChange={(event) => setSort(event.target.value as ProductSort)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
              >
                <option value="asin">ASIN</option>
                <option value="price">价格从高到低</option>
                <option value="sales">预估月销量从高到低</option>
                <option value="reviews">评论数从高到低</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-3 py-3">商品</th>
                <th className="px-3 py-3">价格 / 价格带</th>
                <th className="px-3 py-3">预估月销量</th>
                <th className="px-3 py-3">评分 / 评论</th>
                {data.reportType === "search_results" ? (
                  <>
                    <th className="px-3 py-3">关键词搜索位置</th>
                    <th className="px-3 py-3">最佳搜索位置</th>
                  </>
                ) : (
                  <>
                    <th className="px-3 py-3">大类目 / BSR</th>
                    <th className="px-3 py-3">小类目 / BSR</th>
                  </>
                )}
                <th className="px-3 py-3">信号状态</th>
                <th className="px-3 py-3">非权威处置</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visibleProducts.map((product) => (
                <tr key={product.asin} className="align-top hover:bg-slate-50/70">
                  <td className="max-w-[260px] px-3 py-3">
                    <p className="font-mono text-xs font-semibold text-teal-700">{product.asin}</p>
                    <p className="mt-1 line-clamp-2 font-medium text-slate-800">{product.title ?? "标题缺失"}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {product.brand ?? "品牌缺失"} · Parent {product.parentAsin ?? "无"}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-semibold text-slate-800">{formatUsd(product.price)}</p>
                    <span className="mt-1 inline-flex rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">
                      {priceBandLabel(product.priceBandStatus)}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-semibold text-slate-800">
                    {formatNumber(product.estimatedMonthlySales)}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {formatNumber(product.rating)} / {formatNumber(product.reviews)}
                  </td>
                  {data.reportType === "search_results" ? (
                    <>
                      <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                        共 {product.appearanceCount}<br />
                        广告 {product.sponsoredAppearanceCount} · 自然 {product.organicAppearanceCount}
                      </td>
                      <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                        广告 {product.bestSponsoredPage ?? "—"} / {product.bestSponsoredPosition ?? "—"}<br />
                        自然 {product.bestOrganicPage ?? "—"} / {product.bestOrganicPosition ?? "—"}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                        {product.rootCategory ?? "缺失"}<br />
                        BSR {formatBsr(product.rootCategoryBsr)}
                      </td>
                      <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                        {product.subCategory ?? "缺失"}<br />
                        BSR {formatBsr(product.subCategoryBsr)}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-3 text-xs leading-5">
                    <p className={product.conflictingSignals.length ? "text-amber-700" : "text-slate-500"}>
                      冲突 {product.conflictingSignals.length}
                    </p>
                    <p className={product.missingSignals.length ? "text-amber-700" : "text-slate-500"}>
                      缺失 {product.missingSignals.length}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                      {dispositionLabel(product.provisionalDisposition)}
                    </span>
                    <p className="mt-1 text-[11px] text-slate-400">不可晋级</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleProducts.length === 0 ? (
            <div className="flex items-center justify-center gap-2 bg-white px-4 py-10 text-sm text-slate-500">
              <Filter className="size-4" />
              当前筛选条件没有商品。
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PreviewForm({
  submitting,
  error,
  onSubmit,
  onReset,
  fileRef,
}: {
  submitting: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [reportType, setReportType] = useState<"" | "search_results" | "category_current">("");
  return (
    <section className="surface-card-strong p-5">
      <div className="flex items-center gap-3">
        <div className="linear-icon size-10 rounded-xl"><FileSpreadsheet className="size-5" /></div>
        <div>
          <p className="eyebrow">本地文件 · 内存处理</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">生成 SellerSprite 市场预览</h2>
        </div>
      </div>
      <form className="mt-5 grid gap-4" onSubmit={onSubmit}>
        <label className="text-sm font-semibold text-slate-700">
          报表类型
          <select
            name="reportType"
            aria-label="报表类型"
            value={reportType}
            onChange={(event) => setReportType(
              event.target.value as "" | "search_results" | "category_current",
            )}
            className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="">请选择报表类型</option>
            <option value="search_results">关键词搜索报表</option>
            <option value="category_current">类目当前商品报表</option>
          </select>
        </label>
        <label className="rounded-2xl border border-dashed border-teal-300 bg-teal-50/50 p-4">
          <span className="flex items-center gap-2 text-sm font-semibold text-teal-800">
            <Upload className="size-4" />
            SellerSprite 官方 US XLSX
          </span>
          <input
            ref={fileRef}
            name="file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="mt-3 block w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-teal-700"
          />
          <span className="mt-2 block text-xs leading-5 text-teal-700">
            单个 .xlsx，最大 10 MiB；不上传到云端，不写入磁盘或数据库。
          </span>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          {reportType === "search_results" ? (
            <label className="text-sm font-semibold text-slate-700">
              市场查询词
              <input
                name="query"
                placeholder="例如：收纳盒"
                maxLength={200}
                className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
          ) : null}
          <label className="text-sm font-semibold text-slate-700">
            商品类目
            <select
              name="category"
              defaultValue="Home & Kitchen"
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              {AMAZON_US_TOP_LEVEL_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm font-semibold text-slate-700">
            最低价（USD）
            <input
              name="priceMin"
              inputMode="decimal"
              placeholder="0"
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            最高价（USD）
            <input
              name="priceMax"
              inputMode="decimal"
              placeholder="100"
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
            >
              {submitting ? <RefreshCw className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
              {submitting ? "生成中" : "生成市场预览"}
            </button>
            <button
              type="reset"
              disabled={submitting}
              onClick={() => {
                setReportType("");
                onReset();
              }}
              className="linear-button inline-flex h-11 items-center justify-center px-4 text-sm font-semibold"
            >
              清空
            </button>
          </div>
        </div>
      </form>
      {submitting ? (
        <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 px-3 py-3 text-sm text-teal-800" role="status">
          <p className="font-semibold">正在安全检查文件并生成只读预览</p>
          <p className="mt-1 text-xs">流程依次包含 XLSX 门禁、市场快照与非权威兼容性投影。</p>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}
    </section>
  );
}

export function SellerSpriteOpportunityPreview() {
  const [access, setAccess] = useState<AccessState>("checking");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SellerSpriteOpportunityPreviewViewModel | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(API_PATH, {
      method: "GET",
      credentials: "same-origin",
      headers: buildAccessHeaders(),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("owner_required");
        setAccess("authorized");
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setAccess("denied");
      });
    return () => controller.abort();
  }, []);

  function reset() {
    setError(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const fileValue = form.get("file");
    const values: PreviewFormValues = {
      file: fileValue instanceof File ? fileValue : null,
      reportType: String(form.get("reportType") ?? "") as PreviewFormValues["reportType"],
      query: String(form.get("query") ?? ""),
      category: String(form.get("category") ?? ""),
      priceMin: String(form.get("priceMin") ?? ""),
      priceMax: String(form.get("priceMax") ?? ""),
    };
    const validation = validateSellerSpritePreviewForm(values);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(API_PATH, {
        method: "POST",
        credentials: "same-origin",
        headers: buildAccessHeaders(),
        body: form,
      });
      const payload = await response.json() as {
        ok: boolean;
        data?: SellerSpriteOpportunityPreviewViewModel;
        error?: { code?: string };
      };
      if (!response.ok || !payload.ok || !payload.data) {
        const code = payload.error?.code ?? "internal_error";
        if (code === "owner_required") setAccess("denied");
        throw new Error(code);
      }
      setResult(payload.data);
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : "internal_error";
      setError(ERROR_COPY[code] ?? ERROR_COPY.internal_error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0 space-y-5">
          <header className="workspace-header">
            <div className="flex items-start gap-3">
              <div className="linear-icon size-11 shrink-0 rounded-xl">
                <FileSpreadsheet className="size-5" />
              </div>
              <div>
                <p className="eyebrow">管理员 · 本地开发预览</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  SellerSprite 机会市场预览
                </h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                  在内存中读取官方 US XLSX，查看数据质量、市场图景与商品级非权威兼容性结果。
                </p>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          {access === "checking" ? (
            <section className="surface-card-strong flex items-center gap-3 p-5" role="status">
              <RefreshCw className="size-5 animate-spin text-teal-600" />
              <div>
                <p className="font-semibold text-slate-800">正在核验管理员权限</p>
                <p className="mt-1 text-sm text-slate-500">授权完成前不会显示文件选择或预览功能。</p>
              </div>
            </section>
          ) : access === "denied" ? (
            <section className="surface-card-strong flex items-start gap-3 border-amber-200 bg-amber-50/70 p-5">
              <LockKeyhole className="mt-0.5 size-5 shrink-0 text-amber-700" />
              <div>
                <h2 className="font-semibold text-amber-900">管理员权限未通过</h2>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  此入口不向访客开放。请用管理员身份重新登录后刷新页面。
                </p>
              </div>
            </section>
          ) : (
            <>
              <SafetyRail />
              <PreviewForm
                submitting={submitting}
                error={error}
                onSubmit={submit}
                onReset={reset}
                fileRef={fileRef}
              />
              {result ? <SellerSpritePreviewResults data={result} /> : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
