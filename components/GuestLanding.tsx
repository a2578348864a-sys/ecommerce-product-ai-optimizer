"use client";

/**
 * V4.1 — Public Showcase 首屏（契约 §1.B）。
 *
 * 首屏 V4 定位 + 模式 Badge（Public Replay · 只读脱敏案例）+ 主 CTA「查看真实脱敏案例」→ /replay；
 * 下方依次为 Workflow / 价值卡 / Featured Replay / 产品边界区；
 * 金标演示保留为「现有内容工具」区（原 POST /api/auth/guest + /api/demo/golden 逻辑不变，降级为非首屏）。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { saveGuestAccess, type DemoAccessInfo } from "@/lib/client/accessToken";
import { V4Workflow } from "@/components/v4/home/V4Workflow";
import { V4ValueCards } from "@/components/v4/home/V4ValueCards";
import { V4FeaturedReplayCard } from "@/components/v4/home/V4FeaturedReplayCard";
import { V4BoundaryNotice } from "@/components/v4/home/V4BoundaryNotice";
import type { FeaturedReplay, HomeRuntime } from "@/components/v4/home/heroLogic";

export function GuestLanding({ runtime, featured }: { runtime: HomeRuntime; featured: FeaturedReplay | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleStart() {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error?.message || "进入演示失败，请稍后重试。");
        setLoading(false);
        return;
      }
      // 轻量会话标记（无 token；token 在 HttpOnly Cookie）
      saveGuestAccess(json.demoAccess as DemoAccessInfo);
      try {
        const goldenRes = await fetch("/api/demo/golden", { method: "GET", cache: "no-store" });
        const golden = await goldenRes.json().catch(() => null);
        if (golden?.ok && golden?.data?.taskId) {
          router.push("/tasks/" + golden.data.taskId);
          return;
        }
      } catch {
        // fall through to home
      }
      router.push("/");
    } catch (err) {
      console.error("guest start failed", err);
      setError("进入演示失败，请检查网络后重试。");
      setLoading(false);
    }
  }

  return (
    <div className="login-page-root">
      <div className="login-bg" />
      <div className="login-grid" />

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 py-6 sm:px-6">
        <section className="login-product-intro" aria-labelledby="guest-title">
          <div className="flex flex-wrap items-center gap-3">
            <div className="login-brand-icon">
              <Sparkles className="size-7" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">轻选工作台</p>
              <p className="mt-1 text-xs text-slate-500">AI 跨境商品研究与上架准备</p>
            </div>
            <span
              data-testid="guest-mode-badge"
              className="ml-auto inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600"
            >
              Public Replay · 只读脱敏案例
            </span>
          </div>

          <h1
            id="guest-title"
            aria-label="AI 跨境商品研究与上架准备工作台"
            className="mt-7 max-w-2xl break-words text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-slate-950 sm:text-5xl"
          >
            AI 跨境商品研究与上架准备工作台
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
            从市场机会、证据、产品事实到 Listing / Image；AI 完成研究，人做关键决策。
          </p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            这里是公开只读展示：不预测爆款，不承诺盈利，不自动采购或上架。
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/replay"
              data-testid="guest-primary-cta"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 px-5 text-sm font-semibold text-white shadow-sm shadow-teal-200 transition hover:from-teal-600 hover:to-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              查看真实脱敏案例
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a
              href="#workflow"
              data-testid="guest-secondary-cta"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-teal-200 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            >
              了解研究流程
            </a>
          </div>
        </section>

        <V4Workflow />
        <V4ValueCards />
        <V4FeaturedReplayCard featured={featured} />
        <V4BoundaryNotice runtime={runtime} />

        <section
          className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
          aria-labelledby="guest-tools-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="linear-kicker">现有内容工具</p>
              <h2 id="guest-tools-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                金标演示 · 完整研究案例回放
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                无需密码、无需注册：一键进入 THERMOS 金标演示，查看采集证据、VOC 分析、
                研究结论与 Listing / Image 创作全流程。演示回放不消耗额度。
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-teal-300 bg-teal-50 px-4 text-sm font-semibold text-teal-700 transition hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
              onClick={handleStart}
              disabled={loading}
              data-testid="guest-start-button"
            >
              {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {loading ? "正在进入…" : "体验金标演示"}
              {!loading ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
            </button>
          </div>

          {error ? (
            <p className="mt-3 text-sm text-rose-600" role="alert" data-testid="guest-start-error">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-400">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-500" aria-hidden="true" />
            <span>
              演示数据为历史采集样本回放；本模式不支持新建商品研究、实时采集或外部导入，也不消耗访客额度。
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
