import type { ResearchRunNode, ResearchRunState } from "@/lib/v4/contracts";
import { NODE_LABELS, STATUS_LABELS, WAIT_KIND_LABELS, isTerminalStatus } from "./labels";

/**
 * V4 主链阶段总览（纯展示；B 组新增，L200）。
 *
 * 主链叙事：研究计划 → 市场证据 → Gate A → 供应链 → Product Fact Gate →
 * 商业评估 → Gate B → Listing/Image → Content Review。
 *
 * 只做阶段级的「完成 / 进行中 / 待进行」判定，粒度不细化为具体节点（细粒度由
 * NodeFlow 承担）；不展示思维链，不改变事件粒度。另给出一行「下一步需要谁做什么」，
 * 数据来源 = run.wait（WAIT_KIND_LABELS + reasonCode）与 run.currentNode 的真实推导。
 */
export const STAGE_CHAIN: { id: string; label: string; nodes: ResearchRunNode[] }[] = [
  { id: "plan", label: "研究计划", nodes: ["load_context", "validate_identity", "assess_gaps", "build_plan", "revise_plan"] },
  { id: "market", label: "市场证据", nodes: ["dispatch_tool", "validate_output", "merge_evidence", "detect_conflicts", "synthesize_market"] },
  { id: "gate_a", label: "Gate A", nodes: ["gate_a"] },
  { id: "supply", label: "供应链", nodes: ["supplier_research"] },
  { id: "fact", label: "Product Fact Gate", nodes: ["product_fact_gate"] },
  { id: "commercial", label: "商业评估", nodes: ["commercial_check"] },
  { id: "gate_b", label: "Gate B", nodes: ["gate_b"] },
  { id: "content", label: "Listing / Image", nodes: ["content_handoff", "content_skills"] },
  { id: "review", label: "Content Review", nodes: ["content_review"] },
];

type StagePhase = "done" | "current" | "todo";

export function stageIndexForNode(currentNode: ResearchRunNode): number {
  return STAGE_CHAIN.findIndex((stage) => stage.nodes.includes(currentNode));
}

function currentStageIndex(currentNode: ResearchRunNode): number {
  return stageIndexForNode(currentNode);
}

function stagePhase(run: ResearchRunState, index: number): StagePhase {
  if (run.status === "completed") return "done";
  const current = currentStageIndex(run.currentNode);
  if (current === -1) return "todo"; // fail/cancel 等不在常规链内
  if (index < current) return "done";
  if (index === current) return "current";
  return "todo";
}

type NextStep = { actor: string; action: string; tone: "amber" | "rose" | "blue" | "emerald" | "slate" | "indigo" };

function describeNextStep(run: ResearchRunState): NextStep {
  // 终态以 run.status 为唯一权威：即使残留 wait，也以“已完成/取消/终态失败”为准，
  // 避免“已完成却显示等待人工”的矛盾。
  if (isTerminalStatus(run.status)) return statusNextStep(run);
  if (run.wait) {
    return { actor: "你", action: `${WAIT_KIND_LABELS[run.wait.kind] ?? run.wait.kind}（${run.wait.reasonCode}）`, tone: "amber" };
  }
  return statusNextStep(run);
}

function statusNextStep(run: ResearchRunState): NextStep {
  switch (run.status) {
    case "running":
      return { actor: "AI", action: `自动推进中 · ${NODE_LABELS[run.currentNode] ?? run.currentNode}`, tone: "blue" };
    case "planning":
      return { actor: "AI", action: "制定研究计划中", tone: "blue" };
    case "draft":
      return { actor: "AI", action: "准备启动 · 尚未创建", tone: "slate" };
    case "waiting_human":
      return { actor: "你", action: "处理人工决策节点", tone: "amber" };
    case "waiting_auth":
      return { actor: "你", action: "登录 / 授权外部来源", tone: "amber" };
    case "waiting_input":
      return { actor: "你", action: "补充输入后再继续", tone: "amber" };
    case "paused_budget":
      return { actor: "你", action: "确认预算后继续", tone: "amber" };
    case "revising":
      return { actor: "AI", action: "修订研究计划中", tone: "indigo" };
    case "failed_recoverable":
      return { actor: "你", action: "重试以恢复流程", tone: "rose" };
    case "failed_terminal":
      return { actor: "—", action: "流程以终态失败结束", tone: "rose" };
    case "cancelled":
      return { actor: "—", action: "任务已取消", tone: "slate" };
    case "completed":
      return { actor: "—", action: "任务已完成", tone: "emerald" };
    default:
      return { actor: "—", action: STATUS_LABELS[run.status] ?? run.status, tone: "slate" };
  }
}

const STAGE_PHASE_CLASS: Record<StagePhase, string> = {
  done: "border-teal-200 bg-teal-50 text-teal-700",
  current: "border-blue-200 bg-blue-50 text-blue-800 ring-2 ring-blue-100",
  todo: "border-slate-200 bg-white text-slate-400",
};

const STAGE_PHASE_DOT: Record<StagePhase, string> = {
  done: "border-teal-300 bg-teal-100 text-teal-600",
  current: "border-blue-400 bg-blue-100 text-blue-700",
  todo: "border-slate-200 bg-white text-slate-300",
};

const TONE_CLASS: Record<NextStep["tone"], string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
};

/** 阶段总览 + 下一步（纯展示）。由 RunConsoleView 注入 run。 */
export function V4RunStageNav({ run }: { run: ResearchRunState }) {
  const next = describeNextStep(run);
  const inChain = currentStageIndex(run.currentNode) !== -1 || run.currentNode === "complete" || run.status === "completed";

  return (
    <section
      data-testid="v4-run-stage-nav"
      data-current-node={run.currentNode}
      className="rounded-2xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">阶段总览</h2>
        <span className="text-xs text-slate-500">当前节点：{NODE_LABELS[run.currentNode] ?? run.currentNode}</span>
      </div>

      <ol className="mt-3 flex flex-wrap items-center gap-2">
        {STAGE_CHAIN.map((stage, index) => {
          const phase = stagePhase(run, index);
          return (
            <li key={stage.id} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden className="text-slate-300">→</span> : null}
              <span
                data-stage={stage.id}
                data-phase={phase}
                className={"inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold " + STAGE_PHASE_CLASS[phase]}
              >
                <span
                  className={"mr-1 flex size-3 items-center justify-center rounded-full border text-[9px] " + STAGE_PHASE_DOT[phase]}
                  aria-hidden
                >
                  {phase === "done" ? "✓" : phase === "current" ? "•" : "○"}
                </span>
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>

      {!inChain ? (
        <p className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          当前节点「{NODE_LABELS[run.currentNode] ?? run.currentNode}」不在常规阶段链内（终态/异常节点）。
        </p>
      ) : null}

      <div className="mt-4 border-t border-slate-100 pt-3" data-testid="v4-next-step">
        <p className="text-xs font-semibold text-slate-500">下一步需要谁做什么</p>
        <p className={"mt-1 inline-flex flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold " + TONE_CLASS[next.tone]}>
          <span aria-hidden>→</span>
          <span>{next.actor}：{next.action}</span>
        </p>
      </div>
    </section>
  );
}
