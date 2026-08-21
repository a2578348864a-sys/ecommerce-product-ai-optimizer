import type { ResearchRunNode } from "@/lib/v4/contracts";
import { NODE_FLOW_ORDER, NODE_LABELS } from "./labels";

type NodePhase = "done" | "current" | "todo" | "terminal";

function phaseOf(index: number, currentIndex: number | null): NodePhase {
  if (currentIndex === null) return "todo";
  if (index < currentIndex) return "done";
  if (index === currentIndex) return "current";
  return "todo";
}

const PHASE_DOT: Record<NodePhase, string> = {
  done: "border-teal-400 bg-teal-100 text-teal-600",
  current: "border-blue-500 bg-blue-100 text-blue-700",
  todo: "border-slate-200 bg-white text-slate-400",
  terminal: "border-rose-300 bg-rose-100 text-rose-600",
};

const PHASE_LABEL: Record<NodePhase, string> = {
  done: "已完成",
  current: "进行中",
  todo: "待进行",
  terminal: "终态",
};

/**
 * 节点推进流（纯展示）。按书 05 的节点顺序绘制完成/当前/待进行；
 * 当前节点不在顺序中（fail/cancel）时以终态标记展示。
 */
export function NodeFlow({ currentNode }: { currentNode: ResearchRunNode }) {
  const currentIndex = NODE_FLOW_ORDER.indexOf(currentNode);
  const isTerminalNode = currentIndex === -1;

  return (
    <section data-testid="node-flow" data-current-node={currentNode} className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">节点进度</h2>
        <span className="text-xs text-slate-500">当前节点：{NODE_LABELS[currentNode] ?? currentNode}</span>
      </div>

      {isTerminalNode ? (
        <p className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          已到达终态节点：{NODE_LABELS[currentNode] ?? currentNode}
        </p>
      ) : null}

      <ol className="mt-4 flex flex-wrap gap-2">
        {NODE_FLOW_ORDER.map((node, index) => {
          const phase = isTerminalNode ? "todo" : phaseOf(index, currentIndex);
          const isSpecial = node === "complete" || node === "fail";
          return (
            <li
              key={node}
              data-node={node}
              data-phase={phase}
              className={"flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-semibold " + (phase === "current"
                  ? "border-blue-200 bg-blue-50 text-blue-800"
                  : phase === "done"
                    ? "border-teal-200 bg-teal-50/60 text-teal-700"
                    : "border-slate-200 bg-white text-slate-400")}
            >
              <span className={"flex h-4 w-4 items-center justify-center rounded-full border text-[10px] " + PHASE_DOT[phase]} aria-hidden>
                {phase === "done" ? "✓" : phase === "current" ? "•" : "○"}
              </span>
              <span>{NODE_LABELS[node] ?? node}</span>
              {isSpecial ? <span className="text-[10px] text-slate-400">({PHASE_LABEL[phase]})</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
