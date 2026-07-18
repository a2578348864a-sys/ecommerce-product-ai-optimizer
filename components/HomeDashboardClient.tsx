"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  History,
  Loader2,
  Lock,
  Route,
  Search,
  Sparkles,
  Target,
  Unlock,
} from "lucide-react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { readCandidatePool } from "@/lib/opportunityCandidatePool";
import {
  getRecommendedNextAction,
  parseRecentSingleRun,
  summarizeCandidatePool,
  summarizeTaskFollowUp,
  WORKFLOW_SINGLE_RUN_STORAGE_KEY,
  type HomeDashboardTaskItem,
  type TaskFollowUpSummary,
} from "@/lib/homeDashboardSummary";

type TasksApiResponse =
  | { ok: true; records?: HomeDashboardTaskItem[]; data?: { items?: HomeDashboardTaskItem[] } }
  | { ok: false; error?: { message?: string } };

type TaskLoadState =
  | { status: "loading"; summary: null; message: string }
  | { status: "ready"; summary: TaskFollowUpSummary; message: string }
  | { status: "unavailable"; summary: null; message: string };

const taskFallbackMessage = "输入访问密码后显示真实任务统计。";

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatRecentTime(value: number | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function StatCard({
  title,
  value,
  description,
  href,
  cta,
  tone = "teal",
}: {
  title: string;
  value: string;
  description: string;
  href: string;
  cta: string;
  tone?: "teal" | "amber" | "indigo" | "slate";
}) {
  const toneClass = tone === "amber"
    ? "border-amber-200 bg-amber-50/65 text-amber-700"
    : tone === "indigo"
      ? "border-indigo-200 bg-indigo-50/65 text-indigo-700"
      : tone === "slate"
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-teal-200 bg-teal-50/70 text-teal-700";

  return (
    <article className="surface-card-strong flex min-h-[190px] min-w-0 flex-col p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600">{title}</p>
        <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${toneClass}`}>{cta}</span>
      </div>
      <p className="mt-4 text-3xl font-semibold text-slate-950">{value}</p>
      <p className="mt-2 flex-1 text-sm leading-6 text-slate-500">{description}</p>
      <Link href={href} className="linear-button mt-4 inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold">
        {cta}
        <ArrowRight className="size-4" />
      </Link>
    </article>
  );
}

const workflowSteps = [
  {
    title: "市场预筛",
    description: "定义调查目标，获取一批市场商品，由系统整理证据并缩小范围。",
    href: "/opportunities",
    icon: Target,
  },
  {
    title: "任务中心",
    description: "人工决定继续调查哪些，并在后续任务中记录推进状态与复盘。",
    href: "/tasks",
    icon: History,
  },
] as const;

export function HomeDashboardClient() {
  const [accessPassword, setAccessPassword, isAccessPasswordReady] = useAccessPassword();
  const [candidateItems, setCandidateItems] = useState(() => readCandidatePool(null));
  const [recentSingleRun, setRecentSingleRun] = useState(() => parseRecentSingleRun(null));
  const [taskLoad, setTaskLoad] = useState<TaskLoadState>({
    status: "loading",
    summary: null,
    message: "正在读取任务统计。",
  });

  // ── Password input & unlock state ──
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [validating, setValidating] = useState(false);
  const [apiProbeStatus, setApiProbeStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");

  const unlocked = isAccessPasswordReady && accessPassword.trim().length > 0;

  // ── Password submit: validate against server BEFORE saving ──
  async function handlePasswordSubmit() {
    const trimmed = passwordInput.trim();
    if (!trimmed) {
      setPasswordError("请输入访问密码。");
      return;
    }

    setPasswordError("");
    setPasswordInput("");
    setValidating(true);
    setApiProbeStatus("checking");

    try {
      const res = await fetch("/api/tasks?limit=1", {
        headers: { ...buildAccessHeaders() },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setPasswordError("访问密码错误，请重新输入。");
        } else if (res.status === 502 || res.status === 503 || res.status === 504) {
          setPasswordError("服务正在重启或暂时不可用，请稍后再试。");
        } else if (res.status >= 500) {
          setPasswordError("服务异常，请稍后再试。");
        } else {
          setPasswordError("验证失败，请稍后重试。");
        }
        setApiProbeStatus("fail");
        setValidating(false);
        return;
      }

      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setPasswordError("服务返回异常，请稍后重试。");
        setApiProbeStatus("fail");
        setValidating(false);
        return;
      }

      // Server validated — now save to in-memory state
      setAccessPassword(trimmed);
      setApiProbeStatus("ok");
    } catch (err) {
      console.error("密码验证 API 请求异常", err);
      setPasswordError("请求失败，请检查网络连接后重试。");
      setApiProbeStatus("fail");
    } finally {
      setValidating(false);
    }
  }

  useEffect(() => {
    try {
      setCandidateItems(readCandidatePool(window.localStorage));
      setRecentSingleRun(parseRecentSingleRun(window.localStorage.getItem(WORKFLOW_SINGLE_RUN_STORAGE_KEY)));
    } catch {
      setCandidateItems([]);
      setRecentSingleRun(null);
    }
  }, []);

  useEffect(() => {
    if (!isAccessPasswordReady) return;

    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setTaskLoad({ status: "unavailable", summary: null, message: taskFallbackMessage });
      return;
    }

    const controller = new AbortController();

    async function loadTasks() {
      setTaskLoad({ status: "loading", summary: null, message: "正在读取任务统计。" });
      try {
        const response = await fetch("/api/tasks?limit=50", {
          method: "GET",
          headers: { ...buildAccessHeaders() },
          signal: controller.signal,
        });
        if (!response.ok) {
          setTaskLoad({ status: "unavailable", summary: null, message: taskFallbackMessage });
          return;
        }

        const payload = await response.json() as TasksApiResponse;
        if (!payload.ok) {
          setTaskLoad({ status: "unavailable", summary: null, message: taskFallbackMessage });
          return;
        }

        const items = payload.records ?? payload.data?.items ?? [];
        setTaskLoad({
          status: "ready",
          summary: summarizeTaskFollowUp(items),
          message: "已读取本地任务统计。",
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTaskLoad({ status: "unavailable", summary: null, message: taskFallbackMessage });
      }
    }

    void loadTasks();

    return () => controller.abort();
  }, [accessPassword, isAccessPasswordReady]);

  const candidateSummary = useMemo(() => summarizeCandidatePool(candidateItems), [candidateItems]);
  const taskSummary = taskLoad.summary;
  const recommendation = useMemo(() => getRecommendedNextAction({
    candidatePool: candidateSummary,
    tasks: taskSummary,
    recentSingleRun,
  }), [candidateSummary, taskSummary, recentSingleRun]);

  const isNewUser = candidateSummary.total === 0 && !recentSingleRun && (!taskSummary || taskSummary.total === 0);

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8" data-testid="home-dashboard">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-5">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Qingxuan Agent Alpha</p>
                <h1 className="mt-2 max-w-3xl text-2xl font-semibold text-slate-950 sm:text-3xl">
                  轻选 Agent 工作台
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  轻选 Agent 以市场证据为起点，先缩小调查范围，再由人工决定是否继续推进。
                </p>
              </div>
              <span className="linear-pill linear-pill-brand px-3 py-1 text-sm">受控自动化 · 人工确认</span>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* ── Access password entry (only on home page) ── */}
          {!unlocked ? (
            <section className="surface-card border-amber-200 bg-amber-50/60 p-5 sm:p-6" data-testid="home-password-entry">
              <div className="flex items-start gap-3">
                <div className="linear-icon size-10 shrink-0 rounded-xl bg-amber-100 text-amber-700">
                  <Lock className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-slate-900">输入访问密码解锁工作台</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    全站只需要在这里输入一次访问密码。输入后本会话内所有功能可用，无需在其他页面重复输入。
                  </p>
                  <form
                    className="mt-4 flex flex-wrap items-center gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handlePasswordSubmit();
                    }}
                  >
                    <input
                      type="password"
                      value={passwordInput}
                      onChange={(e) => {
                        setPasswordInput(e.target.value);
                        setPasswordError("");
                      }}
                      placeholder="输入访问密码"
                      disabled={validating}
                      className="h-11 w-full max-w-xs rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
                      data-testid="home-password-input"
                    />
                    <button
                      type="submit"
                      disabled={validating}
                      className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="home-password-submit"
                    >
                      {validating ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          验证中…
                        </>
                      ) : (
                        <>
                          解锁工作台
                          <Unlock className="size-4" />
                        </>
                      )}
                    </button>
                  </form>
                  {passwordError ? (
                    <p className="mt-3 text-sm font-semibold text-rose-600" data-testid="home-password-error">
                      {passwordError}
                    </p>
                  ) : null}
                  {isAccessPasswordReady && !accessPassword.trim() && passwordError ? null : null}
                  <p className="mt-3 text-xs text-slate-400">
                    访问保护 · 密码仅保存在当前会话中 · 关闭网页后需重新输入 · 不收集个人信息
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {/* ── Session status (compact) ── */}
          {unlocked ? (
            <section className="surface-card border-emerald-200 bg-emerald-50/60 p-3 sm:p-4" data-testid="home-unlock-status">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  工作台已解锁 · 会话有效
                </div>
                <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  <div className="size-1.5 rounded-full bg-emerald-400" />
                  API{apiProbeStatus === "ok" ? " 已通过" : apiProbeStatus === "checking" ? " 检测中…" : " 待确认"}
                </div>
              </div>
              {apiProbeStatus === "fail" && (
                <p className="mt-2 text-xs text-amber-700">API 鉴权未确认，受保护接口可能返回 401。</p>
              )}
            </section>
          ) : null}

          <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <div className="grid min-w-0 gap-4 md:grid-cols-3">
              <StatCard
                title="候选池"
                value={formatNumber(candidateSummary.total)}
                description={`值得深挖 ${formatNumber(candidateSummary.worthAnalyzing)} 个，暂缓/高风险 ${formatNumber(candidateSummary.pausedOrHighRisk)} 个。`}
                href="/opportunities"
                cta="进入候选池"
              />
              <StatCard
                title="任务跟进"
                value={taskSummary ? formatNumber(taskSummary.total) : "—"}
                description={taskSummary
                  ? `待复核 ${formatNumber(taskSummary.pendingReview)} 个，可跟进 ${formatNumber(taskSummary.followable)} 个。`
                  : taskLoad.message}
                href="/tasks"
                cta="进入任务中心"
                tone={taskSummary ? "indigo" : "slate"}
              />
              <StatCard
                title="最近分析"
                value={recentSingleRun?.productName || "暂无"}
                description={recentSingleRun
                  ? `${formatRecentTime(recentSingleRun.completedAt)} · ${recentSingleRun.savedTaskId ? "已保存到任务中心" : "尚未保存"}`
                  : "还没有可恢复的单品分析结果。"}
                href="/agent/run"
                cta="高级临时分析"
                tone={recentSingleRun?.savedTaskId ? "teal" : "amber"}
              />
            </div>

            <aside className="surface-card-strong min-w-0 p-5" data-testid="dashboard-recommendation">
              <div className="flex items-center gap-2">
                <div className="linear-icon size-9 rounded-xl">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-teal-700">推荐下一步</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">{recommendation.title}</h2>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-500">{recommendation.description}</p>
              <Link href={recommendation.href} className="linear-button-primary mt-5 inline-flex h-11 w-full items-center justify-center gap-2 px-4 text-sm font-semibold">
                {recommendation.cta}
                <ArrowRight className="size-4" />
              </Link>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                本页只读取浏览器本地状态和任务列表，不自动采购、不自动上架、不自动投广告。
              </p>
            </aside>
          </section>

          {isNewUser ? (
            <section className="surface-card p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="linear-kicker">新手三步开始</p>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">没产品时，先把候选池建起来</h2>
                </div>
                <Link href="/opportunities" className="linear-button-primary inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold">
                  开始市场预筛
                  <ArrowRight className="size-4" />
                </Link>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                {[
                  "定义调查目标",
                  "获取一批市场商品",
                  "系统整理证据并缩小范围",
                  "人工决定继续调查哪些",
                ].map((item, index) => (
                  <div key={item} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold text-teal-700">第 {index + 1} 步</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{item}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="surface-card p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Route className="size-5 text-teal-700" />
              <h2 className="text-xl font-semibold text-slate-950">三步主路径</h2>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {workflowSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <Link
                    key={step.href}
                    href={step.href}
                    className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-teal-200 hover:bg-teal-50/40"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="linear-icon size-9 rounded-xl">
                        <Icon className="size-5" />
                      </div>
                      <span className="text-xs font-semibold text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-slate-950">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{step.description}</p>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-sm leading-6 text-slate-500">
            <div className="flex gap-2">
              <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-teal-700" />
              <p>
                当前为人工复核版：采购、上架、联系供应商、投广告等动作都需要你人工确认后手动执行。
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
