import type { AgentOutputSnapshot } from "@/lib/agentOutputSnapshot";

function joinItems(items: string[], fallback: string) {
  return items.length > 0 ? items.slice(0, 4).join(" / ") : fallback;
}

function decisionLabel(value: string) {
  if (value === "recommended") return "建议继续";
  if (value === "cautious") return "谨慎观察";
  if (value === "not_recommended") return "不建议继续";
  return "待人工判断";
}

function riskLabel(value: string) {
  if (value === "low") return "低风险";
  if (value === "medium") return "中风险";
  if (value === "high") return "高风险";
  return "未知风险";
}

function reviewLabel(snapshot: AgentOutputSnapshot) {
  if (!snapshot.humanReviewSnapshot.required) return "可按常规复核";
  return snapshot.humanReviewSnapshot.defaultStatus === "needs_review" ? "需要人工复核" : "待人工确认";
}

export function AgentOutputSnapshotCard({
  snapshot,
  fallbackText = "历史任务未记录标准化 Agent 输出快照",
  compact = false,
}: {
  snapshot: AgentOutputSnapshot | null;
  fallbackText?: string;
  compact?: boolean;
}) {
  if (!snapshot) {
    return (
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="agent-output-snapshot-fallback">
        <p className="text-sm font-semibold text-slate-600">Agent 输出结构化快照</p>
        <p className="mt-1 text-sm leading-6 text-slate-500">{fallbackText}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4" data-testid="agent-output-snapshot-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-cyan-900">Agent 输出结构化快照</p>
          <p className="mt-1 text-sm leading-6 text-cyan-700">
            {snapshot.version} · {snapshot.fallbackUsed ? "含 fallback" : "结构完整"} · {reviewLabel(snapshot)}
          </p>
        </div>
        {snapshot.warnings.length > 0 ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
            {snapshot.warnings.length} 个结构化提醒
          </span>
        ) : null}
      </div>

      <div className={`mt-3 grid gap-2 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
        <div className="rounded-xl border border-white/80 bg-white p-3">
          <p className="text-xs font-bold text-slate-400">综合决策</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{decisionLabel(snapshot.summarySnapshot.decision)}</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">{snapshot.summarySnapshot.decisionReason}</p>
        </div>
        <div className="rounded-xl border border-white/80 bg-white p-3">
          <p className="text-xs font-bold text-slate-400">风险判断</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{riskLabel(snapshot.riskSnapshot.riskLevel)}</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">{snapshot.riskSnapshot.riskReason}</p>
        </div>
        <div className="rounded-xl border border-white/80 bg-white p-3">
          <p className="text-xs font-bold text-slate-400">货源判断</p>
          <p className="mt-1 text-sm leading-6 text-slate-700">{snapshot.sourcingSnapshot.supplierConclusion}</p>
        </div>
        <div className="rounded-xl border border-white/80 bg-white p-3">
          <p className="text-xs font-bold text-slate-400">Listing 草稿</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{snapshot.listingSnapshot.titleDraft}</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {joinItems(snapshot.listingSnapshot.bulletDrafts, "待补充卖点草稿")}
          </p>
        </div>
        <div className="rounded-xl border border-white/80 bg-white p-3">
          <p className="text-xs font-bold text-slate-400">下一步动作</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{snapshot.nextActionSnapshot.actionLabel}</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">{snapshot.nextActionSnapshot.suggestedOwnerStep}</p>
        </div>
        <div className="rounded-xl border border-white/80 bg-white p-3">
          <p className="text-xs font-bold text-slate-400">人工复核</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{reviewLabel(snapshot)}</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {joinItems(snapshot.humanReviewSnapshot.reviewFocus, "按供应商、风险、利润、Listing 逐项复核")}
          </p>
        </div>
      </div>
    </section>
  );
}
