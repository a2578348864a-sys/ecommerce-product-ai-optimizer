"use client";

export type ProductCreationFlowStepKey =
  | "facts"
  | "keywords"
  | "creative"
  | "listing"
  | "image";

export type ProductCreationFlowStepState =
  | "complete"
  | "current"
  | "pending"
  | "blocked"
  | "unknown";

export type ProductCreationFlowStates = Record<
  ProductCreationFlowStepKey,
  ProductCreationFlowStepState
>;

type ProductCreationFlowStatusProps = {
  states: ProductCreationFlowStates;
  activeStep?: ProductCreationFlowStepKey;
  actionHref?: string;
  actionLabel?: string;
  actionDescription?: string;
  /**
   * 可选：由调用方接管动作（研究页的 hash 目标需要先展开资料区/切换 tab）。
   * 提供后动作渲染为按钮而不是裸锚点，重复点击也会重新滚动并聚焦。
   */
  onAction?: () => void;
  compact?: boolean;
};

const STEPS: Array<{
  key: ProductCreationFlowStepKey;
  label: string;
  description: string;
}> = [
  { key: "facts", label: "商品事实确认", description: "研究阶段人工确认的商品事实" },
  {
    key: "keywords",
    label: "关键词方案确认",
    description: "确认关键词方案，不等于创作资料确认",
  },
  { key: "creative", label: "创作资料确认", description: "确认 Listing 与图片共用的创作资料" },
  { key: "listing", label: "Listing 生成", description: "基于已确认创作资料生成文案草稿" },
  { key: "image", label: "图片生成", description: "基于已确认创作资料生成图片候选" },
];

const STATE_LABELS: Record<ProductCreationFlowStepState, string> = {
  complete: "已完成",
  current: "当前步骤",
  pending: "待完成",
  blocked: "需先完成前置步骤",
  // unknown = 本页没有读取该步骤的状态（例如图片工作台不读关键词/Listing）。
  // 对普通用户，「未读取」会被误读成"系统没做"，所以改成可执行的下一步提示。
  unknown: "去对应工作台查看",
};

const STATE_CLASSES: Record<ProductCreationFlowStepState, string> = {
  complete: "border-emerald-200 bg-emerald-50 text-emerald-800",
  current: "border-teal-300 bg-teal-50 text-teal-900 ring-1 ring-teal-200",
  pending: "border-slate-200 bg-slate-50 text-slate-700",
  blocked: "border-amber-200 bg-amber-50 text-amber-900",
  unknown: "border-slate-200 bg-white text-slate-500",
};

function stepMark(state: ProductCreationFlowStepState, index: number) {
  return state === "complete" ? "✓" : String(index + 1).padStart(2, "0");
}

/**
 * Frontend-only workflow projection. It deliberately receives states from the
 * caller instead of deciding any server gate or creating a handoff.
 */
export function ProductCreationFlowStatus({
  states,
  activeStep,
  actionHref,
  actionLabel,
  actionDescription,
  onAction,
  compact = false,
}: ProductCreationFlowStatusProps) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white ${compact ? "p-3" : "p-4"}`}
      data-testid="product-creation-flow-status"
      aria-label="商品创作流程状态"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-950">商品创作流程</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            商品事实确认 → 关键词方案确认 → 创作资料确认 → Listing 生成 → 图片生成
          </p>
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex h-8 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700"
            data-testid="product-creation-flow-action"
          >
            {actionLabel}
          </button>
        ) : actionHref && actionLabel ? (
          <a
            href={actionHref}
            className="inline-flex h-8 items-center rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700"
            data-testid="product-creation-flow-action"
          >
            {actionLabel}
          </a>
        ) : null}
      </div>

      <div className={`mt-3 grid gap-2 ${compact ? "md:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-5"}`}>
        {STEPS.map((step, index) => {
          const state = states[step.key];
          const isActive = activeStep === step.key;
          return (
            <div
              key={step.key}
              className={`min-w-0 rounded-xl border p-3 ${STATE_CLASSES[state]} ${isActive ? "shadow-sm" : ""}`}
              data-flow-step={step.key}
              data-flow-state={state}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-current/15 text-[10px] font-bold">
                  {stepMark(state, index)}
                </span>
                <span className="truncate text-xs font-bold">{step.label}</span>
              </div>
              <p className="mt-2 text-[11px] font-semibold">{STATE_LABELS[state]}</p>
              <p className="mt-1 text-[11px] leading-4 opacity-80">{step.description}</p>
            </div>
          );
        })}
      </div>

      {actionDescription ? (
        <p className="mt-3 rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2 text-xs leading-5 text-teal-900" data-testid="product-creation-flow-guidance">
          {actionDescription}
        </p>
      ) : null}
    </section>
  );
}
