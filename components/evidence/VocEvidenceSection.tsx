"use client";

/**
 * V3.4 — VOC / Review Evidence 工作台区域
 *
 * 新手默认看到：用户喜欢什么 / 不满意什么 / 使用场景 / 零散信号 / 仍然不知道什么 / 下一步。
 * 每个主题可展开"为什么这么说"：引用 Review 数量、原文、星级、来源 ASIN、当前商品/竞品、capturedAt、sourceRef。
 * 样本量显式；当前商品 vs 竞品明确区分；单边样本提示；绝不显示"分析了全部评论"除非真实全部。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { buildAccessHeaders, getAccessMode } from "@/lib/client/accessToken";
import { useSessionDraft } from "@/lib/client/useSessionDraft";
import { resolveEvidenceConflictRecovery } from "@/lib/client/evidenceConflictRecovery";
import type { AcquisitionCapabilityView } from "@/lib/client/acquisitionCapability";
import { CapabilityNotice } from "@/components/evidence/CapabilityNotice";

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

/** 轮 12：评论 ASIN 输入态——当前商品只读绑定服务端 taskAsin；仅竞品模式可编辑。 */
export function resolveVocAsinInput(
  role: "current_candidate" | "competitor",
  taskAsin: string | null | undefined,
  currentValue: string,
): { editable: boolean; value: string } {
  if (role === "current_candidate") return { editable: false, value: taskAsin?.trim() || "" };
  return { editable: true, value: currentValue };
}

/** 轮 12：当前商品未采到评论时的诚实空态（不再诱导换商品）。 */
export function noReviewsEmptyMessage(): string {
  return "当前商品暂未采到公开评论，可重试或粘贴该商品评论。";
}
export function VocEvidenceSection({
  taskId,
  taskAsin,
  evidence,
  analysis,
  storageVersion,
  capability,
  onChanged,
}: {
  taskId: string;
  /** Package C：任务绑定的商品 ASIN（角色=当前商品时预填） */
  taskAsin?: string | null;
  evidence: VocEvidenceView | null;
  analysis: VocAnalysisView | null;
  storageVersion: { resultJsonHash: string; updatedAt: string } | null;
  /** 浏览器采集能力（服务端 DTO；自动采集评论依赖它；粘贴导入与 VOC 分析不受影响） */
  capability?: AcquisitionCapabilityView | null;
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
  // 轮 12：导入/采集确认的 CAS 冲突恢复（首次冲突→保留草稿/预览→版本刷新后自动重试一次；二次→简洁提示）
  const [importConflictPending, setImportConflictPending] = useState(false);
  const lastImportVersionRef = useRef<string | null>(null);
  const [confirmConflictPending, setConfirmConflictPending] = useState(false);
  const lastConfirmVersionRef = useRef<string | null>(null);
  // Package C：半自动采集（collect preview → 人工确认 → 写入）
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectAsin, setCollectAsin] = useState("");
  const [collectRole, setCollectRole] = useState<"current_candidate" | "competitor">("current_candidate");
  const [collecting, setCollecting] = useState(false);
  const [collectDemo, setCollectDemo] = useState(false);

  /** §11/§12：自动采集评论需要本地浏览器采集能力；粘贴导入/分析是 server 能力，不受影响。
   *  演示模式（Visitor）：本地采集能力不可用（local_env_required）时仍可体验
   *  “演示采集”——服务端回放预置真实评论样本（demo 分支），结果标注“演示数据”。 */
  const demoMode = getAccessMode() === "demo";
  const canCollectReviews = capability?.state === "available"
    || (capability?.state === "local_env_required" && demoMode);
  const [collectPreview, setCollectPreview] = useState<{
    previewId: string;
    items: Array<{
      asin: string;
      role: "current_candidate" | "competitor";
      rating: number | null;
      date: string | null;
      title: string;
      duplicate: boolean;
    }>;
    pageResults: Array<{ asin: string; status: string; note: string | null; extractedCount: number }>;
    capturedAt: string;
  } | null>(null);
  const [collectSelected, setCollectSelected] = useState<Set<number>>(new Set());

  // Package C：ASIN 预填——角色=当前商品且任务有 ASIN 时，填入并跟随任务 ASIN 更新
  useEffect(() => {
    if (taskAsin && collectRole === "current_candidate" && !collectAsin.trim()) {
      setCollectAsin(taskAsin);
    }
  }, [taskAsin, collectRole, collectAsin]);
  useEffect(() => {
    if (taskAsin && importRole === "current_candidate" && !importAsin.trim()) {
      setImportAsin(taskAsin);
    }
  }, [taskAsin, importRole, importAsin]);

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

  /** 轮 12：导入尝试——allowRetry=false 表示已经过版本刷新，未再重试（内部标记已重试）。 */
  async function attemptImport(version: { resultJsonHash: string; updatedAt: string } | null, allowRetry: boolean) {
    if (!version) return;
    const lines = importText.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const key = version.resultJsonHash + version.updatedAt;
    lastImportVersionRef.current = key;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const rating = importRating.trim() ? Number(importRating.trim()) : null;
      const reviews = lines.map((text) => ({
        asin: (importRole === "current_candidate" ? (taskAsin ?? "") : importAsin).trim().toUpperCase(),
        sourceProductRole: importRole,
        reviewText: text,
        rating,
      }));
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/review-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "import", expectedStorageVersion: version, reviews }),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as
        | { ok: true; data: { outcome: { importedCount: number; duplicateCount: number; rejectedCount: number } } }
        | { ok: false; error?: { code?: string; message?: string } };
      if (!res.ok || !json.ok) {
        const code = (json as { error?: { code?: string } }).error?.code ?? null;
        // 轮 12：CAS 冲突恢复——首冲突保留草稿+刷新版本重试一次；二次冲突只显示简洁提示
        const recovery = resolveEvidenceConflictRecovery(res.status, code, !allowRetry);
        if (recovery.retry) {
          setImportConflictPending(true);
          onChanged();
          return;
        }
        setImportConflictPending(false);
        setError(recovery.message ?? (json as { error?: { message?: string } }).error?.message ?? "导入失败。");
        return;
      }
      const outcome = json.data.outcome;
      setNotice(`已导入 ${outcome.importedCount} 条；重复 ${outcome.duplicateCount} 条；忽略 ${outcome.rejectedCount} 条（超限）。`);
      setImportText("");
      setImportRating("");
      setImportOpen(false);
      vocDraft.clear();
      setImportConflictPending(false);
      onChanged();
    } catch {
      setError("导入失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  function runImport() {
    void attemptImport(storageVersion, true);
  }

  // 轮 12：导入首冲突后，版本刷新时安全重试一次（同版本绝不重复）
  useEffect(() => {
    if (!importConflictPending || !storageVersion) return;
    const key = storageVersion.resultJsonHash + storageVersion.updatedAt;
    if (lastImportVersionRef.current === key) return;
    void attemptImport(storageVersion, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅依赖版本变化触发重试，attemptImport 为内部函数
  }, [storageVersion, importConflictPending]);

  async function runAnalyze() {
    setAnalyzing(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/review-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "analyze", expectedStorageVersion: storageVersion }),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as
        | { ok: true; data: { gateResult: string; unverified: number; demo?: boolean } }
        | { ok: false; error?: { code?: string; message?: string } };
      if (!res.ok || !json.ok) {
        setError((json as { error?: { message?: string } }).error?.message ?? "评论分析失败。");
        return;
      }
      setNotice(json.data.demo === true
        ? "演示数据：已回放示例评论分析结果（非实时 AI 调用）。"
        : json.data.gateResult === "fail"
          ? `分析完成，但 ${json.data.unverified} 个主题因缺少有效评论引用未被采用。`
          : "分析完成。");
      onChanged();
    } catch {
      setError("评论分析失败，请稍后重试。");
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
        signal: AbortSignal.timeout(60_000),
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

  /* ── Package C：半自动采集（浏览器提取详情页公开 Top Reviews 片段） ── */

  async function runCollect() {
    if (!canCollectReviews) return;
    const asin = (collectRole === "current_candidate" ? (taskAsin ?? "") : collectAsin).trim().toUpperCase();
    if (!asin) {
      setError("请填写要采集评论的 ASIN。");
      return;
    }
    setCollecting(true);
    setError("");
    setNotice("");
    setCollectPreview(null);
    setCollectSelected(new Set());
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/review-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "collect",
          asins: [{ asin, sourceProductRole: collectRole }],
        }),
        signal: AbortSignal.timeout(150_000),
      });
      const json = await res.json() as
        | { ok: true; data: { preview: { previewId: string; items: Array<{ asin: string; role: "current_candidate" | "competitor"; rating: number | null; date: string | null; title: string; duplicate: boolean }>; pageResults: Array<{ asin: string; status: string; note: string | null; extractedCount: number }>; capturedAt: string }; demo?: boolean } }
        | { ok: false; error?: { code?: string; message?: string } };
      if (!res.ok || !json.ok) {
        const code = (json as { error?: { code?: string } }).error?.code ?? "";
        if (code === "task_result_conflict") {
          setError("任务内容刚在其他位置更新，已自动刷新最新版本；请重试采集。");
          onChanged();
          return;
        }
        setError((json as { error?: { message?: string } }).error?.message ?? "采集失败。");
        return;
      }
      const preview = json.data.preview;
      setCollectPreview(preview);
      setCollectDemo(json.data.demo === true);
      // 默认选中非重复项（人工确认仍然保留：取消勾选即不加入）
      const initial = new Set<number>();
      preview.items.forEach((item, index) => {
        if (!item.duplicate) initial.add(index);
      });
      setCollectSelected(initial);
    } catch {
      setError("采集失败（浏览器会话异常），请重试。");
    } finally {
      setCollecting(false);
    }
  }

  /** 轮 12：采集确认尝试——allowRetry=false 表示已经过版本刷新（未再重试）。 */
  async function attemptCollectConfirm(version: { resultJsonHash: string; updatedAt: string } | null, allowRetry: boolean) {
    if (!collectPreview || collectSelected.size === 0) return;
    if (!version) return;
    lastConfirmVersionRef.current = version.resultJsonHash + version.updatedAt;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/review-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "collect-confirm",
          previewId: collectPreview.previewId,
          selectedIndices: [...collectSelected].sort((a, b) => a - b),
          expectedStorageVersion: version,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as
        | { ok: true } | { ok: false; error?: { code?: string; message?: string } };
      if (!res.ok || !json.ok) {
        const code = (json as { error?: { code?: string } }).error?.code ?? null;
        if (code === "preview_expired") {
          setError("采集预览已失效，请重新采集。");
          setCollectPreview(null);
          setConfirmConflictPending(false);
          return;
        }
        // 轮 12：CAS 冲突恢复——首冲突保留预览+刷新版本重试一次；二次冲突只显示简洁提示
        const recovery = resolveEvidenceConflictRecovery(res.status, code, !allowRetry);
        if (recovery.retry) {
          setConfirmConflictPending(true);
          onChanged();
          return;
        }
        setConfirmConflictPending(false);
        setError(recovery.message ?? (json as { error?: { message?: string } }).error?.message ?? "确认失败。");
        return;
      }
      setNotice(`已将选中的 ${collectSelected.size} 条评论加入数据集（可打开「开始分析评论」）。`);
      setCollectPreview(null);
      setCollectSelected(new Set());
      setCollectOpen(false);
      setConfirmConflictPending(false);
      onChanged();
    } catch {
      setError("确认失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  function runCollectConfirm() {
    void attemptCollectConfirm(storageVersion, true);
  }

  // 轮 12：采集确认首冲突后，版本刷新时安全重试一次（同版本绝不重复）
  useEffect(() => {
    if (!confirmConflictPending || !storageVersion) return;
    const key = storageVersion.resultJsonHash + storageVersion.updatedAt;
    if (lastConfirmVersionRef.current === key) return;
    void attemptCollectConfirm(storageVersion, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅依赖版本变化触发重试，attemptCollectConfirm 为内部函数
  }, [storageVersion, confirmConflictPending]);

  function toggleCollectSelect(index: number) {
    setCollectSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const stats = evidence?.dataset.stats;
  const reviewsMap = reviewsById();
  const importLineCount = importText.split("\n").map((line) => line.trim()).filter(Boolean).length;
  const canImport = importText.trim().length > 0 && importAsin.trim().length > 0 && !busy;
  const canAnalyze = (evidence?.dataset.reviews.length ?? 0) > 0 && !analyzing && !busy;
  const canCollect = collectAsin.trim().length > 0 && !collecting && !busy && !analyzing;
  // 单边样本提示（低星集合伪装完整 VOC）
  const negativeBiased = stats !== undefined && stats.totalReviews > 0 && stats.positiveCount === 0 && stats.negativeCount > 0;
  const positiveBiased = stats !== undefined && stats.totalReviews > 0 && stats.negativeCount === 0 && stats.positiveCount > 0;
  const usedAll = stats !== undefined && stats.totalReviews > 0 && stats.reviewsUsed === stats.totalReviews;

  return (
    <section data-testid="workbench-voc" className="mt-4 space-y-3">
      <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">买家评论与需求 — 真实买家怎么看这个商品</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              评论是用户观点证据，不是商品事实；所有主题都回链到真实评论。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || analyzing || collecting || !canCollectReviews}
              onClick={() => { setCollectOpen((open) => !open); setError(""); }}
              className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
            >
              <BarChart3 className="size-4" />采集评论
            </button>
            <button
              type="button"
              disabled={busy || analyzing || collecting}
              onClick={() => { setImportOpen((open) => !open); setError(""); }}
              className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
            >
              <Plus className="size-4" />粘贴导入
            </button>
            <button
              type="button"
              disabled={!canAnalyze}
              onClick={() => void runAnalyze()}
              className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
              {analyzing ? "分析中…（约 10-30 秒）" : "开始分析评论"}
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

        {/* Acquisition Capability（§12/§13）：自动采集需要本地研究环境；粘贴导入与分析不受影响 */}
        <CapabilityNotice
          capability={capability}
          localEnvMessage={demoMode
            ? "演示模式：当前环境不执行实时评论采集，可点击「演示采集」回放示例评论片段（演示数据，非实时采集）。"
            : "自动采集评论需要在本地研究环境使用；你仍可粘贴导入评论，并使用已有评论进行分析。"}
          unavailableMessage={capability?.reasonCategory === "not_installed"
            ? "本机未检测到可用的 Chrome/Edge 浏览器，无法自动采集评论；可改用粘贴导入。"
            : "自动采集评论当前暂不可用；可改用粘贴导入。"}
        />

        {/* 导入表单（批量粘贴显性化：每行一条，一次可多条） */}
        {importOpen && (
          <div className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
            <p className="text-xs text-slate-500">
              粘贴真实买家评论：<span className="font-semibold text-slate-700">每行一条，一次可粘贴多条</span>（同一 ASIN 与角色批量导入）。
              评论文本是数据，不会执行任何内容。
            </p>
            {importLineCount > 0 && (
              <p className="mt-1.5 text-sm font-semibold text-violet-700" data-testid="voc-import-line-count">
                当前识别 {importLineCount} 条评论
              </p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <label className="text-xs text-slate-500">
                {importRole === "current_candidate" ? "Amazon 商品编号（ASIN，当前商品）" : "竞品 ASIN（必填）"}
                <input
                  value={importRole === "current_candidate" ? (taskAsin ?? "") : importAsin}
                  disabled={importRole === "current_candidate"}
                  onChange={(event) => setImportAsin(event.target.value.toUpperCase())}
                  placeholder={taskAsin ?? "B0XXXXXXXXX"}
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
                星级（可选 1-5，整批同星）
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
                确认导入{importLineCount > 0 ? `（${importLineCount} 条）` : ""}
              </button>
              <span className="text-[11px] text-slate-400">单商品最多 100 条；数据集最多 300 条；单条最多 2000 字符。</span>
            </div>
          </div>
        )}

        {/* 采集面板（半自动：浏览器提取 → 人工确认 → 写入） */}
        {collectOpen && (
          <div className="mt-3 rounded-xl border border-sky-200 bg-white p-3">
            <p className="text-xs text-slate-500">
              自动打开本机浏览器，读取该商品 Amazon 详情页公开的 Top Reviews（星级/日期/标题）。
              评论全文页需要登录，系统不会绕过登录墙；提取结果需人工确认后才加入数据集。
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="text-xs text-slate-500">
                {collectRole === "current_candidate" ? "Amazon 商品编号（ASIN，当前商品）" : "竞品 ASIN（必填）"}
                <input
                  value={collectRole === "current_candidate" ? (taskAsin ?? "") : collectAsin}
                  disabled={collectRole === "current_candidate"}
                  onChange={(event) => setCollectAsin(event.target.value.toUpperCase())}
                  placeholder={taskAsin ?? "B0XXXXXXXXX"}
                  maxLength={10}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-slate-500">
                评论来源角色
                <select
                  value={collectRole}
                  onChange={(event) => setCollectRole(event.target.value as "current_candidate" | "competitor")}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="current_candidate">当前商品</option>
                  <option value="competitor">竞品</option>
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={!canCollect || !canCollectReviews}
                  onClick={() => void runCollect()}
                  className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                >
                  {collecting ? <Loader2 className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
                  {collecting ? "采集中…（约 20-60 秒）" : "开始采集"}
                </button>
              </div>
            </div>

            {/* 采集结果预览（人工确认） */}
            {collectPreview && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                {collectDemo && (
                  <p className="mb-2 inline-block rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800" data-testid="demo-sample-badge">
                    演示数据（示例评论片段，非实时采集）
                  </p>
                )}
                {collectPreview.pageResults.map((page) => (
                  <p key={page.asin} className="text-xs text-slate-600">
                    ASIN {page.asin}：
                    {page.status === "ok" ? `提取 ${page.extractedCount} 条`
                      : page.status === "blocked_redirect" ? "需要登录/验证，未提取（系统不绕过登录墙）"
                        : page.status === "no_reviews_extracted" ? "未发现公开评论片段"
                          : `采集异常（${page.note ?? "未知"}）`}
                  </p>
                ))}
                {collectPreview.items.length === 0 ? (
                  <p className="mt-2 text-sm text-amber-700">{noReviewsEmptyMessage()}（也可以改用「粘贴导入」粘贴该商品公开评论。）</p>
                ) : (
                  <>
                    <p className="mt-2 text-xs font-semibold text-slate-700">
                      以下评论来自 Amazon 详情页公开片段，勾选确认后加入数据集（{collectSelected.size}/{collectPreview.items.length} 已选）：
                    </p>
                    <ul className="mt-2 space-y-2">
                      {collectPreview.items.map((item, index) => (
                        <li key={`${item.asin}-${index}`} className="rounded-lg border border-slate-200 bg-white p-2">
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={collectSelected.has(index)}
                              onChange={() => toggleCollectSelect(index)}
                              className="mt-1 h-4 w-4"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-semibold text-slate-800">{item.title}</span>
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                {item.role === "current_candidate" ? "当前商品" : "竞品"} · ASIN {item.asin}
                                {item.rating !== null ? ` · ${item.rating} 星` : ""}
                                {item.date ? ` · ${item.date}` : ""}
                                {item.duplicate ? " · 与现有评论重复（将跳过）" : ""}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={collectSelected.size === 0 || busy}
                        onClick={() => void runCollectConfirm()}
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                        确认加入（{collectSelected.size} 条）
                      </button>
                      <button
                        type="button"
                        onClick={() => { setCollectPreview(null); setCollectSelected(new Set()); }}
                        className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                      >
                        取消
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
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

        {evidence === null && !importOpen && !collectOpen && (
          <p className="mt-3 text-sm text-slate-500">
            还没有评论证据。点击「采集评论」自动读取 Amazon 详情页公开评论片段，或点击「粘贴导入」粘贴真实买家评论（每行一条，可一次粘贴多条）。
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
          评论已就绪（{evidence!.dataset.reviews.length} 条）。点击「开始分析评论」生成主题。
        </p>
      )}
    </section>
  );
}
