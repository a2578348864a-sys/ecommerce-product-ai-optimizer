import React, { useState } from "react";

export interface VisualGenerationBriefCardProps {
  mode: "task" | "standalone";
  assetTitle: string;
  categoryLabel?: string;
  goal: string;
  confirmedFacts?: Array<{ label: string; value: string }>;
  facts?: Array<{ label: string; value: string }>;
  strategy: {
    purposeLabel: string;
    sceneLabel?: string;
    styleLabel: string;
    rationale?: string;
  };
  constraints: string[];
  referenceNotice: {
    title: string;
    description: string;
    isComposition: boolean;
  };
  customPromptSummary?: string;
}

export function VisualGenerationBriefCard({
  mode,
  assetTitle,
  categoryLabel,
  goal,
  confirmedFacts,
  facts,
  strategy,
  constraints,
  referenceNotice,
  customPromptSummary,
}: VisualGenerationBriefCardProps) {
  const isTask = mode === "task";
  const displayFacts = facts ?? confirmedFacts ?? [];
  const [mobileExpanded, setMobileExpanded] = useState(false);

  return (
    <div
      className="overflow-hidden rounded-2xl border border-teal-200/80 bg-gradient-to-br from-teal-50/40 via-white to-slate-50/60 p-4 shadow-sm"
      data-testid="visual-generation-brief-card"
    >
      {/* 顶部标题栏 (H2 Level) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-600 text-xs font-black text-white shadow-xs">
            AI
          </span>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">
            AI 视觉方案 · Visual Generation Brief
          </h3>
          <span className="rounded-full bg-teal-100/80 px-2 py-0.5 text-[11px] font-semibold text-teal-800">
            {isTask ? "研究事实驱动" : "自由创意模式"}
          </span>
        </div>
        {categoryLabel ? (
          <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
            {categoryLabel}
          </span>
        ) : null}
      </div>

      {/* 五要素内容 */}
      <div className="mt-3.5 space-y-3.5 text-xs">
        {/* 01: 资产定位与生成目标 (始终直观展示) */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              01 视觉资产定位与目标
            </h4>
            <span className="rounded bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700">
              {assetTitle}
            </span>
          </div>
          <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-800">
            {goal}
          </p>
        </div>

        {/* 移动端折叠/展开按钮 */}
        <button
          type="button"
          onClick={() => setMobileExpanded(!mobileExpanded)}
          className="md:hidden flex w-full items-center justify-between rounded-xl border border-teal-200/80 bg-teal-50/70 px-3 py-2 text-xs font-bold text-teal-800 transition hover:bg-teal-100/80"
        >
          <span>{mobileExpanded ? "收起详细依据与策略 ↑" : "展开商品事实与视觉策略 (02 ~ 04) ↓"}</span>
          <span className="text-[11px] font-normal text-teal-700">
            {isTask ? `${displayFacts.length} 项事实` : "免责说明"} · 策略与约束
          </span>
        </button>

        {/* 02 ~ 04 详细内容（桌面端始终展开，移动端受折叠状态控制） */}
        <div className={`space-y-3.5 ${mobileExpanded ? "block" : "hidden md:block"}`}>

        {/* 3: 事实依据（主链展示 Confirmed Facts，独立模式展示诚实免责） */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              02 商品事实依据 (Facts Basis)
            </h4>
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                isTask
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {isTask ? `已绑定 ${displayFacts.length} 项事实` : "无研究事实"}
            </span>
          </div>

          {isTask ? (
            displayFacts.length > 0 ? (
              <div className="mt-2">
                <div className="flex flex-wrap gap-1.5">
                  {displayFacts.slice(0, 6).map((fact, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50/60 px-2 py-1 text-[11px] font-medium text-emerald-900"
                    >
                      <svg
                        className="h-3 w-3 text-emerald-600 shrink-0"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <strong>{fact.label}:</strong> {fact.value}
                    </span>
                  ))}
                  {displayFacts.length > 6 ? (
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                      +{displayFacts.length - 6} 更多事实
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  ✓ 生成指令严格锚定上述 Confirmed Facts，杜绝虚构未证实参数或篡改商品外观。
                </p>
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">
                暂无已确认事实，生成将基于商品基础信息。
              </p>
            )
          ) : (
            <div className="mt-2 rounded-lg border border-amber-200/80 bg-amber-50/60 p-2.5 text-[11px] text-amber-900">
              <p className="font-bold">
                ⚠ 独立创作未绑定商品研究任务
              </p>
              <p className="mt-0.5">
                用户提供内容由你自行输入，未经商品研究验证，不属于商品事实。生成结果仅供概念与构图参考。
              </p>
            </div>
          )}
        </div>

        {/* 4: 视觉策略 (Visual Strategy) */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            03 视觉策略组合 (Visual Strategy)
          </h4>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2">
              <span className="text-[10px] text-slate-500">素材用途</span>
              <p className="mt-0.5 font-bold text-slate-800">
                {strategy.purposeLabel}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2">
              <span className="text-[10px] text-slate-500">场景设定</span>
              <p className="mt-0.5 font-bold text-slate-800">
                {strategy.sceneLabel || "无背景干扰 (纯色)"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2">
              <span className="text-[10px] text-slate-500">视觉风格</span>
              <p className="mt-0.5 font-bold text-slate-800">
                {strategy.styleLabel}
              </p>
            </div>
          </div>
          {strategy.rationale ? (
            <p className="mt-2 text-[11px] text-slate-600">
              <strong className="text-slate-700">策略考量：</strong>
              {strategy.rationale}
            </p>
          ) : null}
        </div>

        {/* 5: 生成约束与安全红线 (Constraints & Safety Guardrails) */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              04 生成约束与安全底线
            </h4>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                referenceNotice.isComposition
                  ? "bg-amber-100 text-amber-800"
                  : "bg-teal-100 text-teal-800"
              }`}
            >
              {referenceNotice.title}
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
            {constraints.map((constraint, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <span className="text-teal-600 font-bold shrink-0">•</span>
                <span>{constraint}</span>
              </li>
            ))}
            <li className="flex items-start gap-1.5">
              <span className="text-slate-400 font-bold shrink-0">•</span>
              <span className="text-slate-500">{referenceNotice.description}</span>
            </li>
          </ul>
        </div>
        </div>

        {customPromptSummary ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-2.5 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">用户自定义意图：</span>
            <span className="italic">{customPromptSummary}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-xl border border-teal-200/80 bg-teal-50/70 px-3.5 py-2 text-xs font-medium text-teal-900">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
            <span>视觉方案已锁定 · 下方确认规格后即可生成候选图</span>
          </div>
          <span className="font-bold text-teal-700">前往生成 ↓</span>
        </div>
      </div>
    </div>
  );
}
