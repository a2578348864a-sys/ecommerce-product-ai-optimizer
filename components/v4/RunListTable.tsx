import Link from "next/link";
import type { RunSummary } from "./api";
import { RunStatusBadge } from "./RunStatusBadge";
import { NODE_LABELS, STATUS_LABELS, WAIT_KIND_LABELS, formatDateTime, formatMoney, isTerminalStatus } from "./labels";

type NextActionTone = "amber" | "rose" | "blue" | "emerald" | "slate" | "indigo";

const NEXT_ACTION_TONE_CLASS: Record<NextActionTone, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
};

function statusAction(run: RunSummary): { text: string; tone: NextActionTone } {
  switch (run.status) {
    case "completed":
      return { text: "已结束 · 完成", tone: "emerald" };
    case "cancelled":
      return { text: "已结束 · 取消", tone: "slate" };
    case "failed_terminal":
      return { text: "终态失败（不可恢复）", tone: "rose" };
    case "failed_recoverable":
      return { text: "可恢复失败 · 需重试", tone: "rose" };
    case "waiting_human":
      return { text: "等待人工处理", tone: "amber" };
    case "waiting_auth":
      return { text: "等待登录 / 授权", tone: "amber" };
    case "waiting_input":
      return { text: "等待输入", tone: "amber" };
    case "paused_budget":
      return { text: "预算暂停", tone: "amber" };
    case "running":
      return { text: "自动推进中", tone: "blue" };
    case "planning":
      return { text: "计划中", tone: "blue" };
    case "revising":
      return { text: "修订中", tone: "indigo" };
    case "draft":
      return { text: "草稿", tone: "slate" };
    default:
      return { text: STATUS_LABELS[run.status] ?? run.status, tone: "slate" };
  }
}

/** 「下一步人工动作」文字 + 色调：终态以 run.status 为唯一权威（避免“已完成却显示等待人工”）；否则有 wait 用 WAIT_KIND_LABELS + reasonCode，无 wait 用状态语义。 */
function nextAction(run: RunSummary): { text: string; tone: NextActionTone } {
  if (isTerminalStatus(run.status)) return statusAction(run);
  if (run.wait) {
    return {
      text: `${WAIT_KIND_LABELS[run.wait.kind] ?? run.wait.kind} · ${run.wait.reasonCode}`,
      tone: "amber",
    };
  }
  return statusAction(run);
}

/** 运行列表（纯展示；信息层级：状态 + 下一步 + 节点/版本/成本/时间）。 */
export function RunListTable({ runs }: { runs: RunSummary[] }) {
  if (!runs.length) {
    return (
      <div data-testid="run-list-empty" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        暂无 V4 研究运行记录。
      </div>
    );
  }

  return (
    <div data-testid="run-list-table" className="space-y-2">
      {runs.map((run) => {
        const next = nextAction(run);
        return (
          <article key={run.runId} data-testid="run-list-row" className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Link href={"/v4/runs/" + encodeURIComponent(run.runId)} className="font-semibold text-teal-700 hover:underline">
                {run.runId}
              </Link>
              <RunStatusBadge status={run.status} />
              <span
                data-testid="run-list-next-action"
                className={"inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold " + NEXT_ACTION_TONE_CLASS[next.tone]}
              >
                <span aria-hidden>→</span>
                <span>{next.text}</span>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>当前节点：{NODE_LABELS[run.currentNode] ?? run.currentNode}</span>
              <span>版本 rev.{run.revision}</span>
              <span>已用成本 {formatMoney(run.budget?.usedCost ?? 0)}</span>
              <span>更新 {formatDateTime(run.updatedAt)}</span>
              <span className="ml-auto">
                <Link href={"/v4/runs/" + encodeURIComponent(run.runId)} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline">
                  查看详情
                  <span aria-hidden>→</span>
                </Link>
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
