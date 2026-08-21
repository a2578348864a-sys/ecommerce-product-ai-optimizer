import Link from "next/link";
import type { ResearchRunStatus } from "@/lib/v4/contracts";
import type { RunSummary } from "./api";
import { NEXT_ACTION_USER_LABELS, userStatus } from "./userLanguage";
import { formatDateTime, formatMoney, statusTone } from "./labels";

type NextActionTone = "amber" | "rose" | "blue" | "emerald" | "slate" | "indigo";

const NEXT_ACTION_TONE_CLASS: Record<NextActionTone, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
  rose: "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100",
  blue: "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  slate: "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100",
};

const STATUS_DOT_CLASS: Record<string, string> = {
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  slate: "bg-slate-400",
  indigo: "bg-indigo-500",
  teal: "bg-teal-500",
};

/** 状态色点（复用 labels.statusTone，仅颜色，不泄英文枚举）。 */
function statusDotClass(status: ResearchRunStatus): string {
  return STATUS_DOT_CLASS[statusTone(status)] ?? "bg-slate-400";
}

/**
 * 「下一步」按钮（C 端）：状态/等待/缺口推导，文字用 userLanguage 文案。
 * 没有独立创建/重试表单时，所有动作都导向该次研究的详情页，由详情页承接真实操作。
 * 优先级：终态权威 → 可恢复失败 → 等待（缺口更细的动作优先）→ 进行中。
 */
function nextButton(run: RunSummary): { text: string; tone: NextActionTone } {
  const status = run.status;
  const gap = (run.firstGap ?? "").trim();

  // 终态：以 status 为唯一权威，避免“已完成还提示补资料”。
  if (status === "completed") return { text: "查看结论", tone: "emerald" };
  if (status === "cancelled") return { text: "查看详情", tone: "slate" };
  if (status === "failed_terminal") return { text: "查看详情", tone: "slate" };
  if (status === "failed_recoverable") return { text: "重试", tone: "rose" };

  // 等待：先看最重要的缺口对应哪个动作，再看等待类型。
  if (status === "waiting_human" || status === "waiting_auth" || status === "waiting_input") {
    if (gap.includes("关键词")) return { text: "补充关键词数据", tone: "blue" };
    if (gap.includes("成本")) return { text: NEXT_ACTION_USER_LABELS.fill_commercial_costs, tone: "amber" };
    if (status === "waiting_human") return { text: "去确认", tone: "amber" };
    return { text: "补充资料", tone: "amber" };
  }

  // 其余进行中（running / planning / revising / draft / paused_budget）。
  return { text: "查看进度", tone: "blue" };
}

/** 研究记录列表（C 端卡片；内部字段只进 <details> 调试折叠，主视区不泄英文枚举）。 */
export function RunListTable({ runs }: { runs: RunSummary[] }) {
  if (!runs.length) {
    return (
      <div data-testid="run-list-empty" className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        还没有研究记录。点击上方开始商品研究。
      </div>
    );
  }

  return (
    <div data-testid="run-list-table" className="space-y-3">
      {runs.map((run) => {
        const name = run.candidateLabel ?? "待补充商品名称";
        const keyword = run.keyword ?? "待补充";
        const marketplace = run.marketplace ?? "—";
        const gap = run.firstGap ?? "暂无缺口";
        const statusText = userStatus(run.status);
        const next = nextButton(run);
        const href = "/v4/runs/" + encodeURIComponent(run.runId);
        const initial = name.trim().charAt(0) || "商";

        return (
          <article key={run.runId} data-testid="run-list-row" className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <div aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-lg font-bold text-teal-700">
                {initial}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={href} className="min-w-0 truncate text-base font-semibold text-slate-900 hover:text-teal-700">
                    {name}
                  </Link>
                  <span data-testid="run-list-status" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <span aria-hidden className={"inline-block h-2 w-2 rounded-full " + statusDotClass(run.status)} />
                    {statusText}
                  </span>
                </div>

                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 break-words text-xs text-slate-600">
                  <span className="min-w-0 break-words">主关键词：{keyword}</span>
                  <span>Amazon 市场：{marketplace}</span>
                  <span>更新 {formatDateTime(run.updatedAt)}</span>
                </div>

                <p data-testid="run-list-first-gap" className="mt-2 break-words text-xs leading-5 text-slate-500">
                  当前缺口：{gap}
                </p>

                <div className="mt-3">
                  <Link
                    href={href}
                    data-testid="run-list-next-action"
                    className={"inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold transition " + NEXT_ACTION_TONE_CLASS[next.tone]}
                  >
                    <span className="mr-1" aria-hidden>
                      →
                    </span>
                    {next.text}
                  </Link>
                </div>
              </div>
            </div>

            <details data-testid="run-list-debug" className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
              <summary className="cursor-pointer select-none text-xs font-medium text-slate-500">调试详情</summary>
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] leading-5 text-slate-500 sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-slate-400">运行 ID</dt>
                  <dd className="break-all font-mono">{run.runId}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-400">候选 ID</dt>
                  <dd className="break-all font-mono">{run.candidateId}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-400">版本</dt>
                  <dd className="font-mono">rev.{run.revision}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-400">当前节点</dt>
                  <dd className="font-mono">{run.currentNode}</dd>
                </div>
                {run.wait?.reasonCode ? (
                  <div>
                    <dt className="font-medium text-slate-400">等待原因</dt>
                    <dd className="font-mono">{run.wait.reasonCode}</dd>
                  </div>
                ) : null}
                {typeof run.planRevision === "number" ? (
                  <div>
                    <dt className="font-medium text-slate-400">计划版本</dt>
                    <dd className="font-mono">rev.{run.planRevision}</dd>
                  </div>
                ) : null}
                {run.lastError?.code ? (
                  <div>
                    <dt className="font-medium text-slate-400">最后错误</dt>
                    <dd className="font-mono">{run.lastError.code}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-medium text-slate-400">已用成本</dt>
                  <dd className="font-mono">{formatMoney(run.budget?.usedCost ?? 0)}</dd>
                </div>
              </dl>
            </details>
          </article>
        );
      })}
    </div>
  );
}