"use client";

/**
 * V4.1 — 首页 Hero（模式感知）。
 *
 * 小标签 Evidence-first · Human-in-the-loop；主标题按契约 §1.A；
 * 副标题与诚实边界按契约；模式 Badge 与 CTA 由 props.runtime 派生（见 heroLogic）。
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { deriveHeroCtas, v4ModeBadgeLabel, type HomeRuntime } from "./heroLogic";

export function V4Hero({ runtime }: { runtime: HomeRuntime }) {
  const badge = v4ModeBadgeLabel(runtime);
  const ctas = deriveHeroCtas(runtime);

  return (
    <section
      data-testid="v4-hero"
      aria-labelledby="v4-hero-title"
      className="surface-card-strong overflow-hidden p-5 sm:p-6 lg:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <p className="linear-kicker">Evidence-first · Human-in-the-loop</p>
          <h1
            id="v4-hero-title"
            className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl"
          >
            AI 跨境商品研究与上架准备工作台
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
            从市场机会、证据、产品事实到 Listing / Image；AI 完成研究，人做关键决策。
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            不预测爆款，不承诺盈利，不自动采购或上架。
          </p>
        </div>
        {badge ? (
          <span
            data-testid="v4-mode-badge"
            className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600"
          >
            {badge}
          </span>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href={ctas.primary.href}
          data-testid="v4-hero-cta-primary"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 px-5 text-sm font-semibold text-white shadow-sm shadow-teal-200 transition hover:from-teal-600 hover:to-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 active:scale-[0.98]"
        >
          {ctas.primary.label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        {ctas.secondary ? (
          <Link
            href={ctas.secondary.href}
            data-testid="v4-hero-cta-secondary"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-teal-200 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
          >
            {ctas.secondary.label}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
