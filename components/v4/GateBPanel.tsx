/**
 * V4 P4 — GateBPanel（Gate B 四选项表单 UI，B 工作树）。
 *
 * 受控交互组件：通过 props 注入 revision/actor/rulesStale 与回调 onSubmit/onConfirmStale。
 * 四选项 proceed / get_more_info / modify_product / stop；stop 必填原因；
 * 展示 revision；只由人提交（不自动通过 Gate B）。
 *
 * 服务端最终仍以 lib/v4/gateB.ts 的 validateGateB（Lead 冻结）为准，
 * 本组件只在 UI 层做前置禁用与提示（对齐 D6 + D5 stale 门禁）。
 */

import { useState } from "react";
import { CheckCircle2, LogOut, Pencil, RefreshCw, ShieldAlert } from "lucide-react";
import type { GateBOption } from "@/lib/v4/calculator/contract";

export const GATE_B_OPTIONS: GateBOption[] = ["proceed", "get_more_info", "modify_product", "stop"];

export const GATE_B_OPTION_LABELS: Record<GateBOption, string> = {
  proceed: "继续（进入内容制作）",
  get_more_info: "返回补充信息",
  modify_product: "修改产品后重算",
  stop: "停止（不进入内容制作）",
};

export const GATE_B_OPTION_DESCRIPTIONS: Record<GateBOption, string> = {
  proceed: "认为已具备进入内容制作的条件，接受剩余未知与风险承担。",
  get_more_info: "关键缺口仍需补充来源或确认，暂不进入内容制作。",
  modify_product: "当前产品商业可行性不足，调整方案后重算。",
  stop: "放弃此产品，不再投入内容制作。",
};

export const GATE_B_OPTION_ICONS: Record<GateBOption, typeof CheckCircle2> = {
  proceed: CheckCircle2,
  get_more_info: RefreshCw,
  modify_product: Pencil,
  stop: LogOut,
};

/** 是否被 stale 规则阻断 proceed（需要人工确认后才能继续）。 */
export function isProceedStaleBlocked(rulesStale: boolean, staleConfirmed: boolean): boolean {
  return rulesStale && !staleConfirmed;
}

/** 提交门禁：未选、stop 缺 reason、stale 未确认时的 proceed 都不可提交。 */
export function canSubmitGateB(input: {
  option: GateBOption | "";
  reason?: string;
  rulesStale?: boolean;
  staleConfirmed?: boolean;
}): boolean {
  const { option, reason = "", rulesStale = false, staleConfirmed = false } = input;
  if (!option) return false;
  if (option === "stop" && !reason.trim()) return false;
  if (rulesStale && option === "proceed" && !staleConfirmed) return false;
  return true;
}

export type GateBPanelProps = {
  /** 当前 revision（随决策一起提交）。 */
  revision: number;
  /** 提交决策的人工主体标识（由外层环境注入，非用户输入）。 */
  actor: string;
  /** 规则 stale（reviewedAt 超过 90 天）→ 禁用 proceed，需确认。 */
  rulesStale?: boolean;
  /** 人工确认“规则已过时仍继续”的回调。 */
  onConfirmStale?: () => void;
  /** 提交回调（只由人触发）。 */
  onSubmit: (payload: { option: GateBOption; reason?: string; revision: number; actor: string }) => void;
  /** 整面板禁用（如提交中）。 */
  disabled?: boolean;
};

export function GateBPanel({
  revision,
  actor,
  rulesStale = false,
  onConfirmStale,
  onSubmit,
  disabled = false,
}: GateBPanelProps) {
  const [option, setOption] = useState<GateBOption | "">("");
  const [reason, setReason] = useState("");
  const [staleConfirmed, setStaleConfirmed] = useState(false);

  const staleBlocked = isProceedStaleBlocked(rulesStale, staleConfirmed);
  const canSubmit = !disabled && canSubmitGateB({ option, reason, rulesStale, staleConfirmed });

  function handleConfirmStale() {
    setStaleConfirmed(true);
    onConfirmStale?.();
  }

  function handleSubmit() {
    if (!option) return;
    onSubmit({ option, reason: reason.trim() || undefined, revision, actor });
  }

  return (
    <section data-testid="gate-b-panel" className="surface-card rounded-2xl p-5">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">Gate B — 是否准备进入内容制作？</h2>
          <p className="mt-1 text-xs text-slate-500">
            请在你确认剩余未知与风险承担后，由你本人提交；Agent 不自动通过。
          </p>
        </div>
        <span data-testid="gate-b-revision" className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
          版本 {revision}
        </span>
      </header>

      {rulesStale && !staleConfirmed && (
        <div data-testid="gate-b-stale-warning" className="mt-3 rounded-2xl border border-amber-300 bg-amber-50/80 p-3">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
            <ShieldAlert className="h-4 w-4" /> 费用/规则已过时
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-700">
            规则来源审核已超过 90 天。在人工确认前，“继续（进入内容制作）”保持禁用。
          </p>
          <button
            type="button"
            data-testid="gate-b-confirm-stale"
            onClick={handleConfirmStale}
            disabled={disabled}
            className="linear-button mt-2 inline-flex h-9 items-center gap-1.5 px-3 text-xs font-semibold"
          >
            <CheckCircle2 className="h-4 w-4" /> 我已知悉，确认仍然继续
          </button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {GATE_B_OPTIONS.map((opt) => {
          const Icon = GATE_B_OPTION_ICONS[opt];
          const blocked = opt === "proceed" && staleBlocked;
          const selected = option === opt;
          return (
            <button
              key={opt}
              type="button"
              data-testid={"gate-b-option-" + opt}
              aria-pressed={selected}
              disabled={disabled || blocked}
              onClick={() => setOption(opt)}
              className={
                "flex items-start gap-2 rounded-2xl border p-3 text-left text-sm transition " +
                (selected
                  ? "border-teal-300 bg-teal-50/60 text-teal-900"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300") +
                (blocked ? " cursor-not-allowed opacity-50" : "")
              }
            >
              <Icon className={"mt-0.5 h-4 w-4 shrink-0 " + (selected ? "text-teal-700" : "text-slate-400")} />
              <span>
                <span className="block font-semibold">{GATE_B_OPTION_LABELS[opt]}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-slate-400">
                  {GATE_B_OPTION_DESCRIPTIONS[opt]}
                </span>
                {blocked && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                    <ShieldAlert className="h-3 w-3" /> 需确认规则后再选
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {option && (
        <label className="mt-4 block">
          <span className="text-xs font-semibold text-slate-600">理由</span>
          <textarea
            data-testid="gate-b-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={disabled}
            rows={3}
            placeholder={option === "stop" ? "请填写停止原因（必填）" : "记录本次决策理由（可选）"}
            className="mt-1 block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50"
          />
          {option === "stop" && reason.trim().length === 0 && (
            <span className="mt-1 block text-[11px] text-rose-600">选择“停止”必须填写原因。</span>
          )}
        </label>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-400">
          提交主体：{actor === "" ? "（未指定）" : actor} · 只由人提交
        </p>
        <button
          type="button"
          data-testid="gate-b-submit"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" /> 提交 Gate B 决策
        </button>
      </div>
    </section>
  );
}

export default GateBPanel;
