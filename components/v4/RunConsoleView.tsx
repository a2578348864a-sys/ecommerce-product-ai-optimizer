"use client";

/**
 * V4.1 — Run Console 详情页（C 端产品化视图）。
 *
 * 普通页面只展示用户语言：所有内部英文枚举（Gate/blocked/unknown/revision/hash/
 * node/token/approve_export 等）都映射到 components/v4/userLanguage.ts 或本地中文标签；
 * 高级技术面板（NodeFlow/EventStream/BudgetMeter/V4RunStageNav/PlanSummary/CancelResumeControls）
 * 整体收进「高级技术信息」折叠区，不占用主区。
 *
 * 数据驱动：report/facts/commercial/content 为 null → 对应 Tab 显示「尚未生成」诚实卡，
 * 并说明下一步；绝不伪造数量或成功。
 */

import { useState } from "react";
import type { ResearchRunEvent, ResearchRunState } from "@/lib/v4/contracts";
import { BudgetMeter } from "./BudgetMeter";
import { CancelResumeControls } from "./CancelResumeControls";
import { EventStream } from "./EventStream";
import { InterruptActions } from "./InterruptActions";
import { NodeFlow } from "./NodeFlow";
import { PlanSummary } from "./PlanSummary";
import { V4RunStageNav } from "./V4RunStageNav";
import {
  FactGatePanel,
  factFieldLabel,
  type FactGateCallbacks,
  type FactGateItem,
} from "./FactGatePanel";
import { GateBPanel, type GateBPanelProps } from "./GateBPanel";
import { CommercialPanel } from "./CommercialPanel";
import { formatDateTime } from "./labels";
import {
  IMAGE_BLOCKED_USER_HINT,
  IMAGE_CHECK_USER_MESSAGES,
  NEXT_ACTION_USER_LABELS,
  USER_EVENT_LABELS,
  userStatus,
} from "./userLanguage";
import type { ReportViewLike } from "./api";

/** Listing/内容检查单条问题（用户语言由组件映射）。 */
export type ListingIssue = { code: string; severity: string; message: string };
/** 图片检查单条（check=检查项标识；issues=具体未通过码）。 */
export type ImageCheck = { check: string; pass: boolean; evidence: string; issues: string[] };

/** Listing 与图片 / 内容审核的相关数据投影。 */
export type ContentView = {
  listing?: { draft?: unknown; issues?: ListingIssue[]; blocked?: boolean } | null;
  images?: {
    checks?: ImageCheck[];
    overallStatus?: "ok" | "needs_human" | "blocked";
    summary?: string;
  } | null;
  review?: { choice?: string; note?: string; actor?: string; at?: string } | null;
} | null;

type RunConsoleViewProps = {
  run: ResearchRunState;
  events: ResearchRunEvent[];
  onRefresh?: () => void;
  onRetry?: () => void;
  /** 市场报告（ReportViewLike 含 evidence 来源；读 sections/gaps/conflicts/unknowns）。 */
  report?: ReportViewLike | null;
  /** 产品事实条目；null = 尚未生成（诚实空态），数组 = 已归集（可为空）。 */
  facts?: FactGateItem[] | null;
  factCallbacks?: FactGateCallbacks;
  commercial?: { output: unknown; currency?: string } | null;
  gateB?: GateBPanelProps | null;
  contentReview?: { review: { choice?: string; note?: string; actor?: string; at?: string } | null; onChoice: (c: "approve_export" | "request_revision" | "reject_asset", note?: string) => void } | null;
  /** Listing 与图片 / 内容审核数据（null = 尚未生成）。 */
  content?: ContentView;
};

// ─── 六个 Tab ─────────────────────────────────────────────────────────────

type TabKey = "conclusion" | "market" | "supply" | "cost" | "listing" | "activity";

const TABS: { key: TabKey; label: string }[] = [
  { key: "conclusion", label: "研究结论" },
  { key: "market", label: "市场与评论" },
  { key: "supply", label: "货源与商品信息" },
  { key: "cost", label: "成本与风险" },
  { key: "listing", label: "Listing与图片" },
  { key: "activity", label: "操作记录" },
];

// ─── 研究结论判定 ─────────────────────────────────────────────────────────

type VerdictKey = "worth" | "insufficient" | "not_recommended";

const VERDICT_CARDS: { key: VerdictKey; label: string; text: string; tone: string }[] = [
  { key: "worth", label: "值得继续研究", text: "资料较充分，可以继续推进。", tone: "border-emerald-200 bg-emerald-50/70 text-emerald-800" },
  { key: "insufficient", label: "资料不足", text: "当前还缺关键资料，需要补充后再判断。", tone: "border-amber-200 bg-amber-50/70 text-amber-800" },
  { key: "not_recommended", label: "暂不建议", text: "当前研究遇到问题，暂不建议继续投入。", tone: "border-rose-200 bg-rose-50/70 text-rose-800" },
];

export function deriveVerdict(run: ResearchRunState, report: ReportViewLike | null): { current: VerdictKey; note: string } {
  const gapCount = report?.gaps.length ?? 0;
  switch (run.status) {
    case "failed_terminal":
      return { current: "not_recommended", note: "研究遇到了无法继续的问题。" };
    case "cancelled":
      return { current: "not_recommended", note: "研究已取消，未完成。" };
    case "completed":
      return gapCount > 0
        ? { current: "insufficient", note: "研究已结束，但仍有资料尚未补齐。" }
        : { current: "worth", note: "研究完成，资料较充分，可继续判断。" };
    case "waiting_human":
    case "waiting_auth":
    case "waiting_input":
      return gapCount >= 2
        ? { current: "insufficient", note: "当前缺少关键资料，需要补充后才能继续。" }
        : { current: "worth", note: "等待你确认或补充后继续推进。" };
    case "paused_budget":
      return { current: "worth", note: "预算已暂停，补充后可继续。" };
    default:
      return { current: "worth", note: "研究正在推进。" };
  }
}

// ─── 为什么（五个方面）────────────────────────────────────────────────────

type AspectKey = "market" | "competition" | "pain" | "supply" | "cost";

const ASPECTS: { key: AspectKey; label: string; match: RegExp }[] = [
  { key: "market", label: "市场需求", match: /市场|需求|销量|market|demand/i },
  { key: "competition", label: "竞争情况", match: /竞争|竞品|competitor/i },
  { key: "pain", label: "买家痛点", match: /痛点|买家|review|customer|负面|差评/i },
  { key: "supply", label: "货源匹配", match: /货源|供应|supplier|1688|厂家|工厂/i },
  { key: "cost", label: "成本与风险", match: /成本|风险|cost|risk|利润|头程|物流/i },
];

export function aspectsFromReport(report: ReportViewLike | null): { key: AspectKey; label: string; sentences: string[]; count: number }[] {
  return ASPECTS.map((a) => {
    const sentences: string[] = [];
    for (const section of report?.sections ?? []) {
      if (a.match.test(section.title)) {
        for (const s of section.sentences) sentences.push(s.text);
      }
    }
    return { key: a.key, label: a.label, sentences, count: sentences.length };
  });
}

// ─── 还缺什么（来源提示 + 跳转 Tab 推导）────────────────────────────────

export function gapSourceHint(q: string, r: string): string {
  const text = (q + " " + r).toLowerCase();
  if (/关键词|market|市场|销量|评论|review/.test(text)) return "商品研究关键词工具 / 供应商资料";
  if (/成本|采购|物流|头程|价格|单价|supplier/.test(text)) return "采购 / 物流成本表";
  return "研究资料或补充商品信息";
}

function gapTargetTab(q: string, r: string): TabKey {
  const text = (q + " " + r).toLowerCase();
  if (/关键词|market|市场|销量|评论|review/.test(text)) return "market";
  if (/成本|采购|物流|头程|价格|利润|price|cost/.test(text)) return "cost";
  if (/素材|listing|图片|内容|content|文案/.test(text)) return "listing";
  if (/商品|规格|材质|尺寸|颜色|事实|fact|供应|货源/.test(text)) return "supply";
  return "conclusion";
}

// ─── 下一步（唯一主按钮推导）────────────────────────────────────────────

type PrimAction = { label: string; hint: string; onSelect: () => void; disabled?: boolean } | null;

export function primaryActionFor(
  run: ResearchRunState,
  report: ReportViewLike | null,
  deps: { onRetry?: () => void; goTab: (t: TabKey) => void },
): PrimAction {
  switch (run.status) {
    case "completed":
      return { label: "查看研究结论", hint: "研究已结束，可查看研究结论与缺口。", onSelect: () => deps.goTab("conclusion") };
    case "failed_recoverable": {
      const doRetry = deps.onRetry ?? (() => deps.goTab("conclusion"));
      return { label: NEXT_ACTION_USER_LABELS.retry, hint: "上次研究遇到问题，可重试继续。", onSelect: doRetry };
    }
    case "paused_budget": {
      const doRetry = deps.onRetry ?? (() => deps.goTab("conclusion"));
      return { label: "恢复研究", hint: "预算已暂停，恢复后继续。", onSelect: doRetry };
    }
    case "waiting_human":
    case "waiting_auth":
    case "waiting_input": {
      if (run.wait?.kind === "input") {
        return { label: "补充信息", hint: "需要你补充内容后才能继续。", onSelect: () => deps.goTab("conclusion") };
      }
      if (run.wait?.kind === "authentication") {
        return { label: "去登录 / 认证", hint: "需要登录或完成平台认证后才能继续。", onSelect: () => deps.goTab("conclusion") };
      }
      if (run.wait?.kind === "budget") {
        const doRetry = deps.onRetry ?? (() => deps.goTab("conclusion"));
        return { label: "恢复研究", hint: "预算已暂停，恢复后继续。", onSelect: doRetry };
      }
      switch (run.currentNode) {
        case "product_fact_gate":
          return { label: NEXT_ACTION_USER_LABELS.confirm_product_facts, hint: "请逐项确认商品信息。", onSelect: () => deps.goTab("supply") };
        case "commercial_check":
          return { label: NEXT_ACTION_USER_LABELS.fill_commercial_costs, hint: "请补充采购 / 物流成本。", onSelect: () => deps.goTab("cost") };
        case "gate_b":
          return { label: "确认是否进入内容制作", hint: "请在成本与风险确认决策。", onSelect: () => deps.goTab("cost") };
        case "content_review":
          return { label: NEXT_ACTION_USER_LABELS.content_review, hint: "请查看内容检查结果。", onSelect: () => deps.goTab("listing") };
        default:
          return { label: NEXT_ACTION_USER_LABELS.finish_gate_a_decision, hint: "请决定是否继续找货。", onSelect: () => deps.goTab("conclusion") };
      }
    }
    case "draft":
      return { label: "开始研究", hint: "研究尚未开始。", onSelect: () => deps.goTab("conclusion") };
    case "planning":
    case "running":
    case "revising":
    default:
      return { label: "正在研究，稍后刷新", hint: "研究正在推进，请稍后刷新查看。", onSelect: () => deps.goTab("conclusion"), disabled: true };
  }
}

// ─── Listing 与图片的用户语言映射 ────────────────────────────────────────

const IMAGE_CHECK_LABELS: Record<string, string> = {
  identity: "商品身份",
  structure: "产品结构",
  color: "颜色",
  quantity: "数量",
  accessories: "配件",
  dimensions: "尺寸",
  claims: "图中声明",
  policy: "主图规则",
  rights: "权利 / 合规",
};

/** 图片检查未通过码 → 用户可读说明（复用 userLanguage 映射，未知码回退到通用说明）。 */
function imageIssueText(code: string): string {
  return IMAGE_CHECK_USER_MESSAGES[code] ?? "需要人工核对";
}

export function imageOverallText(status: string | undefined): { label: string; tone: string } {
  switch (status) {
    case "ok":
      return { label: "检查通过（供人工复核）", tone: "border-emerald-200 bg-emerald-50/70 text-emerald-700" };
    case "needs_human":
      return { label: "存在需要人工核验的项", tone: "border-amber-200 bg-amber-50/70 text-amber-700" };
    case "blocked":
      return { label: "图片暂时不能使用", tone: "border-rose-200 bg-rose-50/70 text-rose-700" };
    default:
      return { label: "图片检查尚未完成", tone: "border-slate-200 bg-slate-50/70 text-slate-600" };
  }
}

function reviewChoiceLabel(choice: string | undefined): string {
  switch (choice) {
    case "approve_export":
      return "已确认使用";
    case "request_revision":
      return "已要求修订";
    case "reject_asset":
      return "拒绝资产";
    default:
      return choice ?? "—";
  }
}

/** 证据来源类型的用户标签（避免把 sellersprite 等英文源名泄漏到主区）。 */
function evidenceSourceLabel(type: string): string {
  if (/sellersprite/i.test(type)) return "卖家精灵数据";
  if (/1688|supplier/i.test(type)) return "1688 货源";
  if (/amazon|亚马逊/i.test(type)) return "亚马逊数据";
  if (/ebay/i.test(type)) return "eBay 数据";
  return "来源信息";
}

// ─── 小部件 ────────────────────────────────────────────────────────────────

function PendingCard({ title, note }: { title: string; note: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
      <h3 className="text-sm font-bold text-slate-600">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-400">{note}</p>
    </section>
  );
}

function StatusPill({ status }: { status: ReturnType<typeof userStatus> }) {
  const tone: Record<string, string> = {
    进行中: "border-blue-200 bg-blue-50 text-blue-700",
    等待确认: "border-amber-200 bg-amber-50 text-amber-700",
    "资料不足（研究已结束）": "border-amber-200 bg-amber-50 text-amber-700",
    已完成: "border-emerald-200 bg-emerald-50 text-emerald-700",
    失败待处理: "border-rose-200 bg-rose-50 text-rose-700",
    已取消: "border-slate-200 bg-slate-50 text-slate-600",
  };
  return (
    <span
      data-testid="run-status-badge"
      data-status={status}
      className={"inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold " + (tone[status] ?? "border-slate-200 bg-slate-50 text-slate-600")}
    >
      {status}
    </span>
  );
}

// ─── 「研究结论」Tab（五问）───────────────────────────────────────────────

export function ConclusionTab(props: {
  run: ResearchRunState;
  report: ReportViewLike | null;
  facts: FactGateItem[] | null;
  goTab: (t: TabKey) => void;
  primary: PrimAction;
}) {
  const { run, report, facts, goTab, primary } = props;
  const verdict = deriveVerdict(run, report);
  const aspects = aspectsFromReport(report);
  const confirmed = (facts ?? []).filter((f) => f.status === "confirmed");

  return (
    <div className="space-y-5" data-testid="v4-conclusion-tab">
      <section data-testid="v4-verdict-cards">
        <h3 className="text-sm font-bold text-slate-800">这个商品目前怎么样？</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {VERDICT_CARDS.map((v) => {
            const active = v.key === verdict.current;
            return (
              <div
                key={v.key}
                data-testid={"verdict-" + v.key}
                data-current={active ? "true" : "false"}
                className={"rounded-2xl border p-3 " + (active ? v.tone : "border-slate-200 bg-white text-slate-400")}
              >
                <p className="text-sm font-bold">{v.label}</p>
                <p className="mt-1 text-[11px] leading-4">{v.text}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500" data-testid="v4-verdict-note">{verdict.note}</p>
      </section>

      <section data-testid="v4-why-aspects">
        <h3 className="text-sm font-bold text-slate-800">为什么？</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {aspects.map((a) => (
            <div key={a.key} className="rounded-xl border border-slate-100 bg-white/85 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-700">{a.label}</p>
                <span className="shrink-0 rounded bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">{a.count} 条</span>
              </div>
              {a.count > 0 ? (
                <ul className="mt-1 list-inside list-disc space-y-1 text-xs leading-5 text-slate-600">
                  {a.sentences.slice(0, 5).map((s, i) => (
                    <li key={i} className="truncate" title={s}>{s}</li>
                  ))}
                  {a.count > 5 ? <li className="list-none text-slate-400">… 其余 {a.count - 5} 条见「市场与评论」</li> : null}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-slate-400" data-testid={"aspect-empty-" + a.key}>待补充</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section data-testid="v4-confirmed-facts">
        <h3 className="text-sm font-bold text-slate-800">现在确认了什么？</h3>
        {confirmed.length > 0 ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {confirmed.map((f) => (
              <li key={f.key} className="rounded-xl border border-slate-100 bg-white/85 px-3 py-2">
                <p className="text-xs font-semibold text-slate-600">{factFieldLabel(f.field)}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-800">{f.value || "—"}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-400" data-testid="v4-no-confirmed">还没有确认信息。</p>
        )}
      </section>

      <section data-testid="v4-gaps">
        <h3 className="text-sm font-bold text-slate-800">还缺什么？</h3>
        {report && report.gaps.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {report.gaps.map((g, i) => {
              const source = gapSourceHint(g.question, g.reason);
              const target = gapTargetTab(g.question, g.reason);
              return (
                <li key={i} data-testid="v4-gap-item" className="rounded-xl border border-slate-100 bg-white/85 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">缺什么：{g.question}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-600">为什么需要：{g.reason}</p>
                      <p className="mt-1 text-xs text-slate-500">去哪里补：{source}</p>
                    </div>
                    <button
                      type="button"
                      data-testid={"gap-action-" + i}
                      onClick={() => goTab(target)}
                      className="shrink-0 inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                    >
                      去补充
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">「去补充」会跳转到对应资料 / 表单，需你在这边录入或确认。</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-400" data-testid="v4-gaps-empty">
            {report ? "暂未发现明确缺口。" : "研究仍在进行，尚未生成缺口列表。"}
          </p>
        )}
      </section>

      <section data-testid="v4-next-step">
        <h3 className="text-sm font-bold text-slate-800">下一步做什么？</h3>
        {primary ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs leading-5 text-slate-500">{primary.hint}</p>
            <button
              type="button"
              data-testid="next-step-action"
              disabled={primary.disabled}
              onClick={primary.onSelect}
              className="mt-3 inline-flex h-10 items-center justify-center rounded-lg border border-teal-300 bg-teal-50 px-4 text-sm font-semibold text-teal-700 hover:bg-teal-100 transition disabled:opacity-60"
            >
              {primary.label}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-400">暂无可执行的下一步。</p>
        )}
      </section>
    </div>
  );
}

// ─── 「市场与评论」Tab ────────────────────────────────────────────────────

export function MarketTab({ report }: { report: ReportViewLike | null }) {
  if (!report) {
    return (
      <PendingCard
        title="市场与评论"
        note="市场研究报告尚未生成；仍在研究 / 合并证据阶段，生成后在此展示分节结论、冲突与未知项。"
      />
    );
  }
  return (
    <div className="space-y-4" data-testid="v4-market-tab">
      <section data-testid="v4-market-sections" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800">市场研究报告</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{report.summary}</p>
        {report.sections.length > 0 ? (
          <div className="mt-4 space-y-4">
            {report.sections.map((section, i) => (
              <div key={i}>
                <h4 className="text-xs font-semibold text-teal-700">{section.title}</h4>
                <ul className="mt-1 space-y-1.5">
                  {section.sentences.map((s, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className={"mt-1.5 size-1.5 shrink-0 rounded-full " + (s.kind === "factual" ? "bg-teal-500" : s.kind === "conflict" ? "bg-amber-500" : "bg-slate-300")} />
                      <span>
                        {s.text}
                        {s.evidenceRefs.length > 0 && (
                          <span className="ml-2 text-xs text-slate-400">依据 {s.evidenceRefs.length} 条</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-400" data-testid="v4-market-sections-empty">暂无可展示的分节结论。</p>
        )}
      </section>

      {report.conflicts.length > 0 ? (
        <section data-testid="v4-market-conflicts" className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
          <h3 className="text-sm font-bold text-slate-800">发现的数据不一致（{report.conflicts.length}）</h3>
          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
            {report.conflicts.map((c, i) => (
              <li key={i}>字段「{c.field}」在两个来源中不一致：{c.evidenceA} vs {c.evidenceB}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-400">不一致来源需人工复核后才能作为依据。</p>
        </section>
      ) : null}

      {report.unknowns.length > 0 ? (
        <section data-testid="v4-market-unknowns" className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800">暂未获得数据</h3>
          <ul className="mt-2 list-inside list-disc text-xs leading-5 text-slate-600">
            {report.unknowns.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </section>
      ) : null}

      <section data-testid="v4-evidence-origins" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800">证据来源</h3>
        {report.evidence.length > 0 ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {report.evidence.map((ev, i) => (
              <li key={i} className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                <p className="text-xs font-semibold text-slate-700">{evidenceSourceLabel(ev.type)}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{ev.entity}</p>
                {ev.fields ? <p className="mt-0.5 text-[11px] text-slate-400">{Object.keys(ev.fields).length} 个字段</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-400">暂无已归集的证据来源。</p>
        )}
      </section>
    </div>
  );
}

// ─── 「货源与商品信息」Tab ────────────────────────────────────────────────

export function SupplyTab(props: {
  run: ResearchRunState;
  report: ReportViewLike | null;
  facts: FactGateItem[] | null;
  factCallbacks?: FactGateCallbacks;
}) {
  const { run, report, facts, factCallbacks } = props;
  const suppliers = (report?.evidence ?? []).filter((e) => /sellersprite|1688|supplier/i.test(e.type) || (e.entity ?? "").includes("1688"));

  return (
    <div className="space-y-4" data-testid="v4-supply-tab">
      <section data-testid="v4-suppliers" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800">货源与来源</h3>
        {suppliers.length > 0 ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {suppliers.map((ev, i) => {
              const fields = (ev.fields ?? {}) as Record<string, unknown>;
              return (
                <li key={i} className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-700">{evidenceSourceLabel(ev.type)}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{ev.entity}</p>
                  {fields.offerIdentity ? <p className="mt-0.5 text-[11px] text-slate-400">货号 / 商品标识：{String(fields.offerIdentity)}</p> : null}
                  {fields.variantKey ? <p className="mt-0.5 text-[11px] text-slate-400">规格：{String(fields.variantKey)}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-400" data-testid="v4-suppliers-empty">尚未归集到货源 / 来源信息。</p>
        )}
      </section>

      <section data-testid="v4-facts" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800">商品信息（已确认 / 待确认）</h3>
        {facts && facts.length > 0 ? (
          factCallbacks ? (
            <FactGatePanel items={facts} {...factCallbacks} />
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {facts.map((f) => (
                <li key={f.key} className="rounded-xl border border-slate-100 bg-white/85 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-600">{factFieldLabel(f.field)}</p>
                  <p className="mt-0.5 text-sm font-medium text-slate-800">{f.value || "—"}</p>
                </li>
              ))}
            </ul>
          )
        ) : facts === null && !isTerminal(run) && currentNodeAtOrAfter(run, "product_fact_gate") ? (
          <PendingCard
            title="商品信息"
            note="商品信息尚未生成：待供应商主张归集后，在此逐项确认哪些主张成为商品事实。"
          />
        ) : (
          <p className="mt-2 text-xs text-slate-400" data-testid="v4-facts-empty">还没有确认信息。</p>
        )}
      </section>
    </div>
  );
}

// ─── 「成本与风险」Tab ────────────────────────────────────────────────────

export function CostTab(props: {
  run: ResearchRunState;
  commercial: { output: unknown; currency?: string } | null;
  gateB?: GateBPanelProps | null;
}) {
  const { run, commercial, gateB } = props;
  return (
    <div className="space-y-4" data-testid="v4-cost-tab">
      {commercial?.output ? (
        <CommercialPanel status={commercial.output as never} currency={commercial.currency ?? "CNY"} />
      ) : !isTerminal(run) && currentNodeAtOrAfter(run, "commercial_check") ? (
        <PendingCard
          title="成本与风险"
          note="成本三情景计算尚未生成：待核心输入齐备后在此展示乐观 / 基准 / 悲观情景。"
        />
      ) : (
        <PendingCard title="成本与风险" note="成本与风险计算尚未生成。" />
      )}

      {run.currentNode === "gate_b" && gateB ? <GateBPanel {...gateB} /> : null}
    </div>
  );
}

// ─── 「Listing 与图片」Tab ────────────────────────────────────────────────

export function ListingTab(props: {
  run: ResearchRunState;
  content?: ContentView;
  contentReview?: { review: { choice?: string; note?: string; actor?: string; at?: string } | null; onChoice: (c: "approve_export" | "request_revision" | "reject_asset", note?: string) => void } | null;
}) {
  const { run, content, contentReview } = props;
  const listing = content?.listing ?? null;
  const images = content?.images ?? null;
  const imageOverall = imageOverallText(images?.overallStatus);
  const imagesBlocked = images?.overallStatus === "blocked";
  const review = contentReview?.review ?? content?.review ?? null;

  return (
    <div className="space-y-4" data-testid="v4-listing-tab">
      <section data-testid="v4-listing" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800">Listing 内容检查</h3>
        {listing ? (
          <>
            {listing.blocked ? (
              <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50/70 p-3">
                <p className="text-sm font-semibold text-rose-700">Listing 暂时不能使用</p>
                <p className="mt-1 text-xs leading-5 text-rose-600">存在需要修正的内容，请补充 / 修正后重新生成。</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Listing 草稿已生成，内容检查未发现需阻断的问题（仍以页面人工核对为准）。</p>
            )}
            {listing.issues && listing.issues.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {listing.issues.map((iss, i) => (
                  <li key={i} className={"rounded-lg border px-3 py-2 text-xs leading-5 " + (iss.severity === "error" ? "border-rose-100 bg-rose-50/60 text-rose-700" : "border-amber-100 bg-amber-50/60 text-amber-700")}>
                    {iss.message}
                  </li>
                ))}
              </ul>
            ) : listing.blocked ? (
              <p className="mt-2 text-xs text-slate-400">具体问题见调试详情。</p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-xs text-slate-400" data-testid="v4-listing-empty">Listing 尚未生成。</p>
        )}
      </section>

      <section data-testid="v4-images" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800">图片检查</h3>
        {images ? (
          <>
            <span className={"mt-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold " + imageOverall.tone} data-testid="v4-images-overall">
              {imageOverall.label}
            </span>
            {images.checks && images.checks.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {images.checks.map((c, i) => {
                  const label = IMAGE_CHECK_LABELS[c.check] ?? "图片检查项";
                  return (
                    <li key={i} className={"rounded-xl border px-3 py-2 " + (c.pass ? "border-slate-100 bg-slate-50/50" : "border-amber-100 bg-amber-50/60")}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-700">{label}</p>
                        <span className={"text-xs font-semibold " + (c.pass ? "text-emerald-700" : "text-amber-700")}>{c.pass ? "通过" : "需核对"}</span>
                      </div>
                      {!c.pass && c.issues.length > 0 ? (
                        <p className="mt-1 text-xs leading-5 text-slate-600">{c.issues.map(imageIssueText).join("；")}</p>
                      ) : null}
                      {c.evidence ? <p className="mt-1 text-[11px] text-slate-400">{c.evidence}</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-400">暂无图片检查明细。</p>
            )}
            {imagesBlocked ? (
              <div data-testid="v4-images-blocked-hint" className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
                <p className="text-sm font-semibold text-rose-700">{IMAGE_BLOCKED_USER_HINT}</p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-xs text-slate-400" data-testid="v4-images-empty">图片检查尚未生成。</p>
        )}
      </section>

      <section data-testid="v4-content-review" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800">人工审核</h3>
        {review?.choice ? (
          <p className="mt-2 text-xs font-semibold text-slate-600" data-testid="v4-review-status">
            审核结果：{reviewChoiceLabel(review.choice)}
            {review.at ? "（" + formatDateTime(review.at) + "）" : ""}
          </p>
        ) : null}

        {run.currentNode === "content_review" && contentReview ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={imagesBlocked}
              data-testid="content-approve"
              onClick={() => contentReview.onChoice("approve_export")}
              className="inline-flex h-9 items-center rounded-lg border border-teal-300 bg-teal-50 px-3 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              确认使用
            </button>
            <button
              type="button"
              data-testid="content-revision"
              onClick={() => contentReview.onChoice("request_revision", "需修订")}
              className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              要求修订
            </button>
            <button
              type="button"
              data-testid="content-reject"
              onClick={() => contentReview.onChoice("reject_asset", "拒绝资产")}
              className="inline-flex h-9 items-center rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition"
            >
              拒绝资产
            </button>
          </div>
        ) : null}
        {imagesBlocked && run.currentNode === "content_review" ? (
          <p className="mt-2 text-[11px] text-rose-600">图片未通过检查，「确认使用」暂时不可用。</p>
        ) : null}
        <p className="mt-3 text-[11px] text-slate-400">内容不会自动发布；核对 Listing 事实声明与图片来源后由你本人决定。</p>
      </section>
    </div>
  );
}

// ─── 「操作记录」Tab（仅用户事件映射）─────────────────────────────────────

const USER_ACTIVITY_TYPES = new Set(["run_created", "evidence_merged", "waiting_human", "fact_confirmed", "completed", "failed", "cancelled"]);

export function ActivityTab({ events }: { events: ResearchRunEvent[] }) {
  const userEvents = events.filter((e) => USER_ACTIVITY_TYPES.has(e.type));
  if (userEvents.length === 0) {
    return (
      <PendingCard title="操作记录" note="还没有操作记录。" />
    );
  }
  return (
    <ol className="space-y-2" data-testid="v4-activity-list">
      {userEvents.map((e) => (
        <li key={e.seq} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white/85 px-3 py-2">
          <span className={"mt-0.5 size-2 shrink-0 rounded-full " + (e.type === "failed" || e.type === "cancelled" ? "bg-rose-400" : e.type === "completed" ? "bg-emerald-500" : "bg-teal-400")} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-800">{USER_EVENT_LABELS[e.type] ?? e.type}</p>
          </div>
          <time className="shrink-0 text-[11px] text-slate-400">{formatDateTime(e.createdAt)}</time>
        </li>
      ))}
    </ol>
  );
}

// ─── 运行状态推进辅助 ─────────────────────────────────────────────────────

function isTerminal(run: ResearchRunState): boolean {
  return run.status === "completed" || run.status === "cancelled" || run.status === "failed_terminal";
}

const STAGE_AFTER: Record<string, number> = {
  load_context: 0,
  validate_identity: 1,
  assess_gaps: 2,
  build_plan: 3,
  dispatch_tool: 4,
  validate_output: 5,
  merge_evidence: 6,
  detect_conflicts: 7,
  revise_plan: 8,
  synthesize_market: 9,
  gate_a: 10,
  supplier_research: 11,
  product_fact_gate: 12,
  commercial_check: 13,
  gate_b: 14,
  content_handoff: 15,
  content_skills: 16,
  content_review: 17,
  complete: 18,
};

function currentNodeAtOrAfter(run: ResearchRunState, target: string): boolean {
  const idx = STAGE_AFTER[run.currentNode];
  const tidx = STAGE_AFTER[target];
  if (idx === undefined || tidx === undefined) return false;
  return idx >= tidx;
}

// ─── 主组件 ────────────────────────────────────────────────────────────────

/** Run Console 详情页（C 端产品化展示；由 RunConsoleClient 注入数据与回调）。 */
export function RunConsoleView({ run, events, onRefresh, onRetry, report, facts, factCallbacks, commercial, gateB, contentReview, content }: RunConsoleViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("conclusion");

  const goTab = (t: TabKey) => setActiveTab(t);
  const primary = primaryActionFor(run, report ?? null, { onRetry, goTab });

  const marketplaceLine = report?.summary ? report.summary : "市场研究报告尚未生成";

  const advancedPanel = (
    <div className="space-y-4 px-4 pb-4">
      {run.wait ? <InterruptActions runId={run.runId} wait={run.wait} revision={run.revision} onAction={onRefresh} /> : null}
      <V4RunStageNav run={run} />
      <PlanSummary run={run} events={events} />
      <NodeFlow currentNode={run.currentNode} />
      <BudgetMeter budget={run.budget} />
      <CancelResumeControls runId={run.runId} status={run.status} revision={run.revision} onAction={onRefresh} />
      <details className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-500">原始运行信息</summary>
        <dl className="mt-2 space-y-1 text-[11px] leading-5 text-slate-500">
          <div className="flex justify-between gap-3"><dt>运行 ID</dt><dd className="break-all text-right">{run.runId}</dd></div>
          <div className="flex justify-between gap-3"><dt>候选 ID</dt><dd className="break-all text-right">{run.candidateId?.slice(0, 8)}{run.candidateId && run.candidateId.length > 8 ? "…" : ""}</dd></div>
          <div className="flex justify-between gap-3"><dt>节点</dt><dd className="break-all text-right">{run.currentNode}</dd></div>
          <div className="flex justify-between gap-3"><dt>版本</dt><dd className="text-right">rev.{run.revision}</dd></div>
          {run.wait ? <div className="flex justify-between gap-3"><dt>等待</dt><dd className="break-all text-right">{run.wait.kind} / {run.wait.reasonCode}</dd></div> : null}
          {run.lastError ? <div className="flex justify-between gap-3"><dt>错误</dt><dd className="break-all text-right">{run.lastError.code}（{run.lastError.recoverable ? "可恢复" : "不可恢复"}）</dd></div> : null}
        </dl>
      </details>
      <EventStream events={events} />
    </div>
  );

  return (
    <div data-testid="run-console-view" className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">V4 研究任务</p>
            <h1 className="section-title text-xl sm:text-2xl" data-testid="run-title">候选商品研究</h1>
            <p className="mt-1 text-xs leading-5 text-slate-500" data-testid="run-market">{marketplaceLine}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={userStatus(run.status)} />
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {primary ? (
            <button
              type="button"
              data-testid="primary-action"
              disabled={primary.disabled}
              onClick={primary.onSelect}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-teal-300 bg-teal-50 px-4 text-sm font-semibold text-teal-700 hover:bg-teal-100 transition disabled:opacity-60"
            >
              {primary.label}
            </button>
          ) : null}
          <span className="text-xs text-slate-400" data-testid="primary-action-hint">{primary?.hint ?? "尚未确定下一步。"}</span>
          <a
            href={"/v4/runs/" + encodeURIComponent(run.runId) + "/debug"}
            className="ml-auto text-[11px] text-slate-300 underline-offset-2 hover:text-slate-500 hover:underline"
            data-testid="debug-link"
          >
            调试详情
          </a>
        </div>
      </section>

      <div role="tablist" aria-orientation="horizontal" className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
        {TABS.map((t) => {
          const active = t.key === activeTab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={"tab-" + t.key}
              data-active={active ? "true" : "false"}
              onClick={() => setActiveTab(t.key)}
              className={"inline-flex h-9 flex-1 items-center justify-center whitespace-nowrap rounded-xl px-2 text-xs font-semibold transition sm:flex-none sm:px-4 " + (active ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div data-testid="tab-panel" role="tabpanel" className="rounded-2xl border border-slate-200 bg-white p-4">
        {activeTab === "conclusion" ? (
          <ConclusionTab run={run} report={report ?? null} facts={facts ?? null} goTab={goTab} primary={primary} />
        ) : activeTab === "market" ? (
          <MarketTab report={report ?? null} />
        ) : activeTab === "supply" ? (
          <SupplyTab run={run} report={report ?? null} facts={facts ?? null} factCallbacks={factCallbacks} />
        ) : activeTab === "cost" ? (
          <CostTab run={run} commercial={commercial ?? null} gateB={gateB} />
        ) : activeTab === "listing" ? (
          <ListingTab run={run} content={content} contentReview={contentReview} />
        ) : (
          <ActivityTab events={events} />
        )}
      </div>

      <details className="rounded-2xl border border-slate-200 bg-white p-0" data-testid="advanced-panel">
        <summary className="cursor-pointer rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 hover:text-slate-800">
          高级技术信息
        </summary>
        {advancedPanel}
      </details>
    </div>
  );
}
