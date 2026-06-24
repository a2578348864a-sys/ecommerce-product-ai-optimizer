import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Brain,
  ClipboardCheck,
  History,
  LayoutDashboard,
  ListChecks,
  Lock,
  Package,
  ShieldCheck,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

export const metadata: Metadata = {
  title: "能力路线图 - 轻选 Agent",
  description: "跨境电商运营全流程 Agent 工作台的能力路线图与阶段说明，明确当前可用能力与规划方向。",
};

/* ── Data ─────────────────────────────────────── */

const availableAbilities = [
  {
    title: "单品一键分析",
    href: "/workflow",
    icon: LayoutDashboard,
    description: "输入一个商品，自动完成货源判断、风险排查、小白结论和上架文案，结果需人工逐项复核。",
    status: "✅ 可用",
    statusClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    review: "需要人工复核",
    auto: "不会自动执行商业动作",
  },
  {
    title: "批量受控分析",
    href: "/workflow/batch",
    icon: ListChecks,
    description: "一次最多 3 个商品，支持 CSV/TXT 导入，前端串行执行，分析完成后自动保存到任务中心。",
    status: "✅ 可用",
    statusClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    review: "需要人工复核",
    auto: "不会自动执行商业动作",
  },
  {
    title: "机会雷达",
    href: "/opportunities",
    icon: Target,
    description: "从公开线索中发现候选商品，抓取→清洗→去重→评分，整理成候选机会池，为后续分析做准备。",
    status: "✅ 可用",
    statusClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    review: "需要人工确认候选",
    auto: "不会自动下单采购",
  },
  {
    title: "任务沉淀中心",
    href: "/tasks",
    icon: History,
    description: "所有分析结果归档、人工决策状态标记（待判断/可继续/需补资料/已淘汰）、历史复盘追踪。",
    status: "✅ 可用",
    statusClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    review: "需要人工决策",
    auto: "不会自动推进任务",
  },
];

const plannedAbilities = [
  {
    title: "自动发现商品机会",
    icon: Target,
    description: "未来系统可通过合规数据源自动发现候选商品，当前需手动输入或粘贴线索。",
  },
  {
    title: "自动生成选品决策",
    icon: Brain,
    description: "未来 AI 可基于历史数据和规则自动给出采购决策建议，但仍需人工最终确认。",
  },
  {
    title: "自动生成 Listing 草稿",
    icon: Package,
    description: "未来系统可自动生成多个平台版本的上架文案草稿，当前单品分析已支持 1 份草稿。",
  },
  {
    title: "自动沉淀任务和复盘",
    icon: History,
    description: "未来分析完成后自动归档并生成复盘报告，当前需手动保存到任务中心。",
  },
  {
    title: "自动化执行前人工授权",
    icon: Lock,
    description: "所有自动化动作在执行前必须经过人工授权门控，不可跳过。此为永久安全机制。",
  },
];

const pathSteps = [
  { label: "输入商品/线索", status: "done" as const, tooltip: "手动输入、CSV/TXT 导入、机会雷达" },
  { label: "AI 分析", status: "done" as const, tooltip: "货源判断、风险排查、小白结论、上架文案" },
  { label: "风险判断", status: "done" as const, tooltip: "红黄绿灯、硬规则兜底、合规提示" },
  { label: "人工复核", status: "review" as const, tooltip: "逐项确认 AI 结论，标记决策状态" },
  { label: "保存任务", status: "done" as const, tooltip: "沉淀到任务中心，支持搜索、筛选、复盘" },
  { label: "下一步行动", status: "planned" as const, tooltip: "基于分析结果自动生成执行计划（规划中）" },
];

const safetyRules = [
  "所有 AI 结论必须人工复核确认，不可跳过",
  "高风险商品（儿童、带电、食品接触等）不得自动推进",
  "当前不接真实平台账号，不操作店铺后台",
  "不自动下单、不自动采购、不自动付款",
  "不自动投放广告、不自动发布商品",
  "不自动联系供应商、不自动发送消息",
  "不自动操作第三方平台（Amazon、TikTok Shop、Etsy 等）",
];

/* ── Page ─────────────────────────────────────── */

export default function AgentPage() {
  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Phase 2-E</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  Agent 能力路线图与阶段说明
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  轻选 Agent 是跨境电商运营全流程 Agent 工作台。当前是 Alpha MVP 阶段，先开放找机会、单品分析、运营任务中心三段前半链路。
                  本页是路线图和能力规划，不是当前主流程入口。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/agent/run"
                  className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
                >
                  进入 Agent 主流程
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/workflow/batch"
                  className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  批量分析
                </Link>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* ── Alpha MVP 声明 ── */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="linear-icon size-10 shrink-0 rounded-xl bg-amber-100 text-amber-700">
                <Sparkles className="size-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-amber-800">
                  ⚠️ 本页是路线图和能力展示，不是已上线的无人值守执行台
                </p>
                <p className="mt-1 text-sm leading-6 text-amber-700">
                  当前版本是 Alpha MVP / Pre-commercial 阶段。以下「规划中」的能力不会在当前版本执行，
                  也不会自动下单、自动铺货、自动投流。所有 AI 结论必须人工复核。
                </p>
              </div>
            </div>
          </div>

          {/* ── 当前可用能力 ── */}
          <section className="surface-card p-5 sm:p-6">
            <div className="mb-4">
              <p className="linear-kicker">当前可用</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                受控自动化 MVP · 你就能用的分析能力
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                以下能力均已完成并部署生产。AI 负责分析和生成，关键决策由你人工复核确认。
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {availableAbilities.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-teal-200 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <span className="linear-icon size-10 shrink-0 rounded-xl bg-teal-50 text-teal-700">
                      <item.icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-slate-950 group-hover:text-teal-700">
                          {item.title}
                        </h3>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${item.statusClass}`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                          {item.review}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
                          {item.auto}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* ── 主链路可视化 ── */}
          <section className="surface-card p-5 sm:p-6">
            <div className="mb-4">
              <p className="linear-kicker">主链路</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                从输入到决策：当前链路可视化
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                绿色 = 已实现，琥珀 = 需人工确认，灰色 = 规划中。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {pathSteps.map((step, i) => (
                <div key={step.label} className="flex items-center gap-2">
                  <div
                    className={`rounded-xl border px-4 py-3 text-center ${
                      step.status === "done"
                        ? "border-emerald-200 bg-emerald-50/60"
                        : step.status === "review"
                          ? "border-amber-200 bg-amber-50/60"
                          : "border-dashed border-slate-200 bg-slate-50/60"
                    }`}
                    title={step.tooltip}
                  >
                    <p
                      className={`text-xs font-semibold ${
                        step.status === "done"
                          ? "text-emerald-700"
                          : step.status === "review"
                            ? "text-amber-700"
                            : "text-slate-400"
                      }`}
                    >
                      {step.label}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {step.status === "done" ? "已实现" : step.status === "review" ? "需人工" : "规划中"}
                    </p>
                  </div>
                  {i < pathSteps.length - 1 && (
                    <ArrowRight className="size-4 shrink-0 text-slate-300" />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── 全自动 Agent 路线图 ── */}
          <section className="surface-card p-5 sm:p-6">
            <div className="mb-4">
              <p className="linear-kicker">路线图</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                全自动 Agent 能力规划 · 暂不可用
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                以下是未来全自动电商 Agent 的能力方向。当前均未上线，不会真实执行。
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {plannedAbilities.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4 opacity-70"
                >
                  <div className="flex items-start gap-3">
                    <span className="linear-icon size-10 shrink-0 rounded-xl bg-slate-100 text-slate-400">
                      <item.icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-slate-500">{item.title}</h3>
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
                          ⏸️ 规划中
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-400">{item.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── 安全边界 ── */}
          <section className="surface-card border-rose-200 bg-rose-50/50 p-5 sm:p-6">
            <div className="mb-4">
              <p className="linear-kicker text-rose-600">安全边界</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                当前不做什么
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                以下红线在任何阶段都不能越过。即使未来开放更多自动化能力，也必须保留人工授权门控。
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {safetyRules.map((rule) => (
                <li key={rule} className="flex items-start gap-2 text-sm leading-6 text-rose-800">
                  <ShieldCheck className="size-4 shrink-0 text-rose-500 mt-0.5" />
                  {rule}
                </li>
              ))}
            </ul>
          </section>

          {/* ── 下一阶段 ── */}
          <section className="surface-card p-5 sm:p-6">
            <div className="mb-4">
              <p className="linear-kicker">后续</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                Phase 2-F+ 才考虑的能力
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                以下能力在当前 Alpha MVP 阶段不会开发，推迟到商业化准备阶段再评估。
              </p>
            </div>
            <div className="grid gap-3 text-sm leading-6 text-slate-500 sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-slate-300">•</span>
                Agent workflow 步骤编排（sourcing → risk → summary → listing 可视化为 workflow steps）
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-slate-300">•</span>
                多 Agent 协同状态机（暂停、取消、重试、回滚）
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-slate-300">•</span>
                WebSocket 实时进度推送和步骤耗时统计
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-slate-300">•</span>
                完整的执行日志和自动化审计台
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-slate-300">•</span>
                商业化底座：权限、配额、计费、多用户隔离
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-slate-300">•</span>
                外部平台授权执行（需平台官方 API，非模拟登录）
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              以上所有能力即使未来实现，也必须在人工授权门控下运行，不可跳过人工确认直接执行商业动作。
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
