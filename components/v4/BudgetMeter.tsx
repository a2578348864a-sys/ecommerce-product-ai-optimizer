import type { ResearchBudget } from "@/lib/v4/contracts";
import { formatCount, formatMoney, formatPercent } from "./labels";

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 预算使用条（纯展示）：成本 / 浏览器步骤 / token / 图片调用。 */
export function BudgetMeter({ budget }: { budget: ResearchBudget }) {
  const costRatio = budget.maxCost > 0 ? budget.usedCost / budget.maxCost : 0;
  const stepsRatio = budget.maxBrowserSteps > 0 ? budget.usedBrowserSteps / budget.maxBrowserSteps : 0;
  const tokensRatio = budget.maxLlmTokens > 0 ? budget.usedLlmTokens / budget.maxLlmTokens : 0;
  const imagesRatio = budget.maxImageCalls > 0 ? budget.usedImageCalls / budget.maxImageCalls : 0;

  const barWidth = clamp(costRatio, 0, 1);
  const overBudget = budget.usedCost > budget.maxCost;

  return (
    <section data-testid="budget-meter" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">预算</h2>
        <span className={"text-xs font-semibold " + (overBudget ? "text-rose-600" : "text-slate-500")}>
          {formatMoney(budget.usedCost, budget.currency)} / {formatMoney(budget.maxCost, budget.currency)}
        </span>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          data-testid="budget-cost-bar"
          className={"h-full rounded-full " + (overBudget ? "bg-rose-500" : "bg-teal-500")}
          style={{ width: (barWidth * 100) + "%" }}
        />
      </div>
      <p className="mt-1 text-right text-[11px] text-slate-400">已用成本 {formatPercent(costRatio)}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-400">浏览器步骤</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">
            {formatCount(budget.usedBrowserSteps)} / {formatCount(budget.maxBrowserSteps)}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-400">LLM Token</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">
            {formatCount(budget.usedLlmTokens)} / {formatCount(budget.maxLlmTokens)}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-400">图片调用</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">
            {formatCount(budget.usedImageCalls)} / {formatCount(budget.maxImageCalls)}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-400">进度</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">
            {stepsRatio > 0 ? "步骤 " + formatPercent(stepsRatio) : "—"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
