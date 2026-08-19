"use client";

/**
 * Phase 2 — Evidence Workbench（商品证据工作台展示）
 *
 * 信息层级（Novice Comprehension）：简明结论 → 为什么这么说 → 原始 Evidence。
 * 六大区域：商品概览 / 市场 Evidence / 竞品 Evidence / 关键词 Evidence / 货源 Evidence / Missing。
 * 数据来源严格按 docs/v3/changes/phase-2/evidence-read-model.md；
 * 缺失一律显示 unknown/「未收集」，禁止 AI 填空、禁止编造。
 */
import { useEffect, useState } from "react";
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
  AiEvidenceSummarySection,
  type AiEvidenceSummaryView,
} from "@/components/evidence/AiEvidenceSummarySection";
import {
  BrowserEvidenceSection,
  parseBrowserEvidenceView,
  type BrowserEvidenceView,
} from "@/components/evidence/BrowserEvidenceSection";
import {
  VocEvidenceSection,
  parseVocAnalysisView,
  parseVocEvidenceView,
  type VocAnalysisView,
  type VocEvidenceView,
} from "@/components/evidence/VocEvidenceSection";
import { SourcingEvidencePanel } from "@/components/cross-border/SourcingEvidencePanel";
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
 * - ≥1 类已收集、未生成 AI 证据总结 → "研究进行中"（研究开始 ≠ AI 已运行）
 * - 已生成 AI 证据总结 → "AI 已整理当前资料"
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
      value: value || "unknown",
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

/** 商品事实期望字段集 = MANUAL_FACT_FIELDS（15）+ 采集核心 5 字段（category/price/rating/reviews/bsr） */
export const EXPECTED_FACT_FIELDS: ReadonlySet<string> = new Set([
  ...MANUAL_FACT_FIELDS.map((item) => item.field),
  "category",
  "price",
  "rating",
  "reviews",
  "bsr",
]);

/** overview 字段名 → 事实字段名的归一化别名（其余同名直接覆盖） */
const FACT_FIELD_ALIAS: Record<string, string> = {
  rootCategory: "category",
  rootCategoryBsr: "bsr",
  subCategoryBsr: "bsr",
};

/**
 * 已覆盖事实字段集：overview 已知项（归一化后）+ confirmed 字段。
 * 用于"已有 N 项 / 仍缺 M 项"计数（N=已覆盖，M=期望集 − 已覆盖）。
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
  for (const item of confirmed) covered.add(item.field);
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

/* ── 竞品 Evidence API 交互 ────────────────────────────── */

export type CompetitorAsinView = {
  asin: string;
  addedAt: string;
  note?: string;
};

type CompetitorApiResponse =
  | { ok: true; data: { evidence: { asins: CompetitorAsinView[] }; storageVersion: { resultJsonHash: string; updatedAt: string } } }
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

function OverviewGrid({ items }: { items: WorkbenchOverviewItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">暂无商品概览数据（来源未绑定 SellerSprite 批次）。</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((item) => (
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
  );
}

function MissingSection({ gaps }: { gaps: string[] }) {
  const fixed: Array<[string, string]> = [
    ["采购价", "unknown"],
    ["MOQ", "unknown"],
    ["物流成本", "unknown"],
    ["合规", "unknown"],
  ];
  return (
    <section data-testid="workbench-missing" className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
      <h3 className="text-sm font-bold text-slate-900">还缺什么（Missing）</h3>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fixed.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-amber-200 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-sm font-semibold text-rose-600">{value}</p>
          </div>
        ))}
      </div>
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

export function EvidenceWorkbench({
  taskId,
  result,
  onDataChanged,
  sourceImageUrl,
}: {
  taskId: string;
  result: Record<string, unknown> | null;
  /** R7：任一 Evidence 区确认/保存成功后冒泡（顶部"当前研究资料"据此重新计算） */
  onDataChanged?: () => void;
  /** V3 Final R9（§151）：Task 已确认主图，用于 1688 图片找货输入框自动预填 */
  sourceImageUrl?: string | null;
}) {
  const overview = extractOverviewItems(result);
  const decision = extractDecisionSummary(result);
  const gaps = extractEvidenceGaps(result);
  const keywordBrief = extractKeywordBrief(result);
  const score = extractCandidateScore(result);
  const source = extractReportSource(result);

  // V3 Final HWF（P1-03 一致性）：factCandidates 是唯一已确认事实权威；
  // 商品概览合并已确认事实（含标题派生字段），Summary 与基础资料计数统一以合并视图为准。
  const confirmedFacts = getFactCandidates(result)?.confirmed ?? [];
  const mergedOverview = mergeConfirmedIntoOverview(overview, confirmedFacts);
  const coveredFacts = coveredFactFieldSet(overview, confirmedFacts);
  const productBasicsDetail = `已有 ${coveredFacts.size} 项 / 仍缺 ${EXPECTED_FACT_FIELDS.size - coveredFacts.size} 项`;

  const [sourcingConfirmed, setSourcingConfirmed] = useState(false);
  const [competitors, setCompetitors] = useState<CompetitorAsinView[]>([]);
  const [storageVersion, setStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [competitorLoading, setCompetitorLoading] = useState(true);
  const [newAsin, setNewAsin] = useState("");
  const [newNote, setNewNote] = useState("");
  const [competitorError, setCompetitorError] = useState("");
  const [competitorBusy, setCompetitorBusy] = useState(false);

  const [keywordReportEvidence, setKeywordReportEvidence] = useState<KeywordEvidenceView | null>(null);
  const [keywordReportStorageVersion, setKeywordReportStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);

  const [aiSummary, setAiSummary] = useState<AiEvidenceSummaryView | null>(null);
  const [aiSummaryStorageVersion, setAiSummaryStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);

  const [browserEvidence, setBrowserEvidence] = useState<BrowserEvidenceView | null>(null);
  const [browserEvidenceStorageVersion, setBrowserEvidenceStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [browserTaskAsin, setBrowserTaskAsin] = useState<string | null>(null);
  const [browserCapability, setBrowserCapability] = useState<AcquisitionCapabilityView | null>(null);

  const [vocEvidence, setVocEvidence] = useState<VocEvidenceView | null>(null);
  const [vocAnalysis, setVocAnalysis] = useState<VocAnalysisView | null>(null);
  const [vocStorageVersion, setVocStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [vocCapability, setVocCapability] = useState<AcquisitionCapabilityView | null>(null);

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
        | { ok: true; data: { evidence: unknown; analysis: unknown; storageVersion: { resultJsonHash: string; updatedAt: string }; capability?: unknown } }
        | { ok: false };
      if (res.ok && json.ok) {
        setVocEvidence(parseVocEvidenceView(json.data.evidence));
        setVocAnalysis(parseVocAnalysisView(json.data.analysis));
        setVocStorageVersion(json.data.storageVersion);
        setVocCapability(parseAcquisitionCapability(json.data.capability));
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

  async function loadAiSummary() {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/ai-evidence-summary`, {
        headers: buildFetchHeaders(),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as
        | { ok: true; data: { summary: AiEvidenceSummaryView | null; storageVersion: { resultJsonHash: string; updatedAt: string } } }
        | { ok: false };
      if (res.ok && json.ok) {
        setAiSummary(json.data.summary);
        setAiSummaryStorageVersion(json.data.storageVersion);
        clearSectionError("aiSummary");
      } else {
        setSectionError("aiSummary", "AI 证据总结读取失败，请稍后重试。");
      }
    } catch {
      setSectionError("aiSummary", "AI 证据总结读取失败，请检查网络后重试。");
    }
  }

  async function loadKeywordEvidence() {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/keyword-evidence`, {
        headers: buildFetchHeaders(),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as
        | { ok: true; data: { evidence: KeywordEvidenceView | null; storageVersion: { resultJsonHash: string; updatedAt: string } } }
        | { ok: false };
      if (res.ok && json.ok) {
        setKeywordReportEvidence(json.data.evidence);
        setKeywordReportStorageVersion(json.data.storageVersion);
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
      loadAiSummary(),
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
  // 研究开始（有 1+ 类已收集 Evidence）≠ AI 总结已生成；绝不再用"研究尚未开始"表达"AI 未运行"。
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
  const researchStatus = deriveResearchStatus(materialRows, aiSummary);

  return (
    <section data-testid="evidence-workbench" className="mt-5 space-y-4">
      {/* R7：当前研究资料（从各 Evidence 区实时 state 派生，确认保存后自动更新） */}
      <section data-testid="research-evidence-checklist" className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-900">当前研究资料</p>
          {/* V3 Final R12：研究状态行（唯一语义：研究开始 ≠ AI 总结生成） */}
          <span
            data-testid="research-status-line"
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              researchStatus.status === "ai_ready"
                ? "bg-teal-50 text-teal-700"
                : researchStatus.status === "partial"
                  ? "bg-sky-50 text-sky-700"
                  : "bg-amber-50 text-amber-700"
            }`}
          >
            {researchStatus.status === "ai_ready"
              ? "AI 已整理当前资料"
              : researchStatus.status === "partial"
                ? "研究进行中"
                : "研究资料尚待补充"}
          </span>
        </div>
        {researchStatus.status === "partial" ? (
          <p className="mt-1.5 text-sm leading-6 text-slate-600" data-testid="research-status-detail">
            已收集{researchStatus.collectedLabels.join("、")}等资料；可继续补充其他 Evidence，或在下方生成 AI 证据总结。
          </p>
        ) : null}
        <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
          {materialRows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
              <span className="text-slate-700">{row.label}{row.detail ? <span className="ml-1 text-xs text-slate-400">（{row.detail}）</span> : null}</span>
              {row.key === "productBasics" && row.state === "待补" ? (
                <a
                  href="#fact-candidate-review"
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  data-testid="cta-product-basics"
                >
                  补充商品事实 →
                </a>
              ) : row.key === "browser" && row.state === "待补" ? (
                <a
                  href="#workbench-browser-evidence"
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  data-testid="cta-browser-collect"
                >
                  采集 Amazon 页面 →
                </a>
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  row.state === "已有"
                    ? "bg-teal-50 text-teal-700"
                    : row.state === "可选"
                      ? "bg-slate-100 text-slate-500"
                      : "bg-amber-50 text-amber-700"
                }`}>
                  {row.state}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-400">下方各区可直接补充资料；确认保存后，这里的状态会自动更新。</p>
      </section>

      {/* V3 UX Closure：Fact Candidate Review（商品基础资料待补时的就地补充入口） */}
      <FactCandidateReview
        taskId={taskId}
        storageVersion={storageVersion}
        onChanged={() => onDataChanged?.()}
      />

      {/* ── 简明结论（首屏） ── */}
      <section data-testid="workbench-summary" className="rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
        <h3 className="text-sm font-bold text-slate-900">简明结论</h3>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">目前知道什么</dt>
            <dd className="mt-0.5 text-slate-800">
              {overview.some((item) => item.value !== "unknown") || confirmedFacts.length > 0
                ? `已整理商品概览 ${mergedOverview.filter((item) => item.value !== "unknown").length} 项、已确认 ${confirmedFacts.length} 条商品事实。`
                : "暂无已确认的商品证据。"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">目前不知道什么</dt>
            <dd className="mt-0.5 text-slate-800">采购价 / MOQ / 物流成本 / 合规均为 unknown（未用 AI 填补）。</dd>
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

      {/* ── 商品概览 ── */}
      <section data-testid="workbench-overview" className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">商品概览</h3>
          {source && (
            <span className="text-xs text-slate-500">
              {source.reportType} · {source.marketplace} · capturedAt {source.capturedAt || "unknown"}
            </span>
          )}
        </div>
        <div className="mt-3">
          <OverviewGrid items={mergedOverview} />
        </div>
        {source?.evidenceHash && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-500">原始 Evidence（来源追溯）</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              {JSON.stringify({ evidenceHash: source.evidenceHash, reportType: source.reportType, capturedAt: source.capturedAt }, null, 2)}
            </pre>
          </details>
        )}
      </section>

      {/* ── 竞品 Evidence ── */}
      <section data-testid="workbench-competitors" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">竞品 Evidence（人工维护，最多 5 个）</h3>
        {competitorLoading ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />读取中…</p>
        ) : competitors.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">未维护。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {competitors.map((entry) => (
              <li key={entry.asin} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{entry.asin}</p>
                  <p className="text-xs text-slate-500">
                    人工添加 · {entry.addedAt?.slice(0, 10)}{entry.note ? ` · ${entry.note}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={competitorBusy}
                  onClick={() => void mutateCompetitor("DELETE", { asin: entry.asin })}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  aria-label={`删除竞品 ${entry.asin}`}
                >
                  <Trash2 className="size-3.5" />删除
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs text-slate-500">
            ASIN
            <input
              value={newAsin}
              onChange={(event) => setNewAsin(event.target.value.toUpperCase())}
              placeholder="如 B0XXXXXXXXX（10 位）"
              maxLength={10}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-slate-500">
            备注（可选）
            <input
              value={newNote}
              onChange={(event) => setNewNote(event.target.value)}
              maxLength={500}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => void mutateCompetitor("POST", { asin: newAsin.trim(), note: newNote.trim() || undefined })}
            className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
          >
            <Plus className="size-4" />添加
          </button>
        </div>
        {competitors.length >= 5 && (
          <p className="mt-1 text-xs text-amber-600">已达上限 5 个，请先删除再添加。</p>
        )}
        {competitorError && <p className="mt-2 text-sm text-rose-600">{competitorError}</p>}
      </section>

      {/* ── 关键词 Evidence ── */}
      <section data-testid="workbench-keywords" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">关键词 Evidence</h3>
        <SectionStatusBar
          loading={sectionLoading}
          error={sectionErrors.keyword ?? ""}
          onRetry={() => { void loadKeywordEvidence(); }}
          loadingLabel="关键词证据"
        />
        {keywordBrief ? (
          <div className="mt-2 space-y-1 text-sm text-slate-800">
            <p><span className="text-slate-500">主关键词：</span>{keywordBrief.primaryKeyword || "—"}</p>
            {keywordBrief.supportingKeywords.length > 0 && (
              <p><span className="text-slate-500">辅助关键词：</span>{keywordBrief.supportingKeywords.join("、")}</p>
            )}
            {keywordBrief.backendSearchTerms.length > 0 && (
              <p><span className="text-slate-500">后台搜索词：</span>{keywordBrief.backendSearchTerms.join("、")}</p>
            )}
            <p className="text-xs text-slate-500">
              来源：{keywordBrief.source || "unknown"}
              {keywordBrief.reportType ? ` · 报告：${keywordBrief.reportType}` : ""}
              {keywordBrief.marketplace ? ` · 市场：${keywordBrief.marketplace}` : ""}
              {keywordBrief.month ? ` · 数据期：${keywordBrief.month}` : ""}
              {keywordBrief.asin ? ` · ASIN：${keywordBrief.asin}` : ""}
            </p>
            {(keywordBrief.evidenceRef || keywordBrief.reportHash) && (
              <p className="text-xs text-slate-400">
                追溯：{keywordBrief.evidenceRef ? `evidenceRef ${keywordBrief.evidenceRef.slice(0, 16)}…` : ""}
                {keywordBrief.reportHash ? ` · reportHash ${keywordBrief.reportHash.slice(0, 16)}…` : ""}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">关键词 Brief 未生成（人工确认后可进入）。</p>
        )}
        <KeywordReportEvidenceSection
          taskId={taskId}
          evidence={keywordReportEvidence}
          storageVersion={keywordReportStorageVersion}
          onChanged={() => { loadKeywordEvidence(); onDataChanged?.(); }}
        />
      </section>

      {/* ── 浏览器 Evidence（V3.3） ── */}
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
          onChanged={() => { loadBrowserEvidence(); onDataChanged?.(); }}
        />
      </div>

      {/* ── VOC / Review Evidence（V3.4） ── */}
      <div data-testid="workbench-voc">
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
          onChanged={() => { loadVoc(); onDataChanged?.(); }}
        />
      </div>

      {/* ── 货源 Evidence（F2：真实 1688 供应线索工作台；证据序列 VOC 之后、AI 总结之前） ── */}
      <section data-testid="workbench-sourcing" className="rounded-2xl border border-slate-200 bg-white p-4">
        <SourcingEvidencePanel
          taskId={taskId}
          amazonContext={{ title: null, image: sourceImageUrl ?? null, asin: null }}
          onEvidenceChange={setSourcingConfirmed}
        />
      </section>

      {/* ── AI 证据总结（Phase 5） ── */}
      <section data-testid="workbench-ai-summary" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">AI 证据总结</h3>
        <SectionStatusBar
          loading={sectionLoading}
          error={sectionErrors.aiSummary ?? ""}
          onRetry={() => { void loadAiSummary(); }}
          loadingLabel="AI 证据总结"
        />
        <p className="mt-1 text-xs text-slate-500">
          AI 只解释已有 Evidence，不创造事实；fact/risk/conflict 必须带证据引用。
        </p>
        <AiEvidenceSummarySection
          taskId={taskId}
          summary={aiSummary}
          storageVersion={aiSummaryStorageVersion}
          onChanged={loadAiSummary}
        />
      </section>

      {/* ── Missing ── */}
      <MissingSection gaps={gaps} />

      <p className="text-xs text-slate-400">
        Evidence 全部来自真实来源；AI 不创造事实。查看完整研究记录：
        <Link href={`/tasks/${encodeURIComponent(taskId)}`} className="ml-1 text-teal-700 underline">研究记录详情</Link>
      </p>
    </section>
  );
}

export type { DecisionStatus };
