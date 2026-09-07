"use client";

import type { CopyStrategyPlannerSuggestionV1 } from "@/lib/listingHandoff/copyStrategy/plannerSuggestion";

export type CopyStrategyPlannerSuggestionPanelProps = {
  suggestion?: CopyStrategyPlannerSuggestionV1 | null;
};

export function CopyStrategyPlannerSuggestionPanel({ suggestion = null }: CopyStrategyPlannerSuggestionPanelProps) {
  const hasContent = Boolean(
    suggestion && (
      suggestion.targetRoles.length > 0
      || suggestion.recommendedAngles.length > 0
      || suggestion.bulletStructureSuggestions.length > 0
      || suggestion.titleApproach
      || suggestion.descriptionApproach
    ),
  );

  return (
    <section
      className="mt-3 min-w-0 overflow-hidden rounded-xl border border-sky-200 bg-sky-50/50 p-3"
      data-testid="copy-strategy-planner-suggestion-panel"
      aria-label="Planner Strategy Preview"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-sky-950">Planner Strategy Preview</h3>
            <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-sky-700">REFERENCE_ONLY</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-sky-900/75">仅供人工确认，不会自动修改 Listing。</p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-sky-700">旁路预览</span>
      </div>

      {!hasContent ? (
        <p className="mt-3 rounded-lg border border-dashed border-sky-200 bg-white/70 px-3 py-2 text-xs leading-5 text-slate-500" data-testid="copy-strategy-planner-suggestion-empty">
          当前暂无 Planner 策略建议；正式 Listing 生成保持不变。
        </p>
      ) : (
        <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-sky-100 bg-white/80 p-2.5" data-testid="planner-suggestion-target-roles">
            <p className="text-xs font-bold text-slate-800">目标角色</p>
            <p className="mt-1 break-words text-xs leading-5 text-slate-700">{suggestion?.targetRoles.join(" · ") || "暂无"}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-sky-100 bg-white/80 p-2.5" data-testid="planner-suggestion-angles">
            <p className="text-xs font-bold text-slate-800">核心表达方向</p>
            <p className="mt-1 break-words text-xs leading-5 text-slate-700">{suggestion?.recommendedAngles.join(" · ") || "暂无"}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-sky-100 bg-white/80 p-2.5 md:col-span-2" data-testid="planner-suggestion-bullets">
            <p className="text-xs font-bold text-slate-800">Bullet 策略</p>
            <ul className="mt-1.5 space-y-1 text-xs leading-5 text-slate-700">
              {suggestion?.bulletStructureSuggestions.map((item, index) => (
                <li key={`${item.role}-${index}`} className="break-words">
                  <span className="font-semibold">{item.role}</span> · Feature → Benefit → Scenario · {item.reason}
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 rounded-lg border border-sky-100 bg-white/80 p-2.5" data-testid="planner-suggestion-title">
            <p className="text-xs font-bold text-slate-800">标题方向</p>
            <p className="mt-1 break-words text-xs leading-5 text-slate-700">{suggestion?.titleApproach || "暂无"}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-sky-100 bg-white/80 p-2.5" data-testid="planner-suggestion-description">
            <p className="text-xs font-bold text-slate-800">描述方向</p>
            <p className="mt-1 break-words text-xs leading-5 text-slate-700">{suggestion?.descriptionApproach || "暂无"}</p>
          </div>
        </div>
      )}
    </section>
  );
}
