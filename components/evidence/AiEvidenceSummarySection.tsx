"use client";

/**
 * Phase 5 — AI 证据总结区（ai-evidence-summary.v1 展示 + 生成）
 * 新手解释层（Novice Comprehension 五问）优先，专业条目随后。
 */
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";

export type AiSummaryItemView = {
  id: string;
  type: string;
  text: string;
  evidenceRefs: string[];
};

export type AiEvidenceSummaryView = {
  runId: string;
  model: string;
  gateResult: "pass" | "fail";
  evidenceRefCoverage: { total: number; withRefs: number };
  startedAt: string;
  finishedAt: string;
  summary: {
    facts: AiSummaryItemView[];
    estimates: AiSummaryItemView[];
    signals: AiSummaryItemView[];
    risks: AiSummaryItemView[];
    conflicts: AiSummaryItemView[];
    missing: AiSummaryItemView[];
    nextSteps: AiSummaryItemView[];
  };
  noviceExplanation: {
    whatWeKnow: string;
    whatWeDontKnow: string;
    biggestRisk: string;
    why: string;
    nextToResearch: string;
  };
  unverified: AiSummaryItemView[];
  updatedAt: string;
};

function buildFetchHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ ...buildAccessHeaders(), ...extra });
}

const CATEGORY_LABELS: Array<{ key: keyof AiEvidenceSummaryView["summary"]; label: string; tone: string }> = [
  { key: "facts", label: "已确认事实", tone: "text-slate-900" },
  { key: "estimates", label: "估算", tone: "text-amber-700" },
  { key: "signals", label: "支持信号", tone: "text-teal-700" },
  { key: "risks", label: "风险", tone: "text-rose-700" },
  { key: "conflicts", label: "冲突", tone: "text-rose-700" },
  { key: "missing", label: "缺失", tone: "text-slate-500" },
  { key: "nextSteps", label: "下一步", tone: "text-slate-700" },
];

export function AiEvidenceSummarySection({
  taskId,
  summary,
  storageVersion,
  onChanged,
}: {
  taskId: string;
  summary: AiEvidenceSummaryView | null;
  storageVersion: { resultJsonHash: string; updatedAt: string } | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleGenerate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/ai-evidence-summary`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expectedStorageVersion: storageVersion }),
        signal: AbortSignal.timeout(120_000),
      });
      const json = await res.json() as
        | { ok: true }
        | { ok: false; error?: { message?: string } };
      if (!res.ok || !json.ok) {
        setError((json as { error?: { message?: string } }).error?.message ?? "生成失败。");
        return;
      }
      onChanged();
    } catch {
      setError("生成失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3" data-testid="ai-evidence-summary">
      {summary ? (
        <>
          {/* 新手解释层（首屏五问） */}
          <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3">
            <p className="text-xs font-bold text-slate-900">AI 解释（新手可读）</p>
            <dl className="mt-2 grid gap-1.5 text-sm">
              <div><dt className="inline text-xs text-slate-500">现在知道什么：</dt><dd className="inline text-slate-800">{summary.noviceExplanation.whatWeKnow || "—"}</dd></div>
              <div><dt className="inline text-xs text-slate-500">不知道什么：</dt><dd className="inline text-slate-800">{summary.noviceExplanation.whatWeDontKnow || "—"}</dd></div>
              <div><dt className="inline text-xs text-slate-500">最大风险：</dt><dd className="inline text-slate-800">{summary.noviceExplanation.biggestRisk || "—"}</dd></div>
              <div><dt className="inline text-xs text-slate-500">为什么：</dt><dd className="inline text-slate-800">{summary.noviceExplanation.why || "—"}</dd></div>
              <div><dt className="inline text-xs text-slate-500">下一步研究什么：</dt><dd className="inline text-slate-800">{summary.noviceExplanation.nextToResearch || "—"}</dd></div>
            </dl>
          </div>

          {/* 分类条目 */}
          {CATEGORY_LABELS.map((category) => {
            const items = summary.summary[category.key];
            if (items.length === 0) return null;
            return (
              <div key={category.key}>
                <p className={`text-xs font-bold ${category.tone}`}>{category.label}（{items.length}）</p>
                <ul className="mt-1 space-y-1">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-2 text-sm text-slate-700">
                      <span>{item.text}</span>
                      {item.evidenceRefs.length > 0 && (
                        <span className="shrink-0 text-[11px] text-slate-400">{item.evidenceRefs.length} 条引用</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {/* 门禁与追溯 */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span className={`rounded-full border px-2 py-0.5 font-semibold ${summary.gateResult === "pass" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-600"}`}>
              {summary.gateResult === "pass" ? "EvidenceRef 门禁通过" : "门禁未通过"}
            </span>
            <span>引用覆盖 {summary.evidenceRefCoverage.withRefs}/{summary.evidenceRefCoverage.total}</span>
            <span>模型 {summary.model}</span>
            <span>run {summary.runId.slice(0, 8)}…</span>
            <span>{summary.finishedAt.slice(0, 16).replace("T", " ")}</span>
          </div>
          {summary.unverified.length > 0 && (
            <p className="text-xs text-rose-600">
              {summary.unverified.length} 条无证据引用输出已被降级为待确认（不冒充事实）。
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGenerate()}
            className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
          >
            <Sparkles className="size-4" />重新生成
          </button>
          {/* P1-A：已有总结时重新生成失败也必须可见（旧总结保留 + 明确失败） */}
          {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3">
          <p className="text-sm text-slate-600">
            尚未生成 AI 证据总结。基于当前已有 Evidence 生成（非最终结论），收集更多证据后可重新生成。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGenerate()}
            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {busy ? "生成中…" : "生成 AI 证据总结"}
          </button>
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
