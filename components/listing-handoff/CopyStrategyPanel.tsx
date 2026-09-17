"use client";

import type { CopyStrategyV1 } from "@/lib/listingHandoff/copyStrategy/types";

/**
 * Copy Strategy is a reference-only presentation surface.  The component
 * deliberately receives a completed strategy instead of a Listing draft and
 * has no callback that could mutate the Listing workflow.
 */
export type CopyStrategyPanelProps = {
  strategy?: CopyStrategyV1 | null;
};

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["summary", "strategy", "label", "value", "text", "description"]) {
      const text = textOf(record[key]);
      if (text) return text;
    }
  }
  return "";
}

function listOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const text = textOf(value);
    return text ? [text] : [];
  }
  return value.map(textOf).filter(Boolean);
}

function strategyValue(strategy: CopyStrategyV1 | null | undefined, key: string): unknown {
  if (!strategy || typeof strategy !== "object") return undefined;
  return (strategy as unknown as Record<string, unknown>)[key];
}

function StrategyList({
  title,
  values,
  testId,
  emptyText = "暂无可用策略参考。",
}: {
  title: string;
  values: string[];
  testId: string;
  emptyText?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-100 bg-white/80 p-2.5" data-testid={testId}>
      <p className="text-xs font-bold text-slate-800">{title}</p>
      {values.length > 0 ? (
        <ul className="mt-1.5 space-y-1 text-xs leading-5 text-slate-700">
          {values.map((value, index) => (
            <li key={`${testId}-${index}`} className="break-words">{value}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs leading-5 text-slate-400">{emptyText}</p>
      )}
    </div>
  );
}

export function CopyStrategyPanel({ strategy = null }: CopyStrategyPanelProps) {
  const targetBuyer = textOf(strategyValue(strategy, "targetBuyer"));
  const mainAngle = textOf(strategyValue(strategy, "mainAngle"));
  const emotionalHook = textOf(strategyValue(strategy, "emotionalHook"));
  const copyTone = textOf(strategyValue(strategy, "copyTone"));
  const buyerPainPoints = listOf(strategyValue(strategy, "buyerPainPoints"));
  const bulletStrategies = listOf(strategyValue(strategy, "bulletStrategies"));
  const titleStrategy = listOf(strategyValue(strategy, "titleStrategy"));
  const descriptionStrategy = listOf(strategyValue(strategy, "descriptionStrategy"));
  const avoidExpressions = listOf(strategyValue(strategy, "avoidExpressions"));
  const hasStrategy = Boolean(
    targetBuyer || mainAngle || emotionalHook || copyTone
      || buyerPainPoints.length > 0 || bulletStrategies.length > 0
      || titleStrategy.length > 0 || descriptionStrategy.length > 0
      || avoidExpressions.length > 0,
  );

  return (
    <section
      className="mt-3 min-w-0 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/50 p-3"
      data-testid="copy-strategy-panel"
      aria-label="AI文案规划"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-violet-950">AI文案规划</h3>
            <span title="REFERENCE_ONLY" className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-violet-700">
              仅供策略参考<span className="sr-only">REFERENCE_ONLY</span>
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-violet-900/70">
            策略参考，不直接修改 Listing；内容来自现有研究安全摘要和质量反馈。
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-violet-700">不参与生成主链</span>
      </div>

      {!hasStrategy ? (
        <p className="mt-3 rounded-lg border border-dashed border-violet-200 bg-white/70 px-3 py-2 text-xs leading-5 text-slate-500" data-testid="copy-strategy-empty">
          当前暂无可用策略参考；Listing 生成与现有质量检查保持不变。
        </p>
      ) : (
        <details className="mt-2.5 rounded-lg border border-violet-100 bg-white/60 p-2.5 text-xs">
          <summary className="cursor-pointer font-semibold text-violet-900 hover:text-violet-950">
            展开AI文案规划详情（目标用户、卖点角度、写作结构与避免表达）
          </summary>
          <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
            <StrategyList title="目标用户" values={targetBuyer ? [targetBuyer] : []} testId="copy-strategy-target-buyer" />
            <StrategyList title="核心卖点角度" values={[mainAngle, emotionalHook].filter(Boolean)} testId="copy-strategy-main-angle" />
            <StrategyList title="买家痛点" values={buyerPainPoints} testId="copy-strategy-pain-points" />
            <StrategyList title="文案语气" values={copyTone ? [copyTone] : []} testId="copy-strategy-tone" />
            <StrategyList title="Bullet 写作结构" values={bulletStrategies} testId="copy-strategy-bullets" />
            <StrategyList title="标题策略" values={titleStrategy} testId="copy-strategy-title" />
            <StrategyList title="描述策略" values={descriptionStrategy} testId="copy-strategy-description" />
            <StrategyList
              title="避免表达"
              values={avoidExpressions}
              testId="copy-strategy-avoid"
              emptyText="暂无额外避免表达；仍需遵守现有事实与合规检查。"
            />
          </div>
        </details>
      )}
    </section>
  );
}

