"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ShieldAlert, Sparkles } from "lucide-react";
import {
  createRiskReviewSnapshotFromPrecheck,
  countRiskReviewItems,
  normalizeRiskReviewSnapshot,
  RISK_PRECHECK_LEVEL_LABELS,
  RISK_REVIEW_DISCLAIMER,
  RISK_REVIEW_OVERALL_LABELS,
  RISK_REVIEW_STATUS_LABELS,
  type RiskPrecheckInput,
  type RiskReviewItem,
  type RiskReviewItemStatus,
  type RiskReviewOverallStatus,
  type RiskReviewPrecheckLevel,
  type RiskReviewSnapshot,
} from "@/lib/riskReview";

type RiskReviewChecklistCardProps = {
  initial?: unknown;
  precheckInput?: RiskPrecheckInput;
  onChange?: (snapshot: RiskReviewSnapshot | null) => void;
  readonly?: boolean;
};

const statusTone: Record<RiskReviewItemStatus, string> = {
  unchecked: "border-slate-200 bg-slate-50 text-slate-600",
  cleared: "border-emerald-200 bg-emerald-50 text-emerald-700",
  needs_check: "border-amber-200 bg-amber-50 text-amber-700",
  high_risk: "border-rose-200 bg-rose-50 text-rose-700",
};

const overallTone: Record<RiskReviewOverallStatus, string> = {
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
  cleared: "border-emerald-200 bg-emerald-50 text-emerald-700",
  needs_check: "border-amber-200 bg-amber-50 text-amber-700",
  high_risk: "border-rose-200 bg-rose-50 text-rose-700",
};

const precheckTone: Record<RiskReviewPrecheckLevel, string> = {
  not_triggered: "border-slate-200 bg-slate-50 text-slate-600",
  low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  high: "border-rose-200 bg-rose-50 text-rose-700",
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
};

const statusOptions: RiskReviewItemStatus[] = ["unchecked", "cleared", "needs_check", "high_risk"];

function hasUserInput(items: RiskReviewItem[], note: string) {
  return items.some((item) => item.status !== "unchecked" || Boolean(item.note)) || Boolean(note.trim());
}

function buildInitialSnapshot(initial: unknown, precheckInput?: RiskPrecheckInput) {
  const normalized = normalizeRiskReviewSnapshot(initial);
  if (normalized) return normalized;
  if (precheckInput?.productName?.trim()) return createRiskReviewSnapshotFromPrecheck(precheckInput);
  return normalizeRiskReviewSnapshot({ items: [], note: "" });
}

export function RiskReviewChecklistCard({
  initial,
  precheckInput,
  onChange,
  readonly = false,
}: RiskReviewChecklistCardProps) {
  const normalizedInitial = useMemo(
    () => buildInitialSnapshot(initial, precheckInput),
    [initial, precheckInput],
  );
  const [createdAt, setCreatedAt] = useState(() => normalizedInitial?.createdAt || new Date().toISOString());
  const [items, setItems] = useState<RiskReviewItem[]>(() => normalizedInitial?.items || []);
  const [note, setNote] = useState(() => normalizedInitial?.note || "");
  const [summary, setSummary] = useState(() => normalizedInitial?.summary || "");
  const [recommendedActions, setRecommendedActions] = useState<string[]>(() => normalizedInitial?.recommendedActions || []);
  const [expanded, setExpanded] = useState(readonly);

  useEffect(() => {
    if (!normalizedInitial) return;
    setCreatedAt(normalizedInitial.createdAt);
    setItems(normalizedInitial.items);
    setNote(normalizedInitial.note);
    setSummary(normalizedInitial.summary || "");
    setRecommendedActions(normalizedInitial.recommendedActions || []);
    setExpanded(readonly);
  }, [normalizedInitial, readonly]);

  const snapshot = useMemo(() => normalizeRiskReviewSnapshot({
    version: normalizedInitial?.version || "risk_auto_mvp_v1",
    source: normalizedInitial?.source || "rule_based_risk_precheck_mvp",
    mode: normalizedInitial?.mode || "ai_rule_precheck_with_manual_review",
    items,
    note,
    summary,
    recommendedActions,
    createdAt,
  }), [createdAt, items, note, normalizedInitial?.mode, normalizedInitial?.source, normalizedInitial?.version, recommendedActions, summary]);

  const touched = hasUserInput(items, note);
  const overallStatus = touched ? (snapshot?.overallStatus || "unknown") : "unknown";
  const overallPrecheckLevel = snapshot?.overallPrecheckLevel || "unknown";
  const counts = countRiskReviewItems(items);
  const priorityItems = items
    .filter((item) => item.precheckLevel === "high" || item.precheckLevel === "medium" || item.status === "high_risk" || item.status === "needs_check")
    .sort((a, b) => precheckRank(b.precheckLevel) - precheckRank(a.precheckLevel))
    .slice(0, 5);
  const fullItems = expanded ? items : priorityItems;
  const isLegacy = normalizedInitial?.version === "risk_review_mvp_v1";

  useEffect(() => {
    if (readonly) return;
    onChange?.(snapshot);
  }, [onChange, readonly, snapshot]);

  function updateItemStatus(key: string, status: RiskReviewItemStatus) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, status } : item));
  }

  function updateItemNote(key: string, value: string) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, note: value.trim() ? value.slice(0, 300) : null } : item));
  }

  function markSuggestedReviewed() {
    setItems((current) => current.map((item) => {
      if (item.precheckLevel === "high") return item.status === "high_risk" ? item : { ...item, status: "needs_check" };
      if (item.precheckLevel === "medium") return { ...item, status: "needs_check" };
      if (item.status === "unchecked") return { ...item, status: "cleared" };
      return item;
    }));
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4" data-testid="risk-review-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber-700" />
            <p className="text-sm font-bold text-amber-950">
              {isLegacy ? "合规 / 侵权人工复核记录" : "合规 / 侵权 AI 预筛"}
            </p>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-800">
            系统会先根据商品名和分析结果自动圈出可能的侵权、禁售、认证和物流风险。AI / 规则只能做预筛，最终仍需人工结合商标、专利、平台规则和供应商文件确认。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${precheckTone[overallPrecheckLevel]}`} data-testid="risk-precheck-overall">
            预筛：{RISK_PRECHECK_LEVEL_LABELS[overallPrecheckLevel]}
          </span>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${overallTone[overallStatus]}`} data-testid="risk-review-overall">
            {RISK_REVIEW_OVERALL_LABELS[overallStatus]}
          </span>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/80 bg-white p-3" data-testid="risk-precheck-summary">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-amber-800">AI 预筛结论</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {summary || "当前信息不足，建议先补充商品名和分析结果后再进行风险预筛。"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Metric label="高风险" value={counts.highRisk} tone="text-rose-700" />
        <Metric label="待核查" value={counts.needsCheck} tone="text-amber-700" />
        <Metric label="已确认" value={counts.cleared} tone="text-emerald-700" />
        <Metric label="未复核" value={counts.unchecked} tone="text-slate-600" />
      </div>

      {recommendedActions.length > 0 ? (
        <div className="mt-3 rounded-xl border border-white/80 bg-white p-3">
          <p className="text-sm font-bold text-slate-500">建议优先查证</p>
          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-600">
            {recommendedActions.slice(0, 5).map((action) => (
              <li key={action}>- {action}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!readonly ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={markSuggestedReviewed}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
            data-testid="risk-review-mark-suggested-reviewed"
          >
            已按建议完成初步复核
          </button>
          <p className="text-xs leading-5 text-slate-500">
            仅在实际检查商标、专利、平台规则或供应商文件后使用。
          </p>
        </div>
      ) : null}

      <div className="mt-4 space-y-2" data-testid="risk-review-priority-items">
        {fullItems.length > 0 ? fullItems.map((item) => (
          <RiskReviewItemRow
            key={item.key}
            item={item}
            readonly={readonly}
            onStatusChange={updateItemStatus}
            onNoteChange={updateItemNote}
          />
        )) : (
          <div className="rounded-xl border border-white/80 bg-white p-3 text-xs leading-5 text-slate-500">
            该项未触发明显风险词，但仍需人工确认标题、图片、关键词和供应商材料。
          </div>
        )}
      </div>

      {items.length > priorityItems.length ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          data-testid="risk-review-toggle-all"
        >
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {expanded ? "收起全部风险项" : "展开全部 10 项风险"}
        </button>
      ) : null}

      <div className="mt-3 rounded-xl border border-white/80 bg-white p-3">
        <label className="block text-xs font-semibold text-slate-600">人工最终确认备注</label>
        {readonly ? (
          <p className="mt-2 text-sm leading-6 text-slate-700">{note || "未填写统一备注。"}</p>
        ) : (
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 800))}
            placeholder="例如：已查平台限售规则；供应商需补 CE / FCC / MSDS 文件；外观相似度还要继续查。"
            rows={3}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
            data-testid="risk-review-note"
          />
        )}
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-500">{RISK_REVIEW_DISCLAIMER}</p>
    </div>
  );
}

function RiskReviewItemRow({
  item,
  readonly,
  onStatusChange,
  onNoteChange,
}: {
  item: RiskReviewItem;
  readonly: boolean;
  onStatusChange: (key: string, status: RiskReviewItemStatus) => void;
  onNoteChange: (key: string, value: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/80 bg-white p-3" data-testid={`risk-review-item-${item.key}`}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">{item.label}</p>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${precheckTone[item.precheckLevel]}`}>
              预筛：{RISK_PRECHECK_LEVEL_LABELS[item.precheckLevel]}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
          {item.example ? <p className="mt-1 text-xs leading-5 text-slate-400">示例：{item.example}</p> : null}
        </div>
        {readonly ? (
          <span className={`w-fit shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusTone[item.status]}`}>
            {RISK_REVIEW_STATUS_LABELS[item.status]}
          </span>
        ) : (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {statusOptions.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => onStatusChange(item.key, status)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                  item.status === status ? statusTone[status] : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                }`}
                data-testid={`risk-review-${item.key}-${status}`}
              >
                {RISK_REVIEW_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <InfoBlock label="触发理由" value={item.precheckReason} />
        <InfoBlock label="建议查证动作" value={item.checkAction} />
        <InfoBlock label="建议证据" value={item.evidenceHint} />
      </div>

      {readonly ? (
        item.note ? <p className="mt-2 text-xs leading-5 text-slate-500">备注：{item.note}</p> : null
      ) : (
        <input
          type="text"
          value={item.note || ""}
          onChange={(event) => onNoteChange(item.key, event.target.value)}
          placeholder="可选备注，例如：需查商标 / 已问供应商要报告"
          maxLength={300}
          className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 placeholder-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
          data-testid={`risk-review-${item.key}-note`}
        />
      )}
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">{value}</p>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-white/80 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      <p className={`mt-1 text-base font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function precheckRank(level: RiskReviewPrecheckLevel) {
  if (level === "high") return 4;
  if (level === "medium") return 3;
  if (level === "low") return 2;
  if (level === "unknown") return 1;
  return 0;
}
