"use client";

import type { DecisionEvidenceSnapshot } from "@/lib/decisionEvidence";
import type { DecisionStatus } from "@/lib/tasks/decisionStatus";
import { getDecisionStatusOption } from "@/lib/tasks/decisionStatus";
import type { PipelineStatus } from "@/lib/productPipeline";
import { PIPELINE_STATUS_LABELS, PIPELINE_STATUS_TONES } from "@/lib/productPipeline";
import { ShieldAlert, AlertTriangle, ArrowRight, FileText } from "lucide-react";

type TaskDecisionHeroProps = {
  verdictLabel: string;
  reason: string;
  riskLabel: string;
  riskTone: string;
  beginnerLabel: string;
  smallBatchLabel: string;
  nextActions: string[];
  decisionStatus: DecisionStatus;
  stageLabel: string;
  blockingIssues: string[];
  reviewFocus: string[];
  evidence: DecisionEvidenceSnapshot | null;
  evidenceSummary?: { facts: number; userInputs: number; calculations: number; rules: number; aiInferences: number; missing: number };
  pipelineStatus: PipelineStatus;
  primaryNextAction?: string;
  hasListingPrep: boolean;
  onScrollToEvidence?: () => void;
  onScrollToListing?: () => void;
};

function countByKind(items: { kind: string }[] | undefined, kind: string) {
  if (!items) return 0;
  return items.filter((item) => item.kind === kind).length;
}

const RISK_TONE_MAP: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
};

export function TaskDecisionHero({
  verdictLabel,
  reason,
  riskLabel,
  riskTone,
  beginnerLabel,
  smallBatchLabel,
  nextActions,
  decisionStatus,
  stageLabel,
  blockingIssues,
  reviewFocus,
  evidence,
  pipelineStatus,
  primaryNextAction,
  hasListingPrep,
  onScrollToEvidence,
  onScrollToListing,
}: TaskDecisionHeroProps) {
  const decisionOption = getDecisionStatusOption(decisionStatus);
  const riskToneClass = RISK_TONE_MAP[riskTone] || RISK_TONE_MAP.slate;
  const pipelineTone = PIPELINE_STATUS_TONES[pipelineStatus] || "border-slate-200 bg-slate-50 text-slate-600";

  const facts = countByKind(evidence?.items, "fact");
  const userInputs = countByKind(evidence?.items, "user_input");
  const calculations = countByKind(evidence?.items, "calculation");
  const rules = countByKind(evidence?.items, "rule");
  const aiInferences = countByKind(evidence?.items, "ai_inference");
  const missingCount = evidence?.missingData?.length ?? 0;

  const hasConflict = (evidence?.conflicts?.length ?? 0) > 0;
  const isLegacy = evidence?.historicalFallback || !evidence;
  const criticalBlockers = blockingIssues.slice(0, 2);
  const topReviewItems = reviewFocus.slice(0, 2);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" data-testid="task-decision-hero">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-900">当前决策与下一步</p>
        {!isLegacy && evidence ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
            依据 {evidence.items.length} 项证据
          </span>
        ) : null}
      </div>

      {/* Main grid: left conclusion + right status */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        {/* Left: conclusion */}
        <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold text-slate-900">{verdictLabel || "待评估"}</span>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${riskToneClass}`}>
              {riskLabel}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{reason}</p>

          {/* Human decision vs system suggestion */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-slate-500">
              系统建议：{verdictLabel}
            </span>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${decisionOption.className}`}>
              人工决定：{decisionOption.shortLabel}
            </span>
          </div>

          {/* Conflict warning */}
          {hasConflict && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>人工决定与系统建议不一致，系统保留两者</span>
            </div>
          )}
        </div>

        {/* Right: status summary */}
        <div className="grid grid-cols-2 gap-2">
          <StatusChip label="当前阶段" value={stageLabel} tone={pipelineTone} />
          <StatusChip
            label="待补资料"
            value={missingCount > 0 ? `${missingCount} 项` : "暂无"}
            tone={missingCount > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}
          />
          <StatusChip label="新手适配" value={beginnerLabel} tone="border-slate-200 bg-slate-50 text-slate-600" />
          <StatusChip
            label="小单测试"
            value={smallBatchLabel}
            tone={smallBatchLabel === "可评估小单测试" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}
          />
          <StatusChip
            label="已确认事实"
            value={`${facts} 项`}
            tone="border-emerald-200 bg-emerald-50 text-emerald-700"
          />
          <StatusChip
            label="AI 推断"
            value={`${aiInferences} 项`}
            tone="border-violet-200 bg-violet-50 text-violet-700"
          />
        </div>
      </div>

      {/* Blockers + next actions */}
      {(criticalBlockers.length > 0 || topReviewItems.length > 0 || nextActions.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {criticalBlockers.length > 0 && (
            <div className="rounded-xl border border-rose-100 bg-rose-50/70 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
                <ShieldAlert className="size-3.5" />
                关键阻塞
              </p>
              <ul className="mt-1.5 space-y-0.5 text-sm leading-6 text-rose-800">
                {criticalBlockers.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          )}
          {criticalBlockers.length === 0 && topReviewItems.length > 0 && (
            <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
                <AlertTriangle className="size-3.5" />
                待人工核验
              </p>
              <ul className="mt-1.5 space-y-0.5 text-sm leading-6 text-amber-800">
                {topReviewItems.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          )}
          {nextActions.length > 0 && (
            <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-teal-700">
                <ArrowRight className="size-3.5" />
                下一步
              </p>
              <ul className="mt-1.5 space-y-0.5 text-sm leading-6 text-teal-800">
                {nextActions.slice(0, 3).map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Evidence summary bar + quick links */}
      {!isLegacy && evidence && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold">决策依据：</span>
          <span>已确认事实 {facts}</span>
          <span className="text-slate-300">|</span>
          <span>用户输入 {userInputs}</span>
          <span className="text-slate-300">|</span>
          <span>代码计算 {calculations}</span>
          <span className="text-slate-300">|</span>
          <span>规则检查 {rules}</span>
          <span className="text-slate-300">|</span>
          <span>AI 推断 {aiInferences}</span>
          <span className="text-slate-300">|</span>
          <span className={missingCount > 0 ? "font-semibold text-amber-700" : ""}>待补 {missingCount}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-4 flex flex-wrap gap-2">
        {onScrollToEvidence && (
          <button
            type="button"
            onClick={onScrollToEvidence}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            <FileText className="size-3.5" />
            查看完整决策依据
          </button>
        )}
        {hasListingPrep && onScrollToListing && (
          <button
            type="button"
            onClick={onScrollToListing}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition"
          >
            <FileText className="size-3.5" />
            查看 Listing 准备包
          </button>
        )}
      </div>
    </section>
  );
}

function StatusChip({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-xl border px-2.5 py-2 ${tone}`}>
      <p className="text-[10px] font-semibold opacity-70">{label}</p>
      <p className="mt-0.5 text-xs font-bold line-clamp-1">{value}</p>
    </div>
  );
}
