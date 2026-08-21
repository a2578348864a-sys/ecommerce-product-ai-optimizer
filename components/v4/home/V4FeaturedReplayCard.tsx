"use client";

/**
 * V4.1 — Featured Replay 选例卡。
 *
 * 只展示服务端 loader 派生的真实 bundle 业务字段（components/v4/replay-featured.ts）：
 * 候选名 / 关键词 / 市场 / 报告结论摘要 / 风险等级 / 缩略图来源；主标题禁用 bundleId(UUID)。
 * 业务字段缺失 → 诚实空态（未记录 / 无缩略图资产）；统计由真实数据派生，禁止硬编码 74/5/11。
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatCount, formatDateTime } from "@/components/v4/labels";
import type { FeaturedReplay } from "./heroLogic";

function Field({ label, value, className }: { label: string; value: string | null; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm leading-6 text-slate-800">{value && value.trim() ? value : "未记录"}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function V4FeaturedReplayCard({ featured }: { featured: FeaturedReplay | null }) {
  return (
    <section
      data-testid="v4-featured-replay"
      aria-labelledby="v4-featured-replay-title"
      className="surface-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
          真实脱敏历史案例回放
        </span>
        <span className="text-xs text-slate-400">仅保留脱敏后的公开信息，供学习参考。</span>
      </div>

      {featured ? (
        <>
          <h2 id="v4-featured-replay-title" className="mt-4 text-xl font-semibold tracking-tight text-slate-950">
            {featured.candidateName && featured.candidateName.trim() ? featured.candidateName : "真实脱敏案例回放"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            回放时点：{formatDateTime(featured.capturedAt)} · 导出于：{formatDateTime(featured.exportedAt)}
          </p>

          {/* 业务字段（真实 bundle 派生；缺失 → 诚实空态） */}
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="报告结论摘要" value={featured.summary} />
            </div>
            <Field label="候选名" value={featured.candidateName} />
            <Field label="关键词" value={featured.keyword} />
            <Field label="市场" value={featured.market} />
            <Field label="风险等级" value={featured.riskLevel} />
          </dl>

          {/* 缩略图来源：仅真实图片引用；无资产 → 空态 */}
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            {featured.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={featured.thumbnail.src}
                alt={featured.thumbnail.alt}
                className="size-14 shrink-0 rounded-lg border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-[10px] font-semibold text-slate-400">
                无缩略图
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">缩略图来源</p>
              <p className="mt-0.5 break-words text-xs leading-5 text-slate-500">
                {featured.thumbnail ? featured.thumbnail.src : "该案例未包含真实图片资产，暂时无可展示缩略图。"}
              </p>
            </div>
          </div>

          {/* 派生统计（真实 bundle 数据） */}
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="时间线步数" value={formatCount(featured.timelineSteps)} />
            <Stat label="人工决策" value={formatCount(featured.humanDecisions)} />
            <Stat label="Content Guard 项" value={formatCount(featured.guardItems)} />
            <Stat label="脱敏字段" value={formatCount(featured.redactionEntries)} />
            <Stat label="Bundle 文件" value={formatCount(featured.filesCount)} />
            <Stat label="完整性校验" value={featured.scanOk ? "通过" : "未通过"} />
          </dl>

          {featured.link ? (
            <p className="mt-3 text-xs text-slate-500">
              链接：<a href={featured.link} className="break-words text-teal-700 underline" rel="noreferrer noopener">{featured.link}</a>
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={"/replay/" + encodeURIComponent(featured.bundleId)}
              data-testid="v4-featured-replay-cta"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 px-5 text-sm font-semibold text-white shadow-sm shadow-teal-200 transition hover:from-teal-600 hover:to-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              查看完整研究回放
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <span className="text-xs text-slate-400">
              bundle v1 · {featured.bundleSha256Short}…（{featured.filesCount} 个文件）
            </span>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm leading-6 text-slate-500">
          暂无可展示的真实脱敏案例回放。案例由导出流程生成并落盘后在此展示。
        </p>
      )}
    </section>
  );
}
