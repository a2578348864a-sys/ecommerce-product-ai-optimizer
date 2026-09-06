"use client";

/**
 * Phase 2 — 资料 Workbench（商品证据工作台展示）
 *
 * 信息层级（Novice Comprehension）：简明结论 → 为什么这么说 → 原始 资料。
 * 六大区域：商品概览 / 市场 资料 / 竞品资料 / 关键词资料 / 货源 资料 / 待补资料。
 * 数据来源严格按 docs/v3/changes/phase-2/evidence-read-model.md；
 * 缺失一律显示 unknown/「未收集」，禁止 AI 填空、禁止编造。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { FactCandidateReview } from "@/components/evidence/FactCandidateReview";
import type { DecisionStatus } from "@/lib/tasks/decisionStatus";
import {
  KeywordReportEvidenceSection,
  type KeywordEvidenceView,
} from "@/components/evidence/KeywordReportEvidenceSection";
import {
  BrowserEvidenceSection,
  parseBrowserEvidenceView,
  type BrowserEvidenceView,
} from "@/components/evidence/BrowserEvidenceSection";
import {
  VocEvidenceSection,
  parseVocAnalysisView,
  parseVocEvidenceView,
  parseVocCollectPreviewView,
  type VocAnalysisView,
  type VocEvidenceView,
  type VocCollectPreviewView,
} from "@/components/evidence/VocEvidenceSection";
import { CommercialInputsCard } from "@/components/product-research/CommercialInputsCard";
import { BrowserUseCollectButton } from "@/components/evidence/BrowserUseCollectButton";
import { KeywordPendingSubmitCard, type KeywordPendingPreview } from "@/components/evidence/KeywordPendingSubmitCard";
import { KeywordStrategyCard } from "./KeywordStrategyCard";
import { CompetitorStrategyCard } from "./CompetitorStrategyCard";
import { CompetitorPendingSubmitCard, type CompetitorPendingPreview } from "@/components/evidence/CompetitorPendingSubmitCard";
import { SourcingEvidencePanel } from "@/components/cross-border/SourcingEvidencePanel";
import { ResearchCollectionOrchestratorCard } from "./ResearchCollectionOrchestratorCard";
import { RESEARCH_MATERIAL_ROWS } from "@/lib/client/evidenceCompletion";
import {
  getFactCandidates,
  MANUAL_FACT_FIELDS,
  type ConfirmedFactCandidate,
} from "@/lib/factCandidates";
import {
  parseAcquisitionCapability,
  type AcquisitionCapabilityView,
} from "@/lib/client/acquisitionCapability";

/* ── 纯提取工具（导出供测试） ─────────────────────────── */

export type MetricNature = "snapshot" | "estimate" | "derived" | "unknown";

export type WorkbenchOverviewItem = {
  field: string;
  label: string;
  value: string;
  nature: MetricNature;
  /** 原始值（展开层展示） */
  raw?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** P1-A：区级加载/错误状态条（加载失败 ≠ 没有数据；提供重试） */
function SectionStatusBar({
  loading,
  error,
  onRetry,
  loadingLabel,
}: {
  loading: boolean;
  error: string;
  onRetry: () => void;
  loadingLabel: string;
}) {
  if (loading) {
    return <p className="mt-2 text-sm text-slate-400">正在读取{loadingLabel}…</p>;
  }
  if (error) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2" role="alert">
        <span className="text-sm text-rose-700">{error}</span>
        <button type="button" onClick={onRetry} className="text-sm font-semibold text-rose-700 underline">
          重试
        </button>
      </div>
    );
  }
  return null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value.trim();
  if (isRecord(value)) {
    // 兼容 { normalized } / { value } 包装结构
    if (value.normalized !== undefined) return displayValue(value.normalized);
    if (value.value !== undefined) return displayValue(value.value);
    return "";
  }
  return "";
}

export function natureForField(field: string): MetricNature {
  if (field === "estimatedMonthlySales" || field === "estimatedMonthlyRevenue") return "estimate";
  if (field === "price" || field === "rating" || field === "reviews"
    || field === "rootCategoryBsr" || field === "subCategoryBsr" || field === "variationCount") {
    return "snapshot";
  }
  return "unknown";
}

// ── V3 Final R12：研究资料清单与研究状态行（导出纯函数，供组件与测试使用） ──

export type ResearchMaterialRow = { key: string; label: string; state: "已有" | "待补" | "可选"; detail?: string };

export type LiveEvidenceCounts = {
  productBasics: number;
  competitor: number;
  keyword: number;
  browser: number;
  voc: number;
  sourcing: number;
};

export type ResearchStatusSummary = {
  status: "empty" | "partial" | "ai_ready";
  collectedLabels: string[];
};

/**
 * R7 权威矩阵（Requirement×Collection 语义）→ 当前研究资料 6 行清单。
 * 与 lib/client/evidenceCompletion 的语义一致：可选+缺失→可选；必填+缺失→待补；有→已有。
 */
export function buildResearchMaterialRows(input: {
  overview: WorkbenchOverviewItem[];
  competitors: unknown[];
  keywordReportEvidence: unknown;
  browserEvidence: { snapshots: unknown[] } | null;
  vocEvidence: { dataset: { reviews: unknown[] } } | null;
  sourcingConfirmed: boolean;
  /** V3 Final HWF：商品基础资料状态覆盖（已确认事实计数参与判定；可选，默认按 overview 派生） */
  productBasicsState?: "已有" | "待补";
  /** V3 Final HWF：商品基础资料明细（"已有 N 项 / 仍缺 M 项"） */
  productBasicsDetail?: string;
}): ResearchMaterialRow[] {
  const productBasicsState: "已有" | "待补" =
    input.productBasicsState ?? (input.overview.some((item) => item.value !== "unknown") ? "已有" : "待补");
  return [
    {
      key: "productBasics",
      label: "商品基础资料",
      state: productBasicsState,
      ...(input.productBasicsDetail ? { detail: input.productBasicsDetail } : {}),
    },
    { key: "competitor", label: "竞品资料", state: input.competitors.length > 0 ? "已有" : "可选" },
    { key: "keyword", label: "关键词", state: input.keywordReportEvidence !== null ? "已有" : "待补" },
    { key: "browser", label: "Amazon 页面", state: (input.browserEvidence?.snapshots.length ?? 0) > 0 ? "已有" : "待补" },
    { key: "voc", label: "买家评论", state: (input.vocEvidence?.dataset.reviews.length ?? 0) > 0 ? "已有" : "待补" },
    { key: "sourcing", label: "供应线索", state: input.sourcingConfirmed ? "已有" : "可选" },
  ];
}

/**
 * R12 研究状态行（§170/§175/§176/§177）：
 * - 0 类已收集 → "研究资料尚待补充"
 * - ≥1 类已收集、未生成 AI 研究摘要 → "研究进行中"（研究开始 ≠ AI 已运行）
 * - 已生成 AI 研究摘要 → "AI 已整理当前资料"
 */
export function deriveResearchStatus(
  rows: ResearchMaterialRow[],
  aiSummary: unknown,
): ResearchStatusSummary {
  const collectedLabels = rows.filter((row) => row.state === "已有").map((row) => row.label);
  const status: ResearchStatusSummary["status"] = aiSummary
    ? "ai_ready"
    : collectedLabels.length > 0
      ? "partial"
      : "empty";
  return { status, collectedLabels };
}

const OVERVIEW_FIELDS: ReadonlyArray<{ field: string; label: string }> = [
  { field: "productTitle", label: "标题" },
  { field: "brand", label: "品牌" },
  { field: "rootCategory", label: "大类目" },
  { field: "price", label: "价格(USD)" },
  { field: "rating", label: "评分" },
  { field: "reviews", label: "评论数" },
  { field: "rootCategoryBsr", label: "大类BSR" },
  { field: "subCategoryBsr", label: "小类BSR" },
  { field: "estimatedMonthlySales", label: "估算月销量" },
  { field: "estimatedMonthlyRevenue", label: "估算月销售额(USD)" },
];

export function extractOverviewItems(result: unknown): WorkbenchOverviewItem[] {
  if (!isRecord(result)) return [];
  const sourceMeta = isRecord(result.sourceMeta) ? result.sourceMeta : null;
  const batchSnapshot = sourceMeta && isRecord(sourceMeta.productBatchSnapshot)
    ? sourceMeta.productBatchSnapshot
    : null;
  // V3 UX Closure：productFacts 优先取 sourceMeta.productBatchSnapshot（SellerSprite 导入任务）；
  // 回退到 candidateAnalysisContext.facts.productFacts（同一 productFacts 结构，当前 Research /
  // 演示任务无 sourceMeta 时的权威来源）——系统已有的确定性商品事实必须展示，不能显示"待补"。
  let facts = batchSnapshot && isRecord(batchSnapshot.productFacts)
    ? batchSnapshot.productFacts
    : null;
  if (!facts) {
    const cac = isRecord(result.candidateAnalysisContext) ? result.candidateAnalysisContext : null;
    const cacFacts = cac && isRecord(cac.facts) ? cac.facts : null;
    facts = cacFacts && isRecord(cacFacts.productFacts) ? cacFacts.productFacts : null;
  }
  const items: WorkbenchOverviewItem[] = [];
  for (const { field, label } of OVERVIEW_FIELDS) {
    if (!facts) break;
    const value = displayValue(facts[field]);
    items.push({
      field,
      label,
      value: value || "尚未取得",
      nature: natureForField(field),
      ...(value ? { raw: value } : {}),
    });
  }
  if (batchSnapshot && typeof batchSnapshot.asin === "string") {
    items.unshift({
      field: "asin",
      label: "ASIN",
      value: batchSnapshot.asin,
      nature: "unknown",
      raw: batchSnapshot.asin,
    });
  }
  return items;
}

/**
 * V3 Final HWF（P1-03 一致性）：把已确认商品事实（factCandidates namespace，唯一已确认权威）
 * 追加为商品概览条目——标题派生等字段同样展示，消除"已确认 9 条却显示暂无证据"的矛盾。
 * 与 overview 同字段（如 brand/price）以 overview 为准去重（同字段候选来自同一事实）。
 */
export function mergeConfirmedIntoOverview(
  overview: WorkbenchOverviewItem[],
  confirmed: ReadonlyArray<ConfirmedFactCandidate>,
): WorkbenchOverviewItem[] {
  const seen = new Set(overview.map((item) => item.field));
  const extra: WorkbenchOverviewItem[] = [];
  for (const item of confirmed) {
    if (seen.has(item.field)) continue;
    seen.add(item.field);
    const value = String(item.value);
    extra.push({
      field: item.field,
      label: item.label,
      value,
      nature: item.sourceKind === "product_title" ? "derived" : "snapshot",
      raw: value,
    });
  }
  return [...overview, ...extra];
}

/**
 * 商品事实期望字段集 = MANUAL_FACT_FIELDS（15）——仅商品本身规格事实。
 * 契约④ MARKET_OBSERVATION：category/price/rating/reviews/bsr 是市场观察（market_observation），
 * 不是商品事实，不参与「商品事实已有/仍缺」计数（它们在市场观察区单独展示）。
 */
export const EXPECTED_FACT_FIELDS: ReadonlySet<string> = new Set(
  MANUAL_FACT_FIELDS.map((item) => item.field),
);

/** overview 字段名 → 事实字段名的归一化别名（其余同名直接覆盖） */
const FACT_FIELD_ALIAS: Record<string, string> = {
  rootCategory: "category",
  rootCategoryBsr: "bsr",
  subCategoryBsr: "bsr",
};

/**
 * 已覆盖商品事实字段集：overview 已知项（归一化后）+ confirmed 字段，
 * 仅统计 product_fact（市场观察字段不计入「商品事实 N/M」）。
 */
export function coveredFactFieldSet(
  overview: WorkbenchOverviewItem[],
  confirmed: ReadonlyArray<Pick<ConfirmedFactCandidate, "field">>,
): Set<string> {
  const covered = new Set<string>();
  for (const item of overview) {
    if (item.value === "unknown") continue;
    const canonical = FACT_FIELD_ALIAS[item.field] ?? item.field;
    if (EXPECTED_FACT_FIELDS.has(canonical)) covered.add(canonical);
  }
  for (const item of confirmed) {
    if (EXPECTED_FACT_FIELDS.has(item.field)) covered.add(item.field);
  }
  return covered;
}

export type WorkbenchDecisionSummary = {
  status: string;
  label: string;
  reason: string;
  nextAction: string;
} | null;

const DECISION_LABELS: Record<string, string> = {
  creative_ready: "进入创作准备",
  needs_information: "待补信息",
  abandoned: "放弃研究",
};

export function extractDecisionSummary(result: unknown): WorkbenchDecisionSummary {
  if (!isRecord(result)) return null;
  // V3 Final HWF（P1-03）：详情页浏览器投影只暴露 productResearchSummary
  // （researchRecord 仅服务端内部，DETAIL_FIELDS 不投影）——决策状态以投影 summary 为权威，
  // researchRecord.latestDecision 仅作完整 result 传入时的兜底。
  const summary = isRecord(result.productResearchSummary) ? result.productResearchSummary : null;
  if (summary && typeof summary.status === "string") {
    const status = summary.status;
    return {
      status,
      label: typeof summary.label === "string" && summary.label ? summary.label : (DECISION_LABELS[status] ?? status),
      reason: text(summary.reasonSummary),
      nextAction: text(summary.nextActionSummary),
    };
  }
  const record = isRecord(result.researchRecord) ? result.researchRecord : null;
  const latest = record && isRecord(record.latestDecision) ? record.latestDecision : null;
  if (!latest) return null;
  const status = text(latest.status);
  return {
    status,
    label: DECISION_LABELS[status] ?? status,
    reason: text(latest.reason),
    nextAction: text(latest.nextAction),
  };
}

export function extractEvidenceGaps(result: unknown): string[] {
  if (!isRecord(result)) return [];
  const evidence = isRecord(result.decisionEvidence) ? result.decisionEvidence : null;
  const missingData = Array.isArray(evidence?.missingData)
    ? evidence.missingData.filter(isRecord).map((item) => text(item.summary)).filter(Boolean)
    : [];
  return missingData;
}

export function extractKeywordBrief(result: unknown): {
  primaryKeyword: string;
  supportingKeywords: string[];
  backendSearchTerms: string[];
  source: string;
  reportType?: string;
  marketplace?: string;
  month?: string;
  evidenceRef?: string;
  reportHash?: string;
  asin?: string;
} | null {
  if (!isRecord(result)) return null;
  const brief = isRecord(result.listingKeywordBrief) ? result.listingKeywordBrief : null;
  if (!brief) return null;
  const provenance: {
    reportType?: string;
    marketplace?: string;
    month?: string;
    evidenceRef?: string;
    reportHash?: string;
    asin?: string;
  } = {};
  for (const field of ["reportType", "marketplace", "month", "evidenceRef", "reportHash", "asin"] as const) {
    const value = brief[field];
    if (typeof value === "string" && value.trim()) provenance[field] = value.trim();
  }
  return {
    primaryKeyword: text(brief.primaryKeyword),
    supportingKeywords: Array.isArray(brief.supportingKeywords)
      ? brief.supportingKeywords.filter((v): v is string => typeof v === "string")
      : [],
    backendSearchTerms: Array.isArray(brief.backendSearchTerms)
      ? brief.backendSearchTerms.filter((v): v is string => typeof v === "string")
      : [],
    source: text(brief.source),
    ...provenance,
  };
}

export function extractCandidateScore(result: unknown): {
  score: number | null;
  available: boolean;
} {
  if (!isRecord(result)) return { score: null, available: false };
  const sourceMeta = isRecord(result.sourceMeta) ? result.sourceMeta : null;
  const candidateSnapshot = sourceMeta && isRecord(sourceMeta.candidateSnapshot)
    ? sourceMeta.candidateSnapshot
    : null;
  const score = typeof candidateSnapshot?.score === "number" ? candidateSnapshot.score : null;
  return { score, available: score !== null };
}

export function extractReportSource(result: unknown): {
  reportType: string;
  capturedAt: string;
  evidenceHash: string;
  marketplace: string;
} | null {
  if (!isRecord(result)) return null;
  const sourceMeta = isRecord(result.sourceMeta) ? result.sourceMeta : null;
  const batchSnapshot = sourceMeta && isRecord(sourceMeta.productBatchSnapshot)
    ? sourceMeta.productBatchSnapshot
    : null;
  if (!batchSnapshot) return null;
  return {
    reportType: text(batchSnapshot.reportType),
    capturedAt: text(batchSnapshot.capturedAt),
    evidenceHash: text(batchSnapshot.evidenceHash),
    marketplace: text(batchSnapshot.marketplace),
  };
}

/* ── 竞品资料 API 交互 ────────────────────────────── */

export type CompetitorAsinView = {
  asin: string;
  addedAt: string;
  note?: string;
  sourceKind?: "manual" | "browser_use";
  detailBullets?: { bullets: string[] } | null;
};

type CompetitorApiResponse =
  | {
      ok: true;
      data: {
        evidence: { asins: CompetitorAsinView[] };
        storageVersion: { resultJsonHash: string; updatedAt: string };
        pendingPreview?: CompetitorPendingPreview | null;
      };
    }
  | { ok: false; error?: { code?: string; message?: string } };

function buildFetchHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ ...buildAccessHeaders(), ...extra });
}

/* ── 展示组件 ──────────────────────────────────────────── */

const NATURE_LABEL: Record<MetricNature, string> = {
  snapshot: "快照",
  estimate: "估算",
  derived: "派生",
  unknown: "未知",
};

const NATURE_CLASS: Record<MetricNature, string> = {
  snapshot: "border-slate-200 bg-slate-50 text-slate-600",
  estimate: "border-amber-200 bg-amber-50 text-amber-700",
  derived: "border-indigo-200 bg-indigo-50 text-indigo-700",
  unknown: "border-rose-200 bg-rose-50 text-rose-600",
};

function NatureBadge({ nature }: { nature: MetricNature }) {
  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${NATURE_CLASS[nature]}`}>
      {NATURE_LABEL[nature]}
    </span>
  );
}

/** 默认只展示身份、市场和规格摘要，其余字段仍可在“查看全部”中展开。 */
export function compactOverviewItems(items: WorkbenchOverviewItem[], visibleCount = 8): {
  visible: WorkbenchOverviewItem[];
  hidden: WorkbenchOverviewItem[];
} {
  const limit = Math.max(1, Math.floor(visibleCount));
  return { visible: items.slice(0, limit), hidden: items.slice(limit) };
}

function OverviewGrid({ items }: { items: WorkbenchOverviewItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">暂无商品概览数据（来源未绑定 SellerSprite 批次）。</p>;
  }
  const { visible, hidden } = compactOverviewItems(items);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="overview-visible-grid">
        {visible.map((item) => (
          <div key={item.field} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-1">
            <p className="text-xs font-medium text-slate-500">{item.label}</p>
            <NatureBadge nature={item.nature} />
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={item.raw ?? item.value}>
            {item.value}
          </p>
          {item.nature === "estimate" && (
            <p className="mt-0.5 text-[11px] text-amber-600">第三方估算，非平台后台数据</p>
          )}
          </div>
        ))}
      </div>
      {hidden.length > 0 ? (
        <details className="mt-3" data-testid="overview-more-details">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">查看全部商品事实（{hidden.length} 项）</summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="overview-hidden-grid">
            {hidden.map((item) => (
              <div key={item.field} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-medium text-slate-500">{item.label}</p>
                  <NatureBadge nature={item.nature} />
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={item.raw ?? item.value}>{item.value}</p>
                {item.nature === "estimate" ? <p className="mt-0.5 text-[11px] text-amber-600">第三方估算，非平台后台数据</p> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function MissingSection({ gaps }: { gaps: string[] }) {
  return (
    <section data-testid="workbench-missing" className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
      <h3 className="text-sm font-bold text-slate-900">还缺什么（待补资料）</h3>
      <p className="mt-2 text-xs text-slate-500">采购价、MOQ、物流成本与合规状态请在下方「成本与风险资料」中填写；尚未取得处会明确标注，不做猜测。</p>
      {gaps.length > 0 && (
        <ul className="mt-3 space-y-1">
          {gaps.map((gap) => (
            <li key={gap} className="text-sm text-slate-700">· {gap}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type EvidenceTabKey = "market" | "buyers" | "sourcing" | "cost-risk";

export function EvidenceWorkbench({
  taskId,
  result,
  onDataChanged,
  sourceImageUrl,
  onMaterialRowsChange,
  activeTab: activeTabProp,
  onTabChange,
}: {
  taskId: string;
  result: Record<string, unknown> | null;
  /** R7：任一 资料 区确认/保存成功后冒泡（顶部"当前研究资料"据此重新计算） */
  onDataChanged?: () => void;
  /** V3 Final R9（§151）：Task 已确认主图，用于 1688 图片找货输入框自动预填 */
  sourceImageUrl?: string | null;
  /** 轮 13 一致性：当前研究资料清单（live rows）实时冒泡给外层（研究模块卡「缺什么」据此更新） */
  onMaterialRowsChange?: (payload: { rows: ResearchMaterialRow[]; counts: LiveEvidenceCounts; hasAiSummary: boolean }) => void;
  activeTab?: EvidenceTabKey;
  onTabChange?: (tab: EvidenceTabKey) => void;
}) {
  const [internalTab, setInternalTab] = useState<EvidenceTabKey>("market");
  const currentTab = activeTabProp ?? internalTab;

  // 维护数据变更版本号，递增驱动资料编排卡片自动核对并刷新真实状态
  const [dataRevision, setDataRevision] = useState(0);

  const handleDataChanged = useCallback(() => {
    setDataRevision((prev) => prev + 1);
    onDataChanged?.();
  }, [onDataChanged]);

  const handleTabSelect = useCallback((tab: EvidenceTabKey) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  }, [onTabChange]);

  useEffect(() => {
    function syncWithHash() {
      if (typeof window === "undefined") return;
      const hash = (window.location.hash || "").replace(/^#/, "");
      if (hash === "formal-v2-market-evidence" || hash.startsWith("workbench-browser") || hash.startsWith("workbench-competitor") || hash.startsWith("workbench-keyword") || hash === "workbench-overview") {
        handleTabSelect("market");
      } else if (hash === "formal-v2-buyer-evidence" || hash.startsWith("workbench-voc")) {
        handleTabSelect("buyers");
      } else if (hash === "formal-v2-sourcing-evidence" || hash.startsWith("workbench-sourcing")) {
        handleTabSelect("sourcing");
      } else if (hash === "formal-v2-cost-risk-evidence" || hash.startsWith("workbench-cost-risk") || hash === "commercial-inputs-card") {
        handleTabSelect("cost-risk");
      }
    }
    syncWithHash();
    window.addEventListener("hashchange", syncWithHash);
    return () => {
      window.removeEventListener("hashchange", syncWithHash);
    };
  }, [handleTabSelect]);
  const overview = extractOverviewItems(result);
  const decision = extractDecisionSummary(result);
  const gaps = extractEvidenceGaps(result);
  const keywordBrief = extractKeywordBrief(result);
  const productNameForBrief = (result as { candidateAnalysisContext?: { facts?: { productName?: unknown } } } | null)?.candidateAnalysisContext?.facts?.productName
    ? String((result as { candidateAnalysisContext: { facts: { productName: unknown } } }).candidateAnalysisContext.facts.productName)
    : null;
  const score = extractCandidateScore(result);
  const source = extractReportSource(result);

  // V3 Final HWF（P1-03 一致性）：factCandidates 是唯一已确认事实权威；
  // 商品概览合并已确认事实（含标题派生字段），Summary 与基础资料计数统一以合并视图为准。
  // V3R（契约④ MARKET_OBSERVATION）：商品事实计数仅统计 product_fact——
  // category/price/rating/reviews/bsr 是市场观察，单独计数展示。
  const confirmedFacts = getFactCandidates(result)?.confirmed ?? [];
  const confirmedProductFacts = confirmedFacts.filter(
    (item) => EXPECTED_FACT_FIELDS.has(item.field),
  );
  const confirmedMarketObservations = confirmedFacts.filter(
    (item) => !EXPECTED_FACT_FIELDS.has(item.field),
  );
  const mergedOverview = mergeConfirmedIntoOverview(overview, confirmedFacts);
  const coveredFacts = coveredFactFieldSet(overview, confirmedProductFacts);
  const productBasicsDetail = `已有 ${coveredFacts.size} 项 / 仍缺 ${EXPECTED_FACT_FIELDS.size - coveredFacts.size} 项`;

  const [sourcingConfirmed, setSourcingConfirmed] = useState(false);
  const [competitors, setCompetitors] = useState<CompetitorAsinView[]>([]);
  const [storageVersion, setStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [competitorLoading, setCompetitorLoading] = useState(true);
  const [newAsin, setNewAsin] = useState("");
  const [newNote, setNewNote] = useState("");
  const [competitorError, setCompetitorError] = useState("");
  const [competitorBusy, setCompetitorBusy] = useState(false);
  // 轮 10 合并：竞品采集同时产出的关键词预览（待确认卡片）
  const [keywordPending, setKeywordPending] = useState<KeywordPendingPreview | null>(null);
  const [isPendingExpired, setIsPendingExpired] = useState(false);
  // 竞品采集待确认预览状态
  const [competitorPending, setCompetitorPending] = useState<CompetitorPendingPreview | null>(null);
  const [isCompetitorPendingExpired, setIsCompetitorPendingExpired] = useState(false);
  // 竞品采集命令式句柄：卡片内「自动采集竞品」与下方 BrowserUseCollectButton 共用同一采集链路
  const competitorCollectRef = useRef<(() => void) | null>(null);

  const [keywordReportEvidence, setKeywordReportEvidence] = useState<KeywordEvidenceView | null>(null);
  const [keywordReportStorageVersion, setKeywordReportStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);


  const [browserEvidence, setBrowserEvidence] = useState<BrowserEvidenceView | null>(null);
  const [browserEvidenceStorageVersion, setBrowserEvidenceStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [browserTaskAsin, setBrowserTaskAsin] = useState<string | null>(null);
  const [browserCapability, setBrowserCapability] = useState<AcquisitionCapabilityView | null>(null);

  const [vocEvidence, setVocEvidence] = useState<VocEvidenceView | null>(null);
  const [vocAnalysis, setVocAnalysis] = useState<VocAnalysisView | null>(null);
  const [vocStorageVersion, setVocStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [vocCapability, setVocCapability] = useState<AcquisitionCapabilityView | null>(null);
  const [vocPendingPreview, setVocPendingPreview] = useState<VocCollectPreviewView | null>(null);

  // P1-A：区分 loading / empty / error / ready（不再把加载失败伪装成"没有数据"）
  const [sectionLoading, setSectionLoading] = useState(true);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const setSectionError = (key: string, message: string) => {
    setSectionErrors((current) => ({ ...current, [key]: message }));
  };
  const clearSectionError = (key: string) => {
    setSectionErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  async function loadVoc() {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/review-evidence`, {
        headers: buildFetchHeaders(),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as
        | { ok: true; data: { evidence: unknown; analysis: unknown; storageVersion: { resultJsonHash: string; updatedAt: string }; capability?: unknown; pendingPreview?: unknown } }
        | { ok: false };
      if (res.ok && json.ok) {
        setVocEvidence(parseVocEvidenceView(json.data.evidence));
        setVocAnalysis(parseVocAnalysisView(json.data.analysis));
        setVocStorageVersion(json.data.storageVersion);
        setVocCapability(parseAcquisitionCapability(json.data.capability));
        setVocPendingPreview(parseVocCollectPreviewView(json.data.pendingPreview));
        clearSectionError("voc");
      } else {
        setSectionError("voc", "买家评论读取失败，请稍后重试。");
      }
    } catch {
      setSectionError("voc", "买家评论读取失败，请检查网络后重试。");
    }
  }

  async function loadBrowserEvidence() {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/browser-evidence`, {
        headers: buildFetchHeaders(),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as
        | { ok: true; data: { evidence: unknown; storageVersion: { resultJsonHash: string; updatedAt: string }; taskAsin: string | null; capability?: unknown } }
        | { ok: false };
      if (res.ok && json.ok) {
        setBrowserEvidence(parseBrowserEvidenceView(json.data.evidence));
        setBrowserEvidenceStorageVersion(json.data.storageVersion);
        setBrowserTaskAsin(json.data.taskAsin);
        setBrowserCapability(parseAcquisitionCapability(json.data.capability));
        clearSectionError("browser");
      } else {
        setSectionError("browser", "Amazon 页面证据读取失败，请稍后重试。");
      }
    } catch {
      setSectionError("browser", "Amazon 页面证据读取失败，请检查网络后重试。");
    }
  }

  const [keywordBriefState, setKeywordBriefState] = useState<{ primaryKeyword: string; source: string; backendTermsCount: number } | null>(null);
  async function loadKeywordBriefState() {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/listing-handoff`, {
        headers: buildFetchHeaders(),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as { ok?: boolean; data?: { keywordBriefSummary?: { primaryKeyword: string; source: string; backendTermsCount: number } | null } };
      if (res.ok && json.ok) {
        setKeywordBriefState(json.data?.keywordBriefSummary ?? null);
      }
    } catch { /* best-effort */ }
  }

  async function loadKeywordEvidence() {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/keyword-evidence`, {
        headers: buildFetchHeaders(),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as
        | { ok: true; data: { evidence: KeywordEvidenceView | null; storageVersion: { resultJsonHash: string; updatedAt: string }; pendingPreview?: unknown } }
        | { ok: false };
      if (res.ok && json.ok) {
        setKeywordReportEvidence(json.data.evidence);
        setKeywordReportStorageVersion(json.data.storageVersion);
        if (json.data.pendingPreview && typeof json.data.pendingPreview === "object") {
          const pp = json.data.pendingPreview as {
            previewId?: string;
            seedAsin?: string;
            sourceUrl?: string;
            keywordCount?: number;
            capturedAt?: string | null;
            items?: Array<{
              keyword: string;
              keywordTranslation?: string;
              searchVolume?: number;
              abaWeeklyRank?: number;
              purchaseVolume?: number;
              relevance?: number;
              competition?: string;
            }>;
          };
          if (pp.previewId) {
            setKeywordPending({
              previewId: pp.previewId,
              seedAsin: pp.seedAsin ?? "",
              sourceUrl: pp.sourceUrl ?? "",
              keywordCount: pp.keywordCount ?? 0,
              capturedAt: pp.capturedAt ?? null,
              items: pp.items,
            });
            setIsPendingExpired(false);
          }
        } else if (!json.data.pendingPreview) {
          setKeywordPending(null);
        }
        clearSectionError("keyword");
      } else {
        setSectionError("keyword", "关键词证据读取失败，请稍后重试。");
      }
    } catch {
      setSectionError("keyword", "关键词证据读取失败，请检查网络后重试。");
    }
  }

  useEffect(() => {
    setSectionLoading(true);
    setSectionErrors({});
    void Promise.allSettled([
      loadKeywordEvidence(),
      loadKeywordBriefState(),
      loadBrowserEvidence(),
      loadVoc(),
    ]).then(() => setSectionLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function loadCompetitors() {
    setCompetitorLoading(true);
    setCompetitorError("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/competitor-evidence`, {
        headers: buildFetchHeaders(),
      });
      const json = await res.json() as CompetitorApiResponse;
      if (!res.ok || !json.ok) {
        setCompetitorError((json as { error?: { message?: string } }).error?.message ?? "竞品列表读取失败。");
        return;
      }
      setCompetitors(json.data.evidence.asins);
      setStorageVersion(json.data.storageVersion);
      if (json.data.pendingPreview && typeof json.data.pendingPreview === "object") {
        setCompetitorPending(json.data.pendingPreview);
        setIsCompetitorPendingExpired(false);
      } else if (!json.data.pendingPreview) {
        setCompetitorPending(null);
      }
    } catch {
      setCompetitorError("竞品列表读取失败。");
    } finally {
      setCompetitorLoading(false);
    }
  }

  useEffect(() => {
    void loadCompetitors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    if (dataRevision > 0) {
      void loadCompetitors();
      void loadKeywordEvidence();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataRevision]);

  async function mutateCompetitor(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setCompetitorBusy(true);
    setCompetitorError("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/competitor-evidence`, {
        method,
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ ...body, expectedStorageVersion: storageVersion }),
      });
      const json = await res.json() as CompetitorApiResponse;
      if (!res.ok || !json.ok) {
        setCompetitorError((json as { error?: { message?: string } }).error?.message ?? "操作失败。");
        return;
      }
      setCompetitors(json.data.evidence.asins);
      setStorageVersion(json.data.storageVersion);
      if (method === "POST") {
        setNewAsin("");
        setNewNote("");
      }
    } catch {
      setCompetitorError("操作失败，请重试。");
    } finally {
      setCompetitorBusy(false);
    }
  }

  const canAdd = newAsin.trim().length > 0 && competitors.length < 5 && !competitorBusy;

  // V3 Final R12：当前研究资料清单（checklist 行）→ 研究状态行派生（§170/§175/§177）。
  // 研究开始（有 1+ 类已收集 资料）≠ AI 总结已生成；绝不再用"研究尚未开始"表达"AI 未运行"。
  const materialRows = buildResearchMaterialRows({
    overview,
    competitors,
    keywordReportEvidence,
    browserEvidence,
    vocEvidence,
    sourcingConfirmed,
    productBasicsState: coveredFacts.size > 0 ? "已有" : "待补",
    productBasicsDetail,
  });
  const researchStatus = deriveResearchStatus(materialRows, null);

  // 轮 13 一致性：把 live 清单冒泡给外层（模块卡「缺什么」不落后于实际资料）
  const liveCounts: LiveEvidenceCounts = {
    productBasics: coveredFacts.size,
    competitor: competitors.length,
    keyword: (keywordReportEvidence as { rows?: unknown[] } | null)?.rows?.length ?? 0,
    browser: (browserEvidence as { snapshots?: unknown[] } | null)?.snapshots?.length ?? 0,
    voc: (vocEvidence as { dataset?: { reviews?: unknown[] } } | null)?.dataset?.reviews?.length ?? 0,
    sourcing: sourcingConfirmed ? 1 : 0,
  };
  const materialRowsJson = JSON.stringify(materialRows.map((row) => [row.key, row.state])) + JSON.stringify(liveCounts);
  useEffect(() => {
    onMaterialRowsChange?.({ rows: materialRows, counts: liveCounts, hasAiSummary: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialRowsJson]);

  return (
    <section data-testid="evidence-workbench" className="mt-5 space-y-4">
      {/* 资料编排卡片（置顶于当前研究资料/分类导航之上，紧贴研究资料主区域） */}
      <ResearchCollectionOrchestratorCard
        taskId={taskId}
        dataRevision={dataRevision}
        onDataChanged={handleDataChanged}
        onNavigate={(tab, anchorId) => {
          handleTabSelect(tab);
          if (anchorId && typeof window !== "undefined") {
            const cleanId = anchorId.replace(/^#+/, "");
            window.location.hash = cleanId;

            const scrollAndHighlight = () => {
              const el = document.getElementById(cleanId);
              if (el) {
                // 递归展开所有祖先 <details>
                let parent = el.parentElement;
                while (parent) {
                  if (parent.tagName === "DETAILS" || parent.nodeName === "DETAILS") {
                    (parent as HTMLDetailsElement).open = true;
                  }
                  parent = parent.parentElement;
                }
                // 平滑滚动居中对齐
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                try {
                  if (typeof el.focus === "function") {
                    el.focus({ preventScroll: true });
                  }
                } catch {
                  /* best-effort */
                }
                return true;
              }
              return false;
            };

            // React 切换 Tab 后需等待 DOM 节点渲染就绪
            if (!scrollAndHighlight()) {
              setTimeout(() => {
                if (!scrollAndHighlight()) {
                  setTimeout(scrollAndHighlight, 120);
                }
              }, 60);
            }
          }
        }}
      />

      {/* ── 02: 简明结论（首屏） ── */}
      <section data-testid="workbench-summary" className="rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
        <h3 className="text-sm font-bold text-slate-900">简明结论</h3>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">目前知道什么</dt>
            <dd className="mt-0.5 text-slate-800">
              {overview.some((item) => item.value !== "unknown") || confirmedFacts.length > 0
                ? `已整理商品概览 ${mergedOverview.filter((item) => item.value !== "unknown").length} 项、已确认 ${confirmedProductFacts.length} 条商品事实${confirmedMarketObservations.length > 0 ? `、${confirmedMarketObservations.length} 项市场观察（价格/评分/评论数/BSR/类目）` : ""}。`
                : "暂无已确认的商品证据。"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">目前不知道什么</dt>
            <dd className="mt-0.5 text-slate-800">采购价 / MOQ / 物流成本 / 合规均尚未取得（未用 AI 填补）。</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">人工决定</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">{decision ? decision.label : "待判断"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">下一步最值得补什么证据</dt>
            <dd className="mt-0.5 text-slate-800">
              {decision?.nextAction || (gaps.length > 0 ? gaps[0] : "按需要补充竞品、关键词或货源证据。")}
            </dd>
          </div>
        </dl>
        {decision?.reason && (
          <p className="mt-2 text-sm text-slate-700">
            <span className="font-semibold">为什么：</span>{decision.reason}
          </p>
        )}
        {score.available && (
          <p className="mt-2 text-xs text-slate-500">
            候选参考分 {score.score}（参考/旧兼容排序信号，不代表“值得卖”或最终建议）。
          </p>
        )}
      </section>


      {/* ── 4 维度 Tabs 导航 ── */}
      <div className="rounded-2xl border border-slate-200/90 bg-slate-50/80 p-1.5 shadow-sm" data-testid="workbench-tabs">
        <nav className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="研究资料分类">
          {[
            { key: "market" as const, num: "01", label: "市场与竞品", count: (liveCounts.productBasics > 0 || liveCounts.competitor > 0 || liveCounts.keyword > 0 || liveCounts.browser > 0) ? "已收集" : "待收集" },
            { key: "buyers" as const, num: "02", label: "买家需求与评论", count: liveCounts.voc > 0 ? `${liveCounts.voc} 条评论` : "待收集" },
            { key: "sourcing" as const, num: "03", label: "货源与供应链", count: sourcingConfirmed || liveCounts.sourcing > 0 ? "已确认" : "待收集" },
            { key: "cost-risk" as const, num: "04", label: "成本与风险", count: "商业输入" },
          ].map((t) => {
            const isActive = currentTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                data-testid={`workbench-tab-${t.key}`}
                onClick={() => handleTabSelect(t.key)}
                className={`flex flex-col items-center justify-center rounded-xl px-3 py-2.5 text-center transition-all ${
                  isActive
                    ? "bg-white text-emerald-950 font-bold shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`text-[11px] font-semibold ${isActive ? "text-emerald-600" : "text-slate-400"}`}>{t.num}</span>
                  <span className="text-xs sm:text-sm font-semibold">{t.label}</span>
                </div>
                <span className={`mt-0.5 text-[11px] ${isActive ? "text-emerald-700" : "text-slate-400"}`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── 4 个 Tab 容器（常驻 DOM，CSS hidden 切换） ── */}
      {/* Tab 1: 市场与竞品 */}
      <div className={currentTab === "market" ? "space-y-4" : "hidden"} data-testid="workbench-panel-market">
        {/* ── 商品概览 ── */}
        <section id="formal-v2-market-evidence" data-testid="workbench-overview" className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">商品概览</h3>
            {source && (
              <span className="text-xs text-slate-500">
                {source.reportType} · {source.marketplace} · capturedAt {source.capturedAt || "尚未取得"}
              </span>
            )}
          </div>
          <div className="mt-3">
            <OverviewGrid items={mergedOverview} />
          </div>
          {source?.evidenceHash && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500">原始 资料（来源追溯）</summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                {JSON.stringify({ evidenceHash: source.evidenceHash, reportType: source.reportType, capturedAt: source.capturedAt }, null, 2)}
              </pre>
            </details>
          )}
        </section>

        {/* ── 关键词策略（第2轮：默认摘要，编辑/原始资料折叠） ── */}
        <div id="workbench-keyword-strategy" className="scroll-mt-6">
        <KeywordStrategyCard
          rows={(keywordReportEvidence?.rows && keywordReportEvidence.rows.length > 0
            ? keywordReportEvidence.rows
            : (keywordPending?.items ?? [])
          ).map((r) => ({ keyword: r.keyword, rowNumber: (r as { rowNumber?: number }).rowNumber }))}
          productName={productNameForBrief}
          briefPrimary={keywordBriefState?.primaryKeyword ?? null}
          briefSource={keywordBriefState?.source ?? null}
          briefReportType={keywordBrief?.reportType ?? null}
          briefCapturedAt={keywordReportEvidence?.capturedAt ?? null}
          briefEvidenceCount={keywordReportEvidence?.rows.length ?? 0}
          inListing={Boolean(keywordBriefState)}
          needsReconfirm={false}
          hasPending={Boolean(keywordPending)}
          pendingKeywordCount={keywordPending?.keywordCount}
          hasPendingExpired={isPendingExpired}
          pendingPanel={
            keywordPending ? (
              <KeywordPendingSubmitCard
                taskId={taskId}
                preview={keywordPending}
                storageVersion={keywordReportStorageVersion}
                onSaved={() => {
                  setKeywordPending(null); loadKeywordEvidence();
                  setIsPendingExpired(false);
                  void loadCompetitors();
                  loadKeywordBriefState();
                  handleDataChanged();
                }}
                onCancel={() => {
                  setKeywordPending(null);
                  setIsPendingExpired(false);
                }}
                onExpired={() => {
                  setIsPendingExpired(true);
                }}
                onRecollect={() => {
                  setKeywordPending(null);
                  setIsPendingExpired(false);
                  competitorCollectRef.current?.();
                }}
              />
            ) : null
          }
          onSave={async (input) => {
            try {
              const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/listing-handoff`, {
                method: "POST",
                headers: { ...buildAccessHeaders(), "content-type": "application/json" },
                body: JSON.stringify({
                  action: "save_keyword_brief",
                  confirmed: true,
                  expectedStorageVersion: keywordReportStorageVersion,
                  keywordBrief: { primaryKeyword: input.primaryKeyword, supportingKeywords: input.supportingKeywords, backendSearchTerms: input.backendSearchTerms, source: "sellersprite" },
                }),
              });
              const body = await res.json().catch(() => null) as { ok?: boolean; error?: { message?: string } } | null;
              if (!res.ok) return body?.error?.message ?? "保存失败，请稍后重试。";
              handleDataChanged();
              return null;
            } catch { return "网络错误，请重试。"; }
          }}
          onSaved={() => { loadKeywordEvidence(); loadKeywordBriefState(); }}
          error={sectionErrors.keyword ?? null}
          rawEvidence={keywordReportEvidence ? { reportType: keywordReportEvidence.reportType, capturedAt: keywordReportEvidence.capturedAt, rows: keywordReportEvidence.rows } as never : null}
        />
        </div>
        {/* ── 竞品策略（第2轮：默认摘要，管理/采集折叠） ── */}
        <div id="workbench-competitor-strategy" className="scroll-mt-6">
        <CompetitorStrategyCard
          productName={productNameForBrief}
          entries={competitors.map((c) => ({
            asin: c.asin,
            note: c.note ?? null,
            sourceKind: c.sourceKind ?? "manual",
            addedAt: c.addedAt ?? null,
            detailBulletsCount: Array.isArray(c.detailBullets?.bullets) ? c.detailBullets.bullets.length : 0,
          }))}
          pendingPreview={competitorPending}
          pendingPanel={
            competitorPending ? (
              <CompetitorPendingSubmitCard
                taskId={taskId}
                preview={competitorPending}
                storageVersion={storageVersion}
                onSaved={() => {
                  setCompetitorPending(null);
                  setIsCompetitorPendingExpired(false);
                  void loadCompetitors();
                  void loadKeywordEvidence();
                  handleDataChanged();
                }}
                onCancel={() => {
                  setCompetitorPending(null);
                  setIsCompetitorPendingExpired(false);
                }}
                onExpired={() => {
                  setIsCompetitorPendingExpired(true);
                }}
                onRecollect={() => {
                  setCompetitorPending(null);
                  setIsCompetitorPendingExpired(false);
                  competitorCollectRef.current?.();
                }}
              />
            ) : null
          }
          onCollect={() => { competitorCollectRef.current?.(); }}
          onAdd={async (input) => {
            await mutateCompetitor("POST", { asin: input.asin, note: input.note });
            return competitorError || null;
          }}
          onDelete={async (asin) => {
            await mutateCompetitor("DELETE", { asin });
            return competitorError || null;
          }}
          error={competitorError}
          busy={competitorBusy}
        />
        </div>
        <BrowserUseCollectButton taskId={taskId} kind="competitor"
          storageVersion={storageVersion}
          collectRef={competitorCollectRef}
          showTrigger={false}
          onCollectStart={() => {
            setKeywordPending(null);
            setCompetitorPending(null);
            setIsPendingExpired(false);
            setIsCompetitorPendingExpired(false);
          }}
          onCollected={({ keywordPreviewId, keywordCount, seedAsin, sourceUrl }) => {
            void loadCompetitors();
            void loadKeywordEvidence();
            if (keywordPreviewId) {
              setIsPendingExpired(false);
              setKeywordPending({
                previewId: keywordPreviewId,
                seedAsin: seedAsin ?? "",
                sourceUrl: sourceUrl ?? "",
                keywordCount: keywordCount ?? 0,
                capturedAt: null,
              });
            }
          }}
          onSaved={() => {
            void loadCompetitors();
            void loadKeywordEvidence();
            handleDataChanged();
          }}
        />
        {/* ── Amazon 商品资料（V3.3） ── */}
        <div data-testid="workbench-browser">
          <SectionStatusBar
            loading={sectionLoading}
            error={sectionErrors.browser ?? ""}
            onRetry={() => { void loadBrowserEvidence(); }}
            loadingLabel="Amazon 页面证据"
          />
          <BrowserEvidenceSection
            taskId={taskId}
            evidence={browserEvidence}
            taskAsin={browserTaskAsin}
            storageVersion={browserEvidenceStorageVersion}
            capability={browserCapability}
            onChanged={() => { loadBrowserEvidence(); handleDataChanged(); }}
          />
        </div>
      </div>

      {/* Tab 2: 买家需求与评论 */}
      <div className={currentTab === "buyers" ? "space-y-4" : "hidden"} data-testid="workbench-panel-buyers">
        {/* ── 买家评论与需求（V3.4） ── */}
        <div id="formal-v2-buyer-evidence" data-testid="workbench-voc">
          <SectionStatusBar
            loading={sectionLoading}
            error={sectionErrors.voc ?? ""}
            onRetry={() => { void loadVoc(); }}
            loadingLabel="买家评论"
          />
          <VocEvidenceSection
            taskId={taskId}
            taskAsin={browserTaskAsin}
            evidence={vocEvidence}
            analysis={vocAnalysis}
            storageVersion={vocStorageVersion}
            capability={vocCapability}
            pendingPreview={vocPendingPreview}
            onChanged={() => { loadVoc(); handleDataChanged(); }}
          />
        </div>
      </div>

      {/* Tab 3: 货源与供应链 */}
      <div className={currentTab === "sourcing" ? "space-y-4" : "hidden"} data-testid="workbench-panel-sourcing">
        {/* ── 货源 资料（F2：真实 1688 供应线索工作台；证据序列 VOC 之后、AI 总结之前） ── */}
        <section id="formal-v2-sourcing-evidence" data-testid="workbench-sourcing" className="rounded-2xl border border-slate-200 bg-white p-4">
          <SourcingEvidencePanel
            taskId={taskId}
            amazonContext={{ title: null, image: sourceImageUrl ?? null, asin: null }}
            onEvidenceChange={(confirmed) => {
              setSourcingConfirmed(confirmed);
              handleDataChanged();
            }}
          />
        </section>
      </div>

      {/* Tab 4: 成本与风险 */}
      <div className={currentTab === "cost-risk" ? "space-y-4" : "hidden"} data-testid="workbench-panel-cost-risk">
        {/* ── 待补资料 ── */}
        <MissingSection gaps={gaps} />
        <CommercialInputsCard taskId={taskId} onChanged={() => handleDataChanged()} />
      </div>

      {/* ── 04: 紧凑的商品事实确认（折叠入口） ── */}
      <FactCandidateReview
        taskId={taskId}
        storageVersion={storageVersion}
        onChanged={() => handleDataChanged()}
      />

      {/* ── 待补资料 ── */}
      <p className="text-xs text-slate-400">
        资料 全部来自真实来源；AI 不创造事实。查看完整研究记录：
        <Link href={`/tasks/${encodeURIComponent(taskId)}`} className="ml-1 text-teal-700 underline">研究记录详情</Link>
      </p>
    </section>
  );
}

export type { DecisionStatus };
