"use client";

/**
 * V3.1 Phase 1 — Public Showcase Landing（契约 01-4 / §12 / §40）
 * 无密码、无注册、无访客码；一键 POST /api/auth/guest → HttpOnly Cookie → 金标演示。
 * GET / 本身不创建任何 guest / sandbox / quota（只有点击按钮才 POST）。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { saveGuestAccess, type DemoAccessInfo } from "@/lib/client/accessToken";

export function GuestLanding() {
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
      // 惰性 seed 金标演示副本并直达演示任务（Evidence / Listing / Image 历史）
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

      <main className="login-main">
        <section className="login-product-intro" aria-labelledby="guest-title">
          <div className="flex items-center gap-3">
            <div className="login-brand-icon">
              <Sparkles className="size-7" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">轻选工作台</p>
              <p className="mt-1 text-xs text-slate-500">跨境商品研究与内容准备</p>
            </div>
          </div>

          <h1
            id="guest-title"
            aria-label="3 分钟体验真实商品研究案例"
            className="mt-7 max-w-2xl break-words text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-slate-950 sm:text-5xl"
          >
            <span className="block lg:inline">3 分钟体验</span>{" "}
            <span className="block lg:inline">真实商品研究案例</span>
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
            无需密码、无需注册：一键进入 THERMOS 金标演示，查看采集证据、VOC 分析、
            研究结论与 Listing / Image 创作全流程。
          </p>

          <ol className="login-product-journey" aria-label="演示流程">
            {[
              { number: "01", label: "金标演示", description: "完整研究案例回放", icon: Eye },
              { number: "02", label: "证据与结论", description: "采集 / VOC / 供应证据", icon: Search },
              { number: "03", label: "Listing", description: "已确认事实的文案草稿", icon: CheckCircle2 },
              { number: "04", label: "Image", description: "商品图片候选历史", icon: ShieldCheck },
            ].map((step) => {
              const Icon = step.icon;
              return (
                <li key={step.number} className="login-step">
                  <span className="login-step-number">{step.number}</span>
                  <div>
                    <p className="login-step-label">{step.label}</p>
                    <p className="login-step-desc">{step.description}</p>
                  </div>
                  <Icon className="ml-auto size-4 text-teal-600" aria-hidden="true" />
                </li>
              );
            })}
          </ol>
        </section>

        <section className="login-panel" aria-label="进入演示">
          <div className="login-card">
            <div className="login-card-icon">
              <Sparkles className="size-5" aria-hidden="true" />
            </div>
            <h2 className="login-card-title">公开演示体验</h2>
            <p className="login-card-desc">访客身份由浏览器安全 Cookie 自动建立，无需任何密码。</p>

            <button
              type="button"
              className="linear-button mt-5 inline-flex h-11 w-full items-center justify-center gap-2 px-4 text-sm font-semibold"
              onClick={handleStart}
              disabled={loading}
              data-testid="guest-start-button"
            >
              {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {loading ? "正在进入…" : "3分钟体验真实商品研究案例"}
              {!loading ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
            </button>

            {error ? (
              <p className="mt-3 text-sm text-rose-600" role="alert" data-testid="guest-start-error">
                {error}
              </p>
            ) : null}

            <p className="mt-4 text-xs leading-5 text-slate-400">
              演示数据为历史采集样本回放；本模式不支持新建商品研究、实时采集或外部导入。
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}