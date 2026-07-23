import type { DecisionDeskSummary } from "@/lib/opportunityDecisionDesk";

type OpportunitiesDecisionSummaryProps = {
  readonly summary: Readonly<DecisionDeskSummary>;
};

export function OpportunitiesDecisionSummary({
  summary,
}: OpportunitiesDecisionSummaryProps) {
  return (
    <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 sm:grid-cols-5">
      {[
        { label: "全部候选", value: summary.all },
        { label: "待查看", value: summary.pending },
        { label: "待分析", value: summary.worthAnalyzing },
        { label: "分析中", value: summary.analyzing },
        { label: "已转任务", value: summary.converted },
      ].map((item) => (
        <div key={item.label} className="border-b border-r border-slate-200 px-4 py-3 last:border-r-0 sm:border-b-0">
          <p className="text-[11px] font-semibold text-slate-500">{item.label}</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
