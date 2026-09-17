"use client";

import React, { useState } from "react";
import type { ProductDevelopmentBrief, BriefEvidenceSignal } from "@/lib/productDevelopmentBrief";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Sparkles,
  ShoppingBag,
  Factory,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Target,
  Wrench,
  ListTodo,
} from "lucide-react";

export type ProductDevelopmentBriefCardProps = {
  brief: ProductDevelopmentBrief;
  compact?: boolean;
  className?: string;
};

export function ProductDevelopmentBriefCard({
  brief,
  compact = false,
  className = "",
}: ProductDevelopmentBriefCardProps) {
  const [expandedDetails, setExpandedDetails] = useState(false);

  const getRecommendationIcon = () => {
    switch (brief.recommendation) {
      case "promote":
        return <Sparkles className="size-5 text-emerald-600 shrink-0" />;
      case "abandon":
        return <XCircle className="size-5 text-rose-600 shrink-0" />;
      case "validate_first":
      default:
        return <AlertTriangle className="size-5 text-amber-600 shrink-0" />;
    }
  };

  const getStatusBadge = (status: "positive" | "caution" | "negative" | "unknown", label: string) => {
    switch (status) {
      case "positive":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="size-3.5" />
            {label}
          </span>
        );
      case "negative":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
            <ShieldAlert className="size-3.5" />
            {label}
          </span>
        );
      case "caution":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            <AlertTriangle className="size-3.5" />
            {label}
          </span>
        );
      case "unknown":
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
            <HelpCircle className="size-3.5" />
            {label}
          </span>
        );
    }
  };

  const renderSignalTag = (sig: BriefEvidenceSignal, idx: number) => {
    let toneClasses = "border-slate-200 bg-slate-50 text-slate-700";
    if (sig.sourceType === "amazon") {
      toneClasses = "border-sky-200 bg-sky-50 text-sky-800";
    } else if (sig.sourceType === "voc") {
      toneClasses = "border-amber-200 bg-amber-50 text-amber-900";
    } else if (sig.sourceType === "sourcing") {
      toneClasses = "border-indigo-200 bg-indigo-50 text-indigo-900";
    } else if (sig.sourceType === "risk") {
      toneClasses = sig.level === "danger"
        ? "border-rose-200 bg-rose-50 text-rose-800 font-semibold"
        : "border-orange-200 bg-orange-50 text-orange-900";
    }

    return (
      <span
        key={`${sig.evidenceRef}-${idx}`}
        title={`${sig.text} (${sig.evidenceRef})`}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${toneClasses}`}
      >
        <span className="font-semibold opacity-75">[{sig.tagLabel}]</span>
        <span className="truncate max-w-[200px]">{sig.text}</span>
      </span>
    );
  };

  return (
    <section
      data-testid="product-development-brief-card"
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden ${className}`}
      aria-label="商品开发决策卡"
    >
      {/* ── 顶部 Hero 决策区 ── */}
      <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50/80 via-white to-slate-50/50 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-teal-600 text-white shadow-sm">
              <Target className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight text-slate-900">
                  商品开发决策卡
                </h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                  Product Brief
                </span>
              </div>
              <p className="text-xs text-slate-500">
                综合市场需求、VOC 买家痛点、1688 供应链与合规防线快速研判
              </p>
            </div>
          </div>

          {/* 决策结论徽标 */}
          <div
            className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-1.5 text-sm font-bold shadow-xs ${brief.recommendationTone}`}
          >
            {getRecommendationIcon()}
            <span>{brief.recommendationLabel}</span>
          </div>
        </div>

        {/* 30 秒一句话结论 */}
        <div className="mt-4 rounded-xl border border-slate-200/80 bg-white/90 p-4 shadow-xs">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 text-teal-600 shrink-0">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                核心开发结论
              </p>
              <p className="mt-0.5 text-sm sm:text-base font-bold text-slate-900 leading-relaxed">
                {brief.headline}
              </p>
            </div>
          </div>
        </div>

        {/* 证据链准备度条 */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-slate-700">证据链核验：</span>
            <span
              className={`inline-flex items-center gap-1 ${
                brief.evidenceReadiness.amazon ? "text-emerald-700 font-medium" : "text-slate-400"
              }`}
            >
              {brief.evidenceReadiness.amazon ? "✓" : "○"} Amazon页面
            </span>
            <span
              className={`inline-flex items-center gap-1 ${
                brief.evidenceReadiness.voc ? "text-emerald-700 font-medium" : "text-slate-400"
              }`}
            >
              {brief.evidenceReadiness.voc ? "✓" : "○"} 买家VOC痛点
            </span>
            <span
              className={`inline-flex items-center gap-1 ${
                brief.evidenceReadiness.sourcing ? "text-emerald-700 font-medium" : "text-slate-400"
              }`}
            >
              {brief.evidenceReadiness.sourcing ? "✓" : "○"} 1688货源报价
            </span>
            <span
              className={`inline-flex items-center gap-1 ${
                brief.evidenceReadiness.risk ? "text-emerald-700 font-medium" : "text-slate-400"
              }`}
            >
              {brief.evidenceReadiness.risk ? "✓" : "○"} 合规风控排查
            </span>
          </div>

          <span className="font-medium text-slate-500">
            {brief.evidenceReadiness.readinessLabel}
          </span>
        </div>

        {brief.isFallback && (
          <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
            ⚠️ 当前商品暂无已保存的采集证据，以上内容基于通用行业规则与基础推导。建议补充 Amazon 与 1688 证据以获得更精准的决策支撑。
          </div>
        )}
      </div>

      {/* ── 三大决策依据板块 ── */}
      <div className="p-4 sm:p-6 grid gap-4 lg:grid-cols-3">
        {/* 1. 市场需求与 VOC */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/40 p-4 transition-all hover:bg-slate-50/80">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShoppingBag className="size-4 text-sky-600" />
                <h4 className="text-sm font-bold text-slate-900">{brief.basis.market.title}</h4>
              </div>
              {getStatusBadge(brief.basis.market.status, brief.basis.market.statusLabel)}
            </div>
            <p className="mt-2.5 text-xs text-slate-600 leading-relaxed">
              {brief.basis.market.summary}
            </p>
          </div>

          {brief.basis.market.signals.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200/60 flex flex-wrap gap-1.5">
              {brief.basis.market.signals.slice(0, 3).map((sig, idx) => renderSignalTag(sig, idx))}
            </div>
          )}
        </div>

        {/* 2. 供应链与利润 */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/40 p-4 transition-all hover:bg-slate-50/80">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Factory className="size-4 text-indigo-600" />
                <h4 className="text-sm font-bold text-slate-900">{brief.basis.sourcing.title}</h4>
              </div>
              {getStatusBadge(brief.basis.sourcing.status, brief.basis.sourcing.statusLabel)}
            </div>
            <p className="mt-2.5 text-xs text-slate-600 leading-relaxed">
              {brief.basis.sourcing.summary}
            </p>
          </div>

          {brief.basis.sourcing.signals.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200/60 flex flex-wrap gap-1.5">
              {brief.basis.sourcing.signals.slice(0, 3).map((sig, idx) => renderSignalTag(sig, idx))}
            </div>
          )}
        </div>

        {/* 3. 合规门槛与风控 */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/40 p-4 transition-all hover:bg-slate-50/80">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-teal-600" />
                <h4 className="text-sm font-bold text-slate-900">{brief.basis.risk.title}</h4>
              </div>
              {getStatusBadge(brief.basis.risk.status, brief.basis.risk.statusLabel)}
            </div>
            <p className="mt-2.5 text-xs text-slate-600 leading-relaxed">
              {brief.basis.risk.summary}
            </p>
          </div>

          {brief.basis.risk.signals.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200/60 flex flex-wrap gap-1.5">
              {brief.basis.risk.signals.slice(0, 3).map((sig, idx) => renderSignalTag(sig, idx))}
            </div>
          )}
        </div>
      </div>

      {/* ── 针对开发团队的实操建议（Actionable Advice） ── */}
      {!compact && (
        <div className="border-t border-slate-100 bg-white p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <FileCheck2 className="size-4 text-teal-600" />
              商品开发实操指引与验货清单
            </h4>
            <button
              type="button"
              onClick={() => setExpandedDetails(!expandedDetails)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
            >
              {expandedDetails ? (
                <>
                  收起细节 <ChevronUp className="size-3.5" />
                </>
              ) : (
                <>
                  展开详情 <ChevronDown className="size-3.5" />
                </>
              )}
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {/* 目标人群 */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/30 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Target className="size-3.5 text-teal-600" />
                目标客群与应用场景
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                {brief.advice.targetAudience}
              </p>
            </div>

            {/* 差异化卖点 / VOC 痛点攻克 */}
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/30 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                <Wrench className="size-3.5 text-amber-600" />
                差异化改良方向（基于买家痛点）
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-900">
                {brief.advice.keyDifferentiator}
              </p>
            </div>
          </div>

          {/* 展开的验货清单与下一步 */}
          {expandedDetails && (
            <div className="mt-4 pt-4 border-t border-slate-100 grid gap-4 md:grid-cols-2">
              {/* 与 1688 供应商沟通清单 */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Factory className="size-3.5 text-indigo-600" />
                  工厂打样与洽谈核验清单
                </p>
                <ul className="mt-2.5 space-y-1.5 text-xs text-slate-600">
                  {brief.advice.supplierCheckpoints.map((cp, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-bold text-teal-700 shrink-0">{idx + 1}.</span>
                      <span>{cp}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 下一步行动 */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <ListTodo className="size-3.5 text-teal-600" />
                  推荐下一步动作
                </p>
                <ul className="mt-2.5 space-y-1.5 text-xs text-slate-600">
                  {brief.advice.nextSteps.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-bold text-teal-700 shrink-0">{idx + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
