import type { ResearchRunEvent, ResearchRunState } from "@/lib/v4/contracts";
import { BudgetMeter } from "./BudgetMeter";
import { CancelResumeControls } from "./CancelResumeControls";
import { ErrorPanel } from "./ErrorPanel";
import { EventStream } from "./EventStream";
import { InterruptPanel } from "./InterruptPanel";
import { NodeFlow } from "./NodeFlow";
import { PlanSummary } from "./PlanSummary";
import { RunStatusBadge } from "./RunStatusBadge";
import { ReportPanel } from "./ReportPanel";
import { FactGatePanel, type FactGateItem, type FactGateCallbacks } from "./FactGatePanel";
import { V4RunStageNav, STAGE_CHAIN, stageIndexForNode } from "./V4RunStageNav";
import type { ReportViewLike } from "./api";
import { CommercialPanel } from "./CommercialPanel";
import { GateBPanel, type GateBPanelProps } from "./GateBPanel";
import { ContentReviewPanel } from "./ContentReviewPanel";
import { formatDateTime, isTerminalStatus } from "./labels";

type RunConsoleViewProps = {
  run: ResearchRunState;
  events: ResearchRunEvent[];
  onRefresh?: () => void;
  onRetry?: () => void;
  /** 市场报告（ReportViewLike 含 evidence 来源；ReportPanel 只读 sections/gaps/conflicts/unknowns）。 */
  report?: ReportViewLike | null;
  /** 产品事实条目；null = 尚未生成（诚实空态），数组 = 已归集（可为空）。 */
  facts?: FactGateItem[] | null;
  factCallbacks?: FactGateCallbacks;
  commercial?: { output: unknown; currency?: string } | null;
  gateB?: GateBPanelProps | null;
  contentReview?: { review: { choice?: string; note?: string; actor?: string; at?: string } | null; onChoice: (c: "approve_export" | "request_revision" | "reject_asset", note?: string) => void } | null;
};

/** 各数据域对应的产出阶段在 STAGE_CHAIN 中的下标（用于“是否应已生成”判定）。 */
const REPORT_STAGE_INDEX = STAGE_CHAIN.findIndex((s) => s.id === "market");
const FACTS_STAGE_INDEX = STAGE_CHAIN.findIndex((s) => s.id === "fact");
const COMMERCIAL_STAGE_INDEX = STAGE_CHAIN.findIndex((s) => s.id === "commercial");

/**
 * 单一权威来源：run.status（终态优先）+ run.currentNode（阶段进度）。终态时任何
 * “尚未生成”卡片都不展示，避免“已完成却显示未生成”的矛盾。
 */
function isNonTerminal(run: ResearchRunState): boolean {
  return !isTerminalStatus(run.status);
}

/** 数据域是否“应已生成”（当前节点已到达/越过其产出阶段；终态一律视为不展示待生成）。 */
function domainExpected(run: ResearchRunState, producingIndex: number): boolean {
  if (isTerminalStatus(run.status)) return false;
  const idx = stageIndexForNode(run.currentNode);
  if (idx === -1) return false; // fail/cancel 等异常节点不猜测
  return idx >= producingIndex;
}

/** 数据缺失但“应已生成”时的诚实空态卡片（虚边框 + 淡色；不伪造数量）。 */
function DataPendingSection({ testid, title, note }: { testid: string; title: string; note: string }) {
  return (
    <section data-testid={testid} className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
      <h2 className="text-sm font-bold text-slate-600">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-slate-400">{note}</p>
    </section>
  );
}

/** Run Console 详情页内容（纯展示；由 RunConsoleClient 注入数据与回调）。 */
export function RunConsoleView({ run, events, onRefresh, onRetry, report, facts, factCallbacks, commercial, gateB, contentReview }: RunConsoleViewProps) {
  return (
    <div data-testid="run-console-view" className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <RunStatusBadge status={run.status} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">运行 {run.runId}</p>
            <p className="text-xs text-slate-500">候选 {run.candidateId} · 版本 rev.{run.revision}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-400">更新 {formatDateTime(run.updatedAt)}</span>
            {onRefresh ? (
              <button
                type="button"
                data-testid="refresh-button"
                onClick={onRefresh}
                className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                刷新
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <V4RunStageNav run={run} />
      <PlanSummary run={run} events={events} />
      {run.wait ? <InterruptPanel run={run} onAction={onRefresh} /> : null}
      {run.lastError ? <ErrorPanel error={run.lastError} onRetry={onRetry} /> : null}
      <NodeFlow currentNode={run.currentNode} />
      <BudgetMeter budget={run.budget} />
      <CancelResumeControls runId={run.runId} status={run.status} revision={run.revision} onAction={onRefresh} />
      {run.currentNode === "product_fact_gate" ? (
        facts && factCallbacks ? (
          <FactGatePanel items={facts} {...factCallbacks} />
        ) : isNonTerminal(run) ? (
          <DataPendingSection
            testid="v4-facts-pending"
            title="产品事实"
            note="产品事实尚未生成：待供应商主张归集后，在此逐项确认哪些主张成为产品事实。"
          />
        ) : null
      ) : null}
      {run.currentNode === "commercial_check" ? (
        commercial?.output ? (
          <CommercialPanel status={commercial.output as never} currency={commercial.currency ?? "CNY"} />
        ) : isNonTerminal(run) ? (
          <DataPendingSection
            testid="v4-commercial-pending"
            title="商业评估"
            note="商业三情景计算尚未生成：待核心输入齐备后在此展示乐观 / 基准 / 悲观情景。"
          />
        ) : null
      ) : null}
      {run.currentNode === "gate_b" && gateB ? <GateBPanel {...gateB} /> : null}
      {run.currentNode === "content_review" ? (
        contentReview ? (
          <ContentReviewPanel review={contentReview.review} onChoice={contentReview.onChoice} />
        ) : isNonTerminal(run) ? (
          <DataPendingSection
            testid="v4-content-pending"
            title="内容人工审核"
            note="内容人工审核尚未生成：待 Listing / Image 就绪后，在此逐项核对事实声明与图片来源。"
          />
        ) : null
      ) : null}
      {report ? (
        <>
          <ReportPanel report={report} />
          <section data-testid="v4-evidence-origins" className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-slate-900">证据来源</h2>
            {report.evidence.length > 0 ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {report.evidence.map((ev, i) => (
                  <li key={i} className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                    <p className="text-xs font-semibold text-slate-700">{ev.type}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{ev.entity}</p>
                    {ev.fields ? <p className="mt-0.5 text-[11px] text-slate-400">{Object.keys(ev.fields).length} 个字段</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-400">暂无已归集的证据来源。</p>
            )}
          </section>
        </>
      ) : isNonTerminal(run) && domainExpected(run, REPORT_STAGE_INDEX) ? (
        <DataPendingSection
          testid="v4-report-pending"
          title="市场报告"
          note="市场研究报告尚未生成：仍在研究 / 合并证据阶段，生成后在此展示分节句子、缺口与冲突。"
        />
      ) : null}
      <EventStream events={events} />
    </div>
  );
}
