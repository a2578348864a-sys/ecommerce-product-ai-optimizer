"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Brain,
  ClipboardCheck,
  FileText,
  Filter,
  History,
  Lightbulb,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

/* ── Types ─────────────────────────────────────── */

type StepCountState = "loading" | number | null;

type MainLoopStep = {
  step: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  status: "available" | "embedded" | "readonly" | "planned";
  statusLabel: string;
  statusClass: string;
  href: string;
  cta: string;
  countKey: string | null; // null = 不显示数量
  countLabel: string;
  safetyNote: string;
};

/* ── Step definitions ──────────────────────────── */

const MAIN_LOOP_STEPS: MainLoopStep[] = [
  {
    step: 1,
    label: "线索发现",
    icon: Search,
    description:
      "从公开网页、RSS、Sitemap 或手动输入中发现候选商品线索。当前支持手动输入和 CSV/TXT 导入，公开爬虫遵循 robots.txt 且不调用 AI。",
    status: "available",
    statusLabel: "已可用",
    statusClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    href: "/opportunities",
    cta: "进入机会雷达",
    countKey: "opportunities",
    countLabel: "已抓取线索",
    safetyNote: "不写库、不调用 AI、遵守 robots.txt、最多 5 个 URL",
  },
  {
    step: 2,
    label: "数据清洗",
    icon: Filter,
    description:
      "对抓取的原始数据进行去重、规范化、平台识别和风险初筛。当前由机会雷达和 workflow 内部完成，无独立清洗页面。",
    status: "embedded",
    statusLabel: "内嵌能力",
    statusClass: "border-sky-200 bg-sky-50 text-sky-700",
    href: "/workflow",
    cta: "进入单品分析",
    countKey: null,
    countLabel: "内嵌于 workflow 和机会雷达",
    safetyNote: "无独立写入、不调用 AI、规则引擎兜底",
  },
  {
    step: 3,
    label: "AI 选品分析",
    icon: Brain,
    description:
      "对商品进行货源判断、风险排查、小白结论和上架文案生成。当前通过 /workflow 手动触发，支持单品和批量（最多 3 个）。",
    status: "available",
    statusLabel: "已可用",
    statusClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    href: "/workflow",
    cta: "开始单品分析",
    countKey: "workflow",
    countLabel: "已完成分析",
    safetyNote: "调用 AI（DeepSeek chat）、每次 4 步、有人工复核门控",
  },
  {
    step: 4,
    label: "选品报告",
    icon: FileText,
    description:
      "AI 分析完成后自动生成 FinalReport：推荐等级（红黄绿）、新手适合度、小单测试建议、上架前必查清单。报告内嵌于 workflow 结果中。",
    status: "embedded",
    statusLabel: "内嵌于 workflow",
    statusClass: "border-sky-200 bg-sky-50 text-sky-700",
    href: "/workflow",
    cta: "查看 workflow",
    countKey: null,
    countLabel: "报告跟随 workflow 任务",
    safetyNote: "AI 生成，需人工确认、不可直接用于上架",
  },
  {
    step: 5,
    label: "任务沉淀",
    icon: History,
    description:
      "所有分析结果自动或手动保存到任务中心，支持搜索、筛选（类型 / 人工状态 / Agent 状态）、分页和详情复盘。",
    status: "available",
    statusLabel: "已可用",
    statusClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    href: "/tasks",
    cta: "进入任务中心",
    countKey: "all",
    countLabel: "任务总数",
    safetyNote: "只读查看不写库、删除需确认、不修改他人任务",
  },
  {
    step: 6,
    label: "人工复核",
    icon: ClipboardCheck,
    description:
      "对 AI 结论逐项确认：货源判断、风险排查、小白结论、上架文案。标记人工决策状态（待判断 / 可继续 / 需补资料 / 已淘汰）。",
    status: "available",
    statusLabel: "已可用",
    statusClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    href: "/tasks?decisionStatus=pending",
    cta: "查看待决策任务",
    countKey: "pending",
    countLabel: "待人工决策",
    safetyNote: "不自动推进、高风险商品强制降级",
  },
  {
    step: 7,
    label: "下一步推进",
    icon: Lightbulb,
    description:
      "Agent 根据分析结果和复核状态给出下一步建议（继续推进 / 补资料 / 淘汰等），在任务详情中展示为 Agent 下一步推进面板。当前为只读建议，不自动执行。",
    status: "readonly",
    statusLabel: "只读建议",
    statusClass: "border-amber-200 bg-amber-50 text-amber-700",
    href: "/tasks?agentStatus=needs_review",
    cta: "查看待推进任务",
    countKey: "needs_review",
    countLabel: "待 Agent 复核",
    safetyNote: "纯信息展示、不驱动执行、需人工确认后手动推进",
  },
];

/* ── Safety rules ──────────────────────────────── */

const SAFETY_RULES = [
  "所有 AI 结论必须人工复核确认，不可跳过",
  "高风险商品（儿童、带电、食品接触等）不得自动推进",
  "当前不接真实平台账号，不操作店铺后台",
  "不自动下单、不自动采购、不自动付款",
  "不自动投放广告、不自动发布商品",
  "不自动联系供应商、不自动发送消息",
  "不自动操作第三方平台（Amazon、TikTok Shop、Etsy 等）",
];

/* ── Helpers ───────────────────────────────────── */

type CountsMap = Record<string, StepCountState>;

async function fetchCount(type: string): Promise<number | null> {
  try {
    const params = new URLSearchParams({ limit: "1" });
    if (type === "pending") {
      params.set("decisionStatus", "pending");
    } else if (type === "needs_review") {
      // agentStatus is a frontend filter; use the tasks endpoint with a marker
      // The /api/tasks endpoint doesn't directly support agentStatus,
      // but we can approximate with the decisionStatus=pending as a proxy
      // for "needs human attention"
      params.set("decisionStatus", "pending");
    } else if (type !== "all") {
      params.set("type", type);
    }

    const res = await fetch(`/api/tasks?${params.toString()}`, {
      headers: { "x-access-password": localStorage.getItem("qx:access-password:v1") || "" },
    });

    if (!res.ok) return null;

    const json = await res.json();
    if (json?.ok && typeof json?.page?.total === "number") {
      return json.page.total;
    }
    return null;
  } catch {
    return null;
  }
}

/* ── Sub-components ────────────────────────────── */

function StepCard({
  step,
  count,
}: {
  step: MainLoopStep;
  count: StepCountState;
}) {
  const Icon = step.icon;

  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-teal-200 hover:shadow-md sm:p-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="linear-icon size-10 shrink-0 rounded-xl bg-teal-50 text-teal-700">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400">
              0{step.step}
            </span>
            <h3 className="text-base font-semibold text-slate-950 group-hover:text-teal-700">
              {step.label}
            </h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${step.statusClass}`}
            >
              {step.statusLabel}
            </span>
          </div>

          <p className="mt-1.5 text-sm leading-6 text-slate-600">{step.description}</p>

          {/* Count display */}
          {step.countKey !== null && (
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-block size-1.5 rounded-full bg-teal-400" />
              {count === "loading"
                ? `${step.countLabel}：加载中…`
                : count === null
                  ? `${step.countLabel}：登录后可查看`
                  : `${step.countLabel}：${count} 条`}
            </div>
          )}

          {step.countKey === null && (
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-block size-1.5 rounded-full bg-slate-300" />
              {step.countLabel}
            </div>
          )}

          {/* Safety note */}
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="size-3 shrink-0 text-slate-300 mt-0.5" />
            {step.safetyNote}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-3 flex justify-end">
        <Link
          href={step.href}
          className="linear-button inline-flex h-9 items-center justify-center gap-1.5 px-4 text-xs font-semibold"
        >
          {step.cta}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

function StepConnector() {
  return (
    <div className="flex justify-center py-1">
      <ArrowRight className="size-5 rotate-90 text-slate-200 sm:rotate-0" />
    </div>
  );
}

/* ── Page ──────────────────────────────────────── */

export default function AgentRunPage() {
  const [counts, setCounts] = useState<CountsMap>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);

    const keys = MAIN_LOOP_STEPS.map((s) => s.countKey).filter(Boolean) as string[];
    const uniqueKeys = [...new Set(keys)];

    // Don't double-count: "pending" appears twice (step 6 and step 7 both use decisionStatus=pending)
    // We deduplicate by key but allow separate counts in the map
    const fetchAll = async () => {
      const results: CountsMap = {};
      await Promise.all(
        uniqueKeys.map(async (key) => {
          const count = await fetchCount(key);
          results[key] = count;
        }),
      );
      setCounts(results);
    };

    fetchAll();
  }, [initialized]);

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          {/* Header */}
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Phase 2-J</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  Agent 主链路驾驶舱
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  从公开线索到人工决策的 Agent 流程可视化。这是跨境电商运营全流程 Agent 工作台的内部驾驶舱 / 实验看板，不是普通用户主流程入口，也不是无人值守执行台。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/workflow"
                  className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
                >
                  开始单品分析
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/agent"
                  className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  路线图
                </Link>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* Alpha MVP disclaimer */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="linear-icon size-10 shrink-0 rounded-xl bg-amber-100 text-amber-700">
                <Sparkles className="size-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-amber-800">
                  ⚠️ 本页是 Agent 主链路驾驶舱，不是已上线的无人值守执行台
                </p>
                <p className="mt-1 text-sm leading-6 text-amber-700">
                  当前版本是 Alpha MVP / Pre-commercial 阶段。所有 AI 结论必须人工复核，所有商业动作由你手动执行。
                  不会自动下单、自动采购、自动付款、自动投广告、自动发布商品、自动联系供应商或操作第三方平台。
                </p>
              </div>
            </div>
          </div>

          {/* 从哪里开始 — quick entry cards */}
          <section className="surface-card p-5 sm:p-6">
            <div className="mb-4">
              <p className="linear-kicker">从哪里开始？</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                选择你的第一步
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                以下入口均需你手动操作，不会自动执行 AI 分析或商业动作。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Link
                href="/opportunities"
                className="group rounded-2xl border border-teal-200 bg-teal-50/60 p-4 transition hover:border-teal-300 hover:shadow-md"
              >
                <p className="text-sm font-bold text-teal-800">从机会雷达开始</p>
                <p className="mt-1 text-xs leading-5 text-teal-700">
                  还没有明确产品？先发现候选商品，再带入工作流做深度分析。
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-600 group-hover:text-teal-800">
                  进入机会雷达 <ArrowRight className="size-3" />
                </span>
              </Link>
              <Link
                href="/workflow"
                className="group rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 transition hover:border-indigo-300 hover:shadow-md"
              >
                <p className="text-sm font-bold text-indigo-800">直接单品分析</p>
                <p className="mt-1 text-xs leading-5 text-indigo-700">
                  已有商品名？输入后自动跑 4 步 AI 分析，含人工复核和完整报告。
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 group-hover:text-indigo-800">
                  开始单品分析 <ArrowRight className="size-3" />
                </span>
              </Link>
              <Link
                href="/tasks"
                className="group rounded-2xl border border-amber-200 bg-amber-50/60 p-4 transition hover:border-amber-300 hover:shadow-md"
              >
                <p className="text-sm font-bold text-amber-800">查看任务中心</p>
                <p className="mt-1 text-xs leading-5 text-amber-700">
                  查看已保存的分析记录、人工复核状态和 Agent 下一步建议。
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-600 group-hover:text-amber-800">
                  进入任务中心 <ArrowRight className="size-3" />
                </span>
              </Link>
            </div>
          </section>

          {/* Main loop pipeline */}
          <section className="surface-card p-5 sm:p-6">
            <div className="mb-4">
              <p className="linear-kicker">主链路</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                从线索到决策 · 7 步 Agent 主链路
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                绿色 = 已可用，蓝色 = 内嵌于其他能力，琥珀 = 只读建议。数量来自真实任务数据（需登录后可见）。
              </p>
            </div>

            <div className="flex flex-col gap-0">
              {MAIN_LOOP_STEPS.map((step, i) => (
                <div key={step.label}>
                  <StepCard
                    step={step}
                    count={
                      step.countKey !== null
                        ? (counts[step.countKey] ?? "loading")
                        : null
                    }
                  />
                  {i < MAIN_LOOP_STEPS.length - 1 && <StepConnector />}
                </div>
              ))}
            </div>
          </section>

          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="surface-card p-4 text-center">
              <p className="text-2xl font-bold text-teal-700">
                {counts["all"] === "loading"
                  ? "…"
                  : counts["all"] === null
                    ? "—"
                    : counts["all"]}
              </p>
              <p className="mt-1 text-xs text-slate-500">任务总数</p>
            </div>
            <div className="surface-card p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">
                {counts["pending"] === "loading"
                  ? "…"
                  : counts["pending"] === null
                    ? "—"
                    : counts["pending"]}
              </p>
              <p className="mt-1 text-xs text-slate-500">待人工决策</p>
            </div>
            <div className="surface-card p-4 text-center">
              <p className="text-2xl font-bold text-violet-600">
                {counts["workflow"] === "loading"
                  ? "…"
                  : counts["workflow"] === null
                    ? "—"
                    : counts["workflow"]}
              </p>
              <p className="mt-1 text-xs text-slate-500">已完成分析</p>
            </div>
          </div>

          {/* Safety boundary */}
          <section className="surface-card border-rose-200 bg-rose-50/50 p-5 sm:p-6">
            <div className="mb-4">
              <p className="linear-kicker text-rose-600">安全边界</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                当前不做什么
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                以下红线在任何阶段都不能越过。本驾驶舱为可视化入口，不为这些禁止动作提供任何执行入口。
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {SAFETY_RULES.map((rule) => (
                <li key={rule} className="flex items-start gap-2 text-sm leading-6 text-rose-800">
                  <ShieldCheck className="size-4 shrink-0 text-rose-500 mt-0.5" />
                  {rule}
                </li>
              ))}
            </ul>
          </section>

          {/* Footer note */}
          <p className="text-center text-xs text-slate-400">
            Agent 主链路驾驶舱 · Phase 2-J · 跨境电商运营全流程 Agent 工作台 Alpha MVP · 受控自动化 + 人工复核
          </p>
        </div>
      </div>
    </main>
  );
}
