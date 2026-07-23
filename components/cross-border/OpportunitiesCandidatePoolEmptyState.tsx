export type CandidatePoolDisplayState = "pool_empty" | "filter_empty" | "has_results";

type OpportunitiesCandidatePoolEmptyStateProps = {
  readonly state: Exclude<CandidatePoolDisplayState, "has_results">;
};

export function OpportunitiesCandidatePoolEmptyState({
  state,
}: OpportunitiesCandidatePoolEmptyStateProps) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-500">
      {state === "pool_empty"
        ? "还没有候选品。先在上方输入候选商品并手动分析，结果会自动进入候选品池。"
        : "当前筛选下没有候选品。"}
    </div>
  );
}
