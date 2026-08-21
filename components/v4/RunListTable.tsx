import Link from "next/link";
import type { RunSummary } from "./api";
import { RunStatusBadge } from "./RunStatusBadge";
import { NODE_LABELS, formatDateTime, formatMoney } from "./labels";

/** 运行列表（纯展示）。 */
export function RunListTable({ runs }: { runs: RunSummary[] }) {
  if (!runs.length) {
    return (
      <div data-testid="run-list-empty" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        暂无 V4 研究运行记录。
      </div>
    );
  }

  return (
    <div data-testid="run-list-table" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500">
          <tr>
            <th className="px-4 py-2">运行</th>
            <th className="px-4 py-2">状态</th>
            <th className="px-4 py-2">当前节点</th>
            <th className="px-4 py-2">版本</th>
            <th className="px-4 py-2">已用成本</th>
            <th className="px-4 py-2">更新时间</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
              <td className="px-4 py-2">
                <Link href={"/v4/runs/" + encodeURIComponent(run.id)} className="font-semibold text-teal-700 hover:underline">
                  {run.id}
                </Link>
              </td>
              <td className="px-4 py-2"><RunStatusBadge status={run.status} /></td>
              <td className="px-4 py-2 text-slate-600">{NODE_LABELS[run.currentNode] ?? run.currentNode}</td>
              <td className="px-4 py-2 text-slate-600">rev.{run.revision}</td>
              <td className="px-4 py-2 text-slate-600">{formatMoney(run.budget?.usedCost ?? 0)}</td>
              <td className="px-4 py-2 text-slate-500">{formatDateTime(run.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
