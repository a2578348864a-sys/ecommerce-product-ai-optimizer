/**
 * V4 P4 — CommercialPanel（商业可行性：三情景展示 UI，B 工作树）。
 *
 * 纯展示 + 受控组件：通过 props 注入 CalcStatus 与回调，不直接写库、不调用 Calculator。
 * 展示 乐观/基准/悲观 三情景的 landed cost、广告前贡献利润、margin rate、
 * break-even、MOQ 最低占款；最敏感变量、unknowns、未覆盖成本；
 * 规则 meta（version/marketplace/category/reviewedAt/sourceUrl/stale）与可折叠公式展开。
 *
 * 边界（对齐 P4_CONTRACT）：不输出月赚金额（D8）；不把合规/IP 当法律结论；
 * 不做 LLM 算术（结果由 props 注入）；不开始 Listing/Image。
 * 规则 stale 时在本面板醒目提示，并由外层据此禁用 Gate B 的 proceed（GateBPanel 处理确认回调）。
 */

import { AlertTriangle, ChevronRight, CircleHelp, Clock, ExternalLink, Scale, TrendingUp } from "lucide-react";
import type { CalcOutput, CalcStatus, ScenarioKey, ScenarioResult } from "@/lib/v4/calculator/contract";
import { formatCount, formatMoney, formatPercent } from "./labels";

/** 三情景展示顺序：乐观 → 基准 → 悲观。 */
export const SCENARIO_ORDER: ScenarioKey[] = ["optimistic", "baseline", "pessimistic"];

export const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  optimistic: "乐观情景",
  baseline: "基准情景",
  pessimistic: "悲观情景",
};

/** 三情景的确定性参数口径（D3）。 */
export const SCENARIO_NOTES: Record<ScenarioKey, string> = {
  optimistic: "头程 ×0.9，汇率对买方有利，退货率按 0 计",
  baseline: "按输入原值计算",
  pessimistic: "头程 ×1.3，汇率对买方不利，退货率生效",
};

export const BLOCKED_CODE_LABELS: Record<string, string> = {
  BLOCKED_MISSING_INPUT: "缺少必要输入",
  RULES_STALE: "费用/规则已过时",
  INVALID_INPUT: "输入无效",
};

/** 盈亏平衡销量的展示文案；null 表示无平衡点（单件贡献 ≤ 0）。 */
export function formatBreakEven(units: number | null): string {
  if (units === null) return "—（无盈亏平衡点）";
  return formatCount(Math.round(units)) + " 件";
}

/** 规则 meta 的行项目（version/reviewedAt/sourceUrl 随输出返回）。 */
export function ruleMetaRows(rules: CalcOutput["rules"]): { label: string; value: string; link?: string }[] {
  const rows: { label: string; value: string; link?: string }[] = [
    { label: "公式版本", value: rules.version },
    { label: "市场", value: rules.marketplace },
    { label: "品类", value: rules.category },
    { label: "审核时间", value: rules.reviewedAt },
  ];
  if (rules.sourceUrl) {
    rows.push({ label: "来源", value: rules.sourceUrl, link: rules.sourceUrl });
  }
  return rows;
}

type MetricRowProps = { label: string; value: string; tone?: "default" | "positive" | "negative" };

function MetricRow({ label, value, tone = "default" }: MetricRowProps) {
  const toneClass =
    tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={"text-sm font-semibold tabular-nums " + toneClass}>{value}</dd>
    </div>
  );
}

export type ScenarioCardProps = { scenario: ScenarioResult; currency: string; scenarioKey: ScenarioKey };

/** 单个情景卡片：landed cost / 广告前贡献利润 / margin rate / break-even / MOQ 最低占款。 */
export function ScenarioCard({ scenario, currency, scenarioKey }: ScenarioCardProps) {
  const positiveMargin = scenario.preAdContributionMargin > 0;
  return (
    <article
      data-testid={"commercial-scenario-" + scenarioKey}
      className={"surface-card-soft flex flex-col rounded-2xl p-4"}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{SCENARIO_LABELS[scenarioKey]}</h3>
        <span className={(scenario.landedCostPerUnit > 0 ? "text-teal-700" : "text-rose-700") + " text-xs font-semibold"}>
          {formatMoney(scenario.landedCostPerUnit, currency)}
        </span>
      </header>
      <p className="mb-2 text-[11px] leading-4 text-slate-400">{SCENARIO_NOTES[scenarioKey]}</p>
      <dl className="grid grid-cols-1 gap-0 text-left">
        <MetricRow label="单件落地成本" value={formatMoney(scenario.landedCostPerUnit, currency)} />
        <MetricRow
          label="广告前贡献（每件）"
          value={formatMoney(scenario.preAdContributionMargin, currency)}
          tone={positiveMargin ? "positive" : "negative"}
        />
        <MetricRow
          label="贡献利润率"
          value={formatPercent(scenario.marginRate)}
          tone={scenario.marginRate >= 0 ? "positive" : "negative"}
        />
        <MetricRow label="盈亏平衡销量" value={formatBreakEven(scenario.breakEvenUnits)} />
        <MetricRow label="MOQ 最低占款" value={formatMoney(scenario.moqCapital, currency)} />
      </dl>
    </article>
  );
}

/** 可折叠公式展开：展示计算公式结构、三情景参数口径与未覆盖/未知明细（不重新计算）。 */
export function CommercialFormulaExpansion({ output }: { output: CalcOutput }) {
  const uncovered = output.uncoveredCosts.length > 0 ? output.uncoveredCosts : ["（无，已覆盖所有可选成本项）"];
  const unknowns = output.unknowns.length > 0 ? output.unknowns : ["（无未知项）"];
  return (
    <details data-testid="commercial-formula" className="surface-card-soft rounded-2xl p-4">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
        <ChevronRight className="h-4 w-4 text-slate-400" />
        公式展开（计算口径与已覆盖/未覆盖明细）
      </summary>
      <div className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
        <div>
          <p className="font-semibold text-slate-800">单件落地成本口径</p>
          <p className="mt-1">
            单件落地成本 = 采购价 + 基础头程 + 平台佣金 + 履约/配送费
            <span className="text-slate-400"> + 可选成本项（包装/样品/仓储/退货/关税/广告）</span>
          </p>
          <p className="mt-1">广告前贡献（每件） = 售价 − 单件落地成本</p>
          <p className="mt-1">贡献利润率 = 广告前贡献 ÷ 售价</p>
          <p className="mt-1">盈亏平衡销量 = 需分摊的固定/一次性成本 ÷ 单件贡献（单件贡献 ≤ 0 时无平衡点）</p>
          <p className="mt-1">MOQ 最低占款 = 单件落地成本 × MOQ</p>
        </div>
        <div>
          <p className="font-semibold text-slate-800">情景参数口径（确定性）</p>
          {SCENARIO_ORDER.map((k) => (
            <p key={k} className="mt-1">
              {SCENARIO_LABELS[k]}：{SCENARIO_NOTES[k]}
            </p>
          ))}
        </div>
        <div>
          <p className="font-semibold text-slate-800">未覆盖成本（未填写的可选成本）</p>
          <ul className="mt-1 list-inside list-disc">
            {uncovered.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
          <p className="mt-1 text-slate-400">以上未覆盖成本未纳入上面的结果，实际投入可能更高。</p>
        </div>
        <div>
          <p className="font-semibold text-slate-800">未知输入</p>
          <ul className="mt-1 list-inside list-disc">
            {unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] text-slate-400">
          本面板为决策输入，不构成盈利预测，也不对未来销量或盈利做预测。
        </p>
      </div>
    </details>
  );
}

/** 规则 meta 区块：version/marketplace/category/reviewedAt/sourceUrl + stale 标识。 */
export function RulesMeta({ output }: { output: CalcOutput }) {
  const rows = ruleMetaRows(output.rules);
  return (
    <div data-testid="commercial-rules-meta" className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Scale className="h-4 w-4 text-teal-700" /> 费用/规则
      </p>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3">
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="max-w-[60%] truncate text-right font-medium text-slate-700" title={row.value}>
              {row.link ? (
                <a href={row.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-teal-700 underline">
                  {row.value} <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export type CommercialPanelProps = {
  /** Calculator 结果（含 ok/blocked 两种状态）。 */
  status: CalcStatus;
  /** 结算币种（默认 CNY，用于金额展示）；实际币种由外层注入。 */
  currency?: string;
};

/** 商业可行性面板——三情景卡片 + 敏感变量 + unknowns + 未覆盖成本 + 规则 meta + 公式展开。 */
export function CommercialPanel({ status, currency = "CNY" }: CommercialPanelProps) {
  if (!status.ok) {
    return (
      <section data-testid="commercial-panel" className="surface-card p-5">
        <div data-testid="commercial-blocked" className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {BLOCKED_CODE_LABELS[status.code] ?? status.code}
          </p>
          <p className="mt-2 text-sm text-slate-600">{status.message}</p>
          {status.missing.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-700">尚未提供 / 缺失项：</p>
              <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                {status.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-400">
            未提供核心输入时将保留为 unknown（由 Calculator 返回），不会被 AI 猜测补齐。
          </p>
        </div>
      </section>
    );
  }

  const output = status.output;
  const stale = output.rules.stale;

  return (
    <section data-testid="commercial-panel" className="space-y-4">
      {stale && (
        <div data-testid="commercial-stale-warning" className="rounded-2xl border border-amber-300 bg-amber-50/80 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
            <Clock className="h-4 w-4" /> 规则已过时
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-700">
            费用/规则来源审核于 {output.rules.reviewedAt}，已超过 90 天（version {output.rules.version}）。
            请人工确认后，才能选择“继续进入内容制作”。未确认前 proceed 保持禁用。
          </p>
          {output.rules.staleReason && (
            <p className="mt-1 text-xs text-amber-700">原因：{output.rules.staleReason}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {SCENARIO_ORDER.map((key) => (
          <ScenarioCard key={key} scenarioKey={key} scenario={output.scenarios[key]} currency={currency} />
        ))}
      </div>

      <div data-testid="commercial-sensitive-vars" className="surface-card-soft rounded-2xl p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <TrendingUp className="h-4 w-4 text-teal-700" /> 最敏感变量（各输入 ±10% 对 margin 影响排序）
        </p>
        {output.sensitiveVariables.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">（无敏感变量数据）</p>
        ) : (
          <ol className="mt-2 space-y-1">
            {output.sensitiveVariables.map((v, i) => (
              <li key={v.name + i} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-700">
                  {i + 1}. {v.name}
                </span>
                <span className="tabular-nums font-semibold text-slate-700">
                  {v.direction === "up" ? "上调 +" : "下调 −"}
                  {formatPercent(Math.abs(v.deltaImpact))}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-[11px] text-slate-400">敏感变量仅用于提示决策，不自动决定是否进入内容制作。</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div data-testid="commercial-unknowns" className="surface-card-soft rounded-2xl p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <CircleHelp className="h-4 w-4 text-slate-500" /> 未知项
          </p>
          <ul className="mt-2 list-inside list-disc text-xs leading-5 text-slate-600">
            {output.unknowns.length > 0 ? (
              output.unknowns.map((u) => <li key={u}>{u}</li>)
            ) : (
              <li className="list-none text-slate-400">（无未知项）</li>
            )}
          </ul>
        </div>
        <div data-testid="commercial-uncovered-costs" className="surface-card-soft rounded-2xl p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> 未覆盖成本（未填写的可选成本）
          </p>
          <ul className="mt-2 list-inside list-disc text-xs leading-5 text-slate-600">
            {output.uncoveredCosts.length > 0 ? (
              output.uncoveredCosts.map((u) => <li key={u}>{u}</li>)
            ) : (
              <li className="list-none text-slate-400">（无，已覆盖所有可选成本）</li>
            )}
          </ul>
          <p className="mt-2 text-[11px] text-slate-400">以上未纳入上方结果，实际投入可能更高。</p>
        </div>
      </div>

      <RulesMeta output={output} />
      <CommercialFormulaExpansion output={output} />
    </section>
  );
}

export default CommercialPanel;
