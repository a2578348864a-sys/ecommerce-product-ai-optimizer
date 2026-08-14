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
import type { DecisionStatus } from "@/lib/tasks/decisionStatus";

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
  const facts = batchSnapshot && isRecord(batchSnapshot.productFacts)
    ? batchSnapshot.productFacts
    : null;
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
} | null {
  if (!isRecord(result)) return null;
  const brief = isRecord(result.listingKeywordBrief) ? result.listingKeywordBrief : null;
  if (!brief) return null;
  return {
    primaryKeyword: text(brief.primaryKeyword),
    supportingKeywords: Array.isArray(brief.supportingKeywords)
      ? brief.supportingKeywords.filter((v): v is string => typeof v === "string")
      : [],
    backendSearchTerms: Array.isArray(brief.backendSearchTerms)
      ? brief.backendSearchTerms.filter((v): v is string => typeof v === "string")
      : [],
    source: text(brief.source),
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
  const headers = new Headers(extra);
  const token = typeof window !== "undefined" ? window.sessionStorage.getItem("qx:access-token") : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
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
}: {
  taskId: string;
  result: Record<string, unknown> | null;
}) {
  const overview = extractOverviewItems(result);
  const decision = extractDecisionSummary(result);
  const gaps = extractEvidenceGaps(result);
  const keywordBrief = extractKeywordBrief(result);
  const score = extractCandidateScore(result);
  const source = extractReportSource(result);

  const [competitors, setCompetitors] = useState<CompetitorAsinView[]>([]);
  const [storageVersion, setStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [competitorLoading, setCompetitorLoading] = useState(true);
  const [newAsin, setNewAsin] = useState("");
  const [newNote, setNewNote] = useState("");
  const [competitorError, setCompetitorError] = useState("");
  const [competitorBusy, setCompetitorBusy] = useState(false);

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

  return (
    <section data-testid="evidence-workbench" className="mt-5 space-y-4">
      {/* ── 简明结论（首屏） ── */}
      <section data-testid="workbench-summary" className="rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
        <h3 className="text-sm font-bold text-slate-900">简明结论</h3>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">目前知道什么</dt>
            <dd className="mt-0.5 text-slate-800">
              {overview.some((item) => item.value !== "unknown")
                ? `已整理商品概览 ${overview.filter((item) => item.value !== "unknown").length} 项真实证据。`
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
          <OverviewGrid items={overview} />
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
        {keywordBrief ? (
          <div className="mt-2 space-y-1 text-sm text-slate-800">
            <p><span className="text-slate-500">主关键词：</span>{keywordBrief.primaryKeyword || "—"}</p>
            {keywordBrief.supportingKeywords.length > 0 && (
              <p><span className="text-slate-500">辅助关键词：</span>{keywordBrief.supportingKeywords.join("、")}</p>
            )}
            {keywordBrief.backendSearchTerms.length > 0 && (
              <p><span className="text-slate-500">后台搜索词：</span>{keywordBrief.backendSearchTerms.join("、")}</p>
            )}
            <p className="text-xs text-slate-500">来源：{keywordBrief.source || "unknown"}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">关键词 Brief 未生成（人工确认后可进入）。</p>
        )}
      </section>

      {/* ── 货源 Evidence ── */}
      <section data-testid="workbench-sourcing" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">货源 Evidence</h3>
        <p className="mt-2 text-sm text-slate-500">
          Core 阶段货源证据未收集（采购价 / MOQ / 物流均 unknown）。
        </p>
      </section>

      {/* ── Missing ── */}
      <MissingSection gaps={gaps} />

      <p className="text-xs text-slate-400">
        Evidence 全部来自真实来源；AI 不创造事实。查看完整研究记录：
        <Link href={`/tasks/${encodeURIComponent(taskId)}`} className="ml-1 text-teal-700 underline">研究历史详情</Link>
      </p>
    </section>
  );
}

export type { DecisionStatus };
