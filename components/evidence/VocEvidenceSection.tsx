"use client";

/**
 * V3.4 — VOC / Review Evidence 工作台区域
 *
 * 新手默认看到：用户喜欢什么 / 不满意什么 / 使用场景 / 零散信号 / 仍然不知道什么 / 下一步。
 * 每个主题可展开"为什么这么说"：引用 Review 数量、原文、星级、来源 ASIN、当前商品/竞品、capturedAt、sourceRef。
 * 样本量显式；当前商品 vs 竞品明确区分；单边样本提示；绝不显示"分析了全部评论"除非真实全部。
 */
import { useCallback, useEffect, useState } from "react";
import { BarChart3, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { useSessionDraft } from "@/lib/client/useSessionDraft";

function buildFetchHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ ...buildAccessHeaders(), ...extra });
}

/* ── 前端投影类型（安全子集；不引入 server-only 模块） ── */

export type VocReviewView = {
  evidenceId: string;
  reviewId: string | null;
  productAsin: string;
  sourceProductRole: "current_candidate" | "competitor";
  reviewTitle: string | null;
  reviewText: string;
  rating: number | null;
  reviewDate: string | null;
  locale: string | null;
  capturedAt: string;
  sourceRef: string | null;
};

export type VocStatsView = {
  totalReviews: number;
  reviewsUsed: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  ratingDistribution: Array<{ rating: number; count: number }>;
  capturePeriod: { from: string | null; to: string | null };
  sourceProductCount: number;
  currentCandidateCount: number;
  competitorCount: number;
};

export type VocThemeView = {
  themeId: string;
  label: string;
  summary: string;
  evidenceRefs: string[];
  sourceProductRoles: Array<"current_candidate" | "competitor">;
  reviewCount: number;
  coverage: number;
  strength: "isolated" | "weak" | "recurring";
  limitations: string | null;
};

export type VocConflictView = {
  themeId: string;
  label: string;
  summary: string;
  positive: { evidenceRefs: string[]; reviewCount: number };
  negative: { evidenceRefs: string[]; reviewCount: number };
  note: string | null;
};

export type VocAnalysisView = {
  runId: string;
  model: string;
  promptVersion: string;
  inputEvidenceHash: string;
  datasetSnapshot: { totalReviews: number; reviewsUsed: number };
  startedAt: string;
  finishedAt: string;
  gateResult: "pass" | "fail";
  themes: {
    positiveThemes: VocThemeView[];
    painPointThemes: VocThemeView[];
    usageScenarios: VocThemeView[];
    recurringRequests: VocThemeView[];
    conflicts: VocConflictView[];
    weakSignals: VocThemeView[];
  };
  unknowns: string[];
  nextResearchSteps: string[];
  unverified: VocThemeView[];
};

export type VocEvidenceView = {
  candidateId: string | null;
  dataset: {
    reviews: VocReviewView[];
    stats: VocStatsView;
    sampling: { method: string; note: string | null; reviewsAvailable: number | null };
    updatedAt: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseReview(value: unknown): VocReviewView | null {
  if (!isRecord(value)) return null;
  return {
    evidenceId: asString(value.evidenceId),
    reviewId: value.reviewId === null || value.reviewId === undefined ? null : asString(value.reviewId) || null,
    productAsin: asString(value.productAsin),
    sourceProductRole: value.sourceProductRole === "competitor" ? "competitor" : "current_candidate",
    reviewTitle: value.reviewTitle === null || value.reviewTitle === undefined ? null : asString(value.reviewTitle) || null,
    reviewText: asString(value.reviewText),
    rating: asNumber(value.rating),
    reviewDate: value.reviewDate === null || value.reviewDate === undefined ? null : asString(value.reviewDate) || null,
    locale: value.locale === null || value.locale === undefined ? null : asString(value.locale) || null,
    capturedAt: asString(value.capturedAt),
    sourceRef: value.sourceRef === null || value.sourceRef === undefined ? null : asString(value.sourceRef) || null,
  };
}

function parseTheme(value: unknown): VocThemeView | null {
  if (!isRecord(value)) return null;
  const reviewCount = asNumber(value.reviewCount) ?? 0;
  return {
    themeId: asString(value.themeId),
    label: asString(value.label),
    summary: asString(value.summary),
    evidenceRefs: Array.isArray(value.evidenceRefs) ? value.evidenceRefs.filter((ref): ref is string => typeof ref === "string") : [],
    sourceProductRoles: Array.isArray(value.sourceProductRoles)
      ? value.sourceProductRoles.filter((role): role is "current_candidate" | "competitor" => role === "current_candidate" || role === "competitor")
      : [],
    reviewCount,
    coverage: asNumber(value.coverage) ?? 0,
    strength: value.strength === "weak" || value.strength === "recurring" ? value.strength : "isolated",
    limitations: value.limitations === null || value.limitations === undefined ? null : asString(value.limitations) || null,
  };
}

function parseThemeList(value: unknown): VocThemeView[] {
  return Array.isArray(value) ? value.map(parseTheme).filter((theme): theme is VocThemeView => theme !== null) : [];
}

export function parseVocAnalysisView(value: unknown): VocAnalysisView | null {
  if (!isRecord(value) || value.schema !== "voc-analysis.v1" || value.version !== 1) return null;
  const themes = isRecord(value.themes) ? value.themes : {};
  return {
    runId: asString(value.runId),
    model: asString(value.model),
    promptVersion: asString(value.promptVersion),
    inputEvidenceHash: asString(value.inputEvidenceHash),
    datasetSnapshot: isRecord(value.datasetSnapshot)
      ? { totalReviews: asNumber(value.datasetSnapshot.totalReviews) ?? 0, reviewsUsed: asNumber(value.datasetSnapshot.reviewsUsed) ?? 0 }
      : { totalReviews: 0, reviewsUsed: 0 },
    startedAt: asString(value.startedAt),
    finishedAt: asString(value.finishedAt),
    gateResult: value.gateResult === "fail" ? "fail" : "pass",
    themes: {
      positiveThemes: parseThemeList(themes.positiveThemes),
      painPointThemes: parseThemeList(themes.painPointThemes),
      usageScenarios: parseThemeList(themes.usageScenarios),
      recurringRequests: parseThemeList(themes.recurringRequests),
      conflicts: Array.isArray(themes.conflicts)
        ? themes.conflicts.map((raw): VocConflictView | null => {
            if (!isRecord(raw)) return null;
            const positive = isRecord(raw.positive) ? raw.positive : null;
            const negative = isRecord(raw.negative) ? raw.negative : null;
            if (!positive || !negative) return null;
            return {
              themeId: asString(raw.themeId),
              label: asString(raw.label),
              summary: asString(raw.summary),
              positive: {
                evidenceRefs: Array.isArray(positive.evidenceRefs) ? positive.evidenceRefs.filter((ref): ref is string => typeof ref === "string") : [],
                reviewCount: asNumber(positive.reviewCount) ?? 0,
              },
              negative: {
                evidenceRefs: Array.isArray(negative.evidenceRefs) ? negative.evidenceRefs.filter((ref): ref is string => typeof ref === "string") : [],
                reviewCount: asNumber(negative.reviewCount) ?? 0,
              },
              note: raw.note === null || raw.note === undefined ? null : asString(raw.note) || null,
            };
          }).filter((conflict): conflict is VocConflictView => conflict !== null)
        : [],
      weakSignals: parseThemeList(themes.weakSignals),
    },
    unknowns: Array.isArray(value.unknowns) ? value.unknowns.filter((item): item is string => typeof item === "string") : [],
    nextResearchSteps: Array.isArray(value.nextResearchSteps) ? value.nextResearchSteps.filter((item): item is string => typeof item === "string") : [],
    unverified: parseThemeList(value.unverified),
  };
}

export function parseVocEvidenceView(value: unknown): VocEvidenceView | null {
  if (!isRecord(value) || value.schema !== "review-evidence.v1" || value.version !== 1) return null;
  const dataset = isRecord(value.dataset) ? value.dataset : null;
  if (!dataset || !Array.isArray(dataset.reviews)) return null;
  const reviews = dataset.reviews.map(parseReview).filter((review): review is VocReviewView => review !== null);
  const stats = isRecord(dataset.stats) ? dataset.stats : null;
  return {
    candidateId: value.candidateId === null || value.candidateId === undefined ? null : asString(value.candidateId) || null,
    dataset: {
      reviews,
      stats: stats
        ? {
            totalReviews: asNumber(stats.totalReviews) ?? reviews.length,
            reviewsUsed: asNumber(stats.reviewsUsed) ?? reviews.length,
            positiveCount: asNumber(stats.positiveCount) ?? 0,
            negativeCount: asNumber(stats.negativeCount) ?? 0,
            neutralCount: asNumber(stats.neutralCount) ?? 0,
            ratingDistribution: Array.isArray(stats.ratingDistribution)
              ? stats.ratingDistribution.map((raw): { rating: number; count: number } | null => {
                  if (!isRecord(raw)) return null;
                  const rating = asNumber(raw.rating);
                  const count = asNumber(raw.count);
                  return rating !== null && count !== null ? { rating, count } : null;
                }).filter((item): item is { rating: number; count: number } => item !== null)
              : [],
            capturePeriod: isRecord(stats.capturePeriod)
              ? {
                  from: stats.capturePeriod.from === null || stats.capturePeriod.from === undefined ? null : asString(stats.capturePeriod.from) || null,
                  to: stats.capturePeriod.to === null || stats.capturePeriod.to === undefined ? null : asString(stats.capturePeriod.to) || null,
                }
              : { from: null, to: null },
            sourceProductCount: asNumber(stats.sourceProductCount) ?? 0,
            currentCandidateCount: asNumber(stats.currentCandidateCount) ?? 0,
            competitorCount: asNumber(stats.competitorCount) ?? 0,
          }
        : {
            totalReviews: reviews.length,
            reviewsUsed: reviews.length,
            positiveCount: 0,
            negativeCount: 0,
            neutralCount: 0,
            ratingDistribution: [],
            capturePeriod: { from: null, to: null },
            sourceProductCount: 0,
            currentCandidateCount: 0,
            competitorCount: 0,
          },
      sampling: isRecord(dataset.sampling)
        ? {
            method: asString(dataset.sampling.method, "manual_selected"),
            note: dataset.sampling.note === null || dataset.sampling.note === undefined ? null : asString(dataset.sampling.note) || null,
            reviewsAvailable: asNumber(dataset.sampling.reviewsAvailable),
          }
        : { method: "manual_selected", note: null, reviewsAvailable: null },
      updatedAt: asString(dataset.updatedAt),
    },
  };
}

/* ── 展示工具 ── */

const STRENGTH_LABEL: Record<VocThemeView["strength"], string> = {
  isolated: "个例（1 条）",
  weak: "少量（2-3 条）",
  recurring: "反复出现（4+ 条）",
};

const STRENGTH_CLASS: Record<VocThemeView["strength"], string> = {
  isolated: "border-slate-200 bg-slate-50 text-slate-500",
  weak: "border-amber-200 bg-amber-50 text-amber-700",
  recurring: "border-rose-200 bg-rose-50 text-rose-600",
};

function RoleBadge({ role }: { role: "current_candidate" | "competitor" }) {
  return role === "competitor"
    ? <span className="rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-600">竞品评论</span>
    : <span className="rounded-full border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-700">当前商品评论</span>;
}

function percent(coverage: number): string {
  return `${Math.round(coverage * 100)}%`;
}

function ThemeCard({
  theme,
  reviewsById,
}: {
  theme: VocThemeView;
  reviewsById: Map<string, VocReviewView>;
}) {
  const refs = theme.evidenceRefs.map((ref) => reviewsById.get(ref)).filter((review): review is VocReviewView => review !== undefined);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-sm font-semibold text-slate-900">{theme.label}</p>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STRENGTH_CLASS[theme.strength]}`}>
          {STRENGTH_LABEL[theme.strength]}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-700">{theme.summary}</p>
      <p className="mt-1 text-xs text-slate-500">
        引用 {theme.reviewCount} 条 · 占当前样本 {percent(theme.coverage)}
        {theme.sourceProductRoles.map((role) => <RoleBadge key={role} role={role} />)}
      </p>
      {theme.limitations && <p className="mt-1 text-xs text-amber-700">{theme.limitations}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-teal-700">为什么这么说（查看引用评论）</summary>
        <ul className="mt-2 space-y-2">
          {refs.length === 0 && <li className="text-xs text-slate-400">无可用引用（引用评论已被清空）。</li>}
          {refs.map((review) => (
            <li key={review.evidenceId} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2">
              <p className="text-[11px] text-slate-400">
                {review.sourceProductRole === "competitor" ? "竞品" : "当前商品"} · ASIN {review.productAsin}
                {review.rating !== null ? ` · ${review.rating} 星` : ""}
                {review.reviewDate ? ` · ${review.reviewDate}` : ""}
                {review.capturedAt ? ` · 采集 ${review.capturedAt.slice(0, 10)}` : ""}
                {review.sourceRef ? ` · ${review.sourceRef.slice(0, 40)}` : ""}
                {review.locale ? ` · ${review.locale}` : ""}
              </p>
              {review.reviewTitle && <p className="mt-0.5 text-xs font-semibold text-slate-700">{review.reviewTitle}</p>}
              <p className="mt-0.5 text-xs text-slate-600">{review.reviewText}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ConflictCard({ conflict, reviewsById }: { conflict: VocConflictView; reviewsById: Map<string, VocReviewView> }) {
  const positiveRefs = conflict.positive.evidenceRefs.map((ref) => reviewsById.get(ref)).filter((review): review is VocReviewView => review !== undefined);
  const negativeRefs = conflict.negative.evidenceRefs.map((ref) => reviewsById.get(ref)).filter((review): review is VocReviewView => review !== undefined);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-semibold text-slate-900">{conflict.label}</p>
      <p className="mt-1 text-sm text-slate-700">{conflict.summary}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-2">
          <p className="text-xs font-semibold text-teal-700">正面观点（{conflict.positive.reviewCount} 条）</p>
          <ul className="mt-1 space-y-1">
            {positiveRefs.map((review) => (
              <li key={review.evidenceId} className="text-xs text-slate-600">· {review.reviewText}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-2">
          <p className="text-xs font-semibold text-rose-600">负面观点（{conflict.negative.reviewCount} 条）</p>
          <ul className="mt-1 space-y-1">
            {negativeRefs.map((review) => (
              <li key={review.evidenceId} className="text-xs text-slate-600">· {review.reviewText}</li>
            ))}
          </ul>
        </div>
      </div>
      {conflict.note && <p className="mt-1 text-xs text-slate-400">{conflict.note}</p>}
    </div>
  );
}

function ThemeSection({
  title,
  emptyText,
  themes,
  reviewsById,
}: {
  title: string;
  emptyText: string;
  themes: VocThemeView[];
  reviewsById: Map<string, VocReviewView>;
}) {
  return (
    <section data-testid={`voc-section-${title}`} className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {themes.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {themes.map((theme) => <ThemeCard key={theme.themeId} theme={theme} reviewsById={reviewsById} />)}
        </div>
      )}
    </section>
  );
}

/* ── 主组件 ── */

export function VocEvidenceSection({
  taskId,
  evidence,
  analysis,
  storageVersion,
  onChanged,
}: {
  taskId: string;
  evidence: VocEvidenceView | null;
  analysis: VocAnalysisView | null;
  storageVersion: { resultJsonHash: string; updatedAt: string } | null;
  onChanged: () => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importAsin, setImportAsin] = useState("");
  const [importRole, setImportRole] = useState<"current_candidate" | "competitor">("current_candidate");
  const [importRating, setImportRating] = useState("");
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // F5：VOC 导入草稿会话持久化（刷新不丢输入；revision = storageVersion，任务更新后旧草稿安全失效）
  const vocDraft = useSessionDraft<{
    importText: string;
    importAsin: string;
    importRole: "current_candidate" | "competitor";
    importRating: string;
  }>({
    pageKind: "voc-import",
    entityId: taskId,
    revision: storageVersion ? `${storageVersion.resultJsonHash}:${storageVersion.updatedAt}` : null,
    initial: { importText: "", importAsin: "", importRole: "current_candidate", importRating: "" },
  });
  // 恢复（仅草稿校验通过后一次性灌入组件 state；组件 state 才是输入权威）
  useEffect(() => {
    if (vocDraft.draft && vocDraft.restored) {
      setImportText(vocDraft.draft.importText);
      setImportAsin(vocDraft.draft.importAsin);
      setImportRole(vocDraft.draft.importRole);
      setImportRating(vocDraft.draft.importRating);
    }
  }, [vocDraft.draft, vocDraft.restored]);
  // 写入（防抖）
  useEffect(() => {
    vocDraft.save({ importText, importAsin, importRole, importRating });
  }, [importText, importAsin, importRole, importRating, vocDraft]);

  const reviewsById = useCallback(() => {
    const map = new Map<string, VocReviewView>();
    for (const review of evidence?.dataset.reviews ?? []) map.set(review.evidenceId, review);
    return map;
  }, [evidence]);

  async function runImport() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const lines = importText.split("\n").map((line) => line.trim()).filter(Boolean);
      const rating = importRating.trim() ? Number(importRating.trim()) : null;
      const reviews = lines.map((text) => ({
        asin: importAsin.trim().toUpperCase(),
        sourceProductRole: importRole,
        reviewText: text,
        rating,
      }));
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/review-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "import", expectedStorageVersion: storageVersion, reviews }),
      });
      const json = await res.json() as
        | { ok: true; data: { outcome: { importedCount: number; duplicateCount: number; rejectedCount: number } } }
        | { ok: false; error?: { code?: string; message?: string } };
      if (!res.ok || !json.ok) {
        const code = (json as { error?: { code?: string } }).error?.code ?? "";
        if (code === "task_result_conflict") {
          // F5：同任务其它区块更新导致 CAS 冲突 → 保留 draft、刷新最新版本、提示一键重试
          setError("任务内容刚在其他区块更新，已自动刷新最新版本；你已输入的评论已保留，请再次点击导入。");
          onChanged();
          return;
        }
        setError((json as { error?: { message?: string } }).error?.message ?? "导入失败。");
        return;
      }
      const outcome = json.data.outcome;
      setNotice(`已导入 ${outcome.importedCount} 条；重复 ${outcome.duplicateCount} 条；拒绝 ${outcome.rejectedCount} 条。`);
      setImportText("");
      setImportRating("");
      setImportOpen(false);
      vocDraft.clear();
      onChanged();
    } catch {
      setError("导入失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function runAnalyze() {
    setAnalyzing(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/review-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "analyze", expectedStorageVersion: storageVersion }),
      });
      const json = await res.json() as
        | { ok: true; data: { gateResult: string; unverified: number } }
        | { ok: false; error?: { code?: string; message?: string } };
      if (!res.ok || !json.ok) {
        setError((json as { error?: { message?: string } }).error?.message ?? "VOC 分析失败。");
        return;
      }
      setNotice(json.data.gateResult === "fail"
        ? `分析完成，但 ${json.data.unverified} 个主题因缺少有效评论引用未被采用。`
        : "分析完成。");
      onChanged();
    } catch {
      setError("VOC 分析失败，请稍后重试。");
    } finally {
      setAnalyzing(false);
    }
  }

  async function runClear() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/review-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "clear", expectedStorageVersion: storageVersion }),
      });
      const json = await res.json() as
        | { ok: true } | { ok: false; error?: { code?: string; message?: string } };
      if (!res.ok || !json.ok) {
        setError((json as { error?: { message?: string } }).error?.message ?? "清空失败。");
        return;
      }
      setNotice("已清空评论数据集（同步清除旧分析）。");
      onChanged();
    } catch {
      setError("清空失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  const stats = evidence?.dataset.stats;
  const reviewsMap = reviewsById();
  const canImport = importText.trim().length > 0 && importAsin.trim().length > 0 && !busy;
  const canAnalyze = (evidence?.dataset.reviews.length ?? 0) > 0 && !analyzing && !busy;
  // 单边样本提示（低星集合伪装完整 VOC）
  const negativeBiased = stats !== undefined && stats.totalReviews > 0 && stats.positiveCount === 0 && stats.negativeCount > 0;
  const positiveBiased = stats !== undefined && stats.totalReviews > 0 && stats.negativeCount === 0 && stats.positiveCount > 0;
  const usedAll = stats !== undefined && stats.totalReviews > 0 && stats.reviewsUsed === stats.totalReviews;

  return (
    <section data-testid="workbench-voc" className="mt-4 space-y-3">
      <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">VOC — 真实买家评论怎么看这个商品</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              评论是用户观点证据，不是商品事实；所有主题都回链到真实评论。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || analyzing}
              onClick={() => { setImportOpen((open) => !open); setError(""); }}
              className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
            >
              <Plus className="size-4" />导入评论
            </button>
            <button
              type="button"
              disabled={!canAnalyze}
              onClick={() => void runAnalyze()}
              className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
              {analyzing ? "分析中…（约 10-30 秒）" : "开始 VOC 分析"}
            </button>
            {(evidence?.dataset.reviews.length ?? 0) > 0 && (
              <button
                type="button"
                disabled={busy || analyzing}
                onClick={() => void runClear()}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              >
                <Trash2 className="size-4" />清空
              </button>
            )}
          </div>
        </div>

        {/* 导入表单 */}
        {importOpen && (
          <div className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs text-slate-500">
              人工导入真实评论（每行一条；同一 ASIN 与角色批量导入）。评论文本是数据，不会执行任何内容。
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <label className="text-xs text-slate-500">
                ASIN（必填）
                <input
                  value={importAsin}
                  onChange={(event) => setImportAsin(event.target.value.toUpperCase())}
                  placeholder="B0XXXXXXXXX"
                  maxLength={10}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-slate-500">
                评论来源角色
                <select
                  value={importRole}
                  onChange={(event) => setImportRole(event.target.value as "current_candidate" | "competitor")}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="current_candidate">当前商品</option>
                  <option value="competitor">竞品</option>
                </select>
              </label>
              <label className="text-xs text-slate-500">
                星级（可选 1-5）
                <input
                  value={importRating}
                  onChange={(event) => setImportRating(event.target.value.replace(/[^0-5]/g, "").slice(0, 1))}
                  placeholder="如 4"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={"每行一条评论原文，例如：\nFits perfectly and feels premium.\nAssembly instructions are confusing."}
              rows={5}
              className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={!canImport}
                onClick={() => void runImport()}
                className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                确认导入
              </button>
              <span className="text-[11px] text-slate-400">单商品最多 100 条；数据集最多 300 条；单条最多 2000 字符。</span>
            </div>
          </div>
        )}

        {/* 样本量（显式） */}
        {stats && stats.totalReviews > 0 && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">样本：{stats.totalReviews} 条</span>
              <span>本次分析使用 {stats.reviewsUsed} 条{usedAll ? "" : "（部分样本）"}</span>
              <span>高星 {stats.positiveCount}</span>
              <span>低星 {stats.negativeCount}</span>
              <span>中性 {stats.neutralCount}</span>
              <span>商品 {stats.sourceProductCount} 个（当前 {stats.currentCandidateCount} / 竞品 {stats.competitorCount}）</span>
              {stats.capturePeriod.from && <span>评论期 {stats.capturePeriod.from.slice(0, 10)} ~ {stats.capturePeriod.to?.slice(0, 10)}</span>}
              {evidence?.dataset.sampling.note && <span>采样说明：{evidence.dataset.sampling.note}</span>}
            </div>
            {stats.ratingDistribution.length > 0 && (
              <div className="mt-2 flex items-end gap-1">
                {stats.ratingDistribution.map(({ rating, count }) => (
                  <div key={rating} className="flex flex-col items-center">
                    <span className="text-[10px] text-slate-500">{count}</span>
                    <div className="w-6 rounded-t bg-violet-300" style={{ height: `${Math.max(2, (count / Math.max(1, stats.totalReviews)) * 48)}px` }} />
                    <span className="text-[10px] text-slate-500">{rating}★</span>
                  </div>
                ))}
              </div>
            )}
            {negativeBiased && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                当前样本为低星评论集合（没有高星评论），结论偏负面，不代表完整用户反馈。
              </p>
            )}
            {positiveBiased && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                当前样本为高星评论集合（没有低星评论），结论偏正面，不代表完整用户反馈。
              </p>
            )}
          </div>
        )}

        {evidence === null && !importOpen && (
          <p className="mt-3 text-sm text-slate-500">
            还没有评论证据。点击「导入评论」粘贴真实买家评论（当前商品或竞品），或先用少量样本体验。
          </p>
        )}
        {notice && <p className="mt-2 text-sm text-teal-700">{notice}</p>}
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </div>

      {/* 分析结果（新手六区） */}
      {analysis && (
        <div className="space-y-3">
          <ThemeSection
            title="用户喜欢什么"
            emptyText="当前样本中没有形成正面主题（或没有高星评论）。"
            themes={analysis.themes.positiveThemes}
            reviewsById={reviewsMap}
          />
          <ThemeSection
            title="用户反复抱怨什么"
            emptyText="当前样本中没有形成痛点主题。"
            themes={analysis.themes.painPointThemes}
            reviewsById={reviewsMap}
          />
          <ThemeSection
            title="用户在什么场景下使用"
            emptyText="当前样本中没有识别出使用场景。"
            themes={analysis.themes.usageScenarios}
            reviewsById={reviewsMap}
          />
          <ThemeSection
            title="用户期望什么改进"
            emptyText="当前样本中没有形成改进需求主题。"
            themes={analysis.themes.recurringRequests}
            reviewsById={reviewsMap}
          />
          {analysis.themes.conflicts.length > 0 && (
            <section data-testid="voc-section-conflicts" className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-900">观点冲突（不同用户看法相反）</h3>
              <div className="mt-2 space-y-2">
                {analysis.themes.conflicts.map((conflict) => (
                  <ConflictCard key={conflict.themeId} conflict={conflict} reviewsById={reviewsMap} />
                ))}
              </div>
            </section>
          )}
          <ThemeSection
            title="零散信号（只出现一两次，别过度解读）"
            emptyText="没有零散信号。"
            themes={analysis.themes.weakSignals}
            reviewsById={reviewsMap}
          />
          <section data-testid="voc-section-unknowns" className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
            <h3 className="text-sm font-bold text-slate-900">仍然不知道什么</h3>
            {analysis.unknowns.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">当前样本没有标注未知项。</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {analysis.unknowns.map((unknown, index) => (
                  <li key={`${index}-${unknown}`} className="text-sm text-slate-700">· {unknown}</li>
                ))}
              </ul>
            )}
          </section>
          <section data-testid="voc-section-next" className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-bold text-slate-900">下一步最值得研究什么</h3>
            {analysis.nextResearchSteps.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">当前样本没有给出下一步建议。</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {analysis.nextResearchSteps.map((step, index) => (
                  <li key={`${index}-${step}`} className="text-sm text-slate-700">· {step}</li>
                ))}
              </ul>
            )}
          </section>
          {analysis.unverified.length > 0 && (
            <p className="text-xs text-slate-400">
              {analysis.unverified.length} 个主题因缺少有效评论引用未被采用（未展示）。
            </p>
          )}
          <p className="text-[11px] text-slate-400">
            run {analysis.runId.slice(0, 8)} · {analysis.model} · {analysis.promptVersion} · 输入 {analysis.inputEvidenceHash.slice(0, 10)}…
            · 分析 {new Date(analysis.finishedAt).toLocaleString("zh-CN")}
            {analysis.datasetSnapshot.totalReviews !== analysis.datasetSnapshot.reviewsUsed
              ? ` · 注意：本次分析仅使用 ${analysis.datasetSnapshot.reviewsUsed}/${analysis.datasetSnapshot.totalReviews} 条（采样）`
              : ""}
          </p>
        </div>
      )}
      {analysis === null && (evidence?.dataset.reviews.length ?? 0) > 0 && (
        <p className="text-sm text-slate-500">
          评论已就绪（{evidence!.dataset.reviews.length} 条）。点击「开始 VOC 分析」生成主题。
        </p>
      )}
    </section>
  );
}
