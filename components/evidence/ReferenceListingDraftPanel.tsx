"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type {
  ReferenceDraftReadiness,
  ReferenceMaterialItem,
  ExcludedMaterialItem,
} from "@/lib/referenceListingDraft/referenceDraftContract";

export function ReferenceListingDraftPanel({
  taskId,
  onDraftGenerated,
}: {
  taskId: string;
  onDraftGenerated?: () => void;
}) {
  const reqSeqRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [readiness, setReadiness] = useState<ReferenceDraftReadiness | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    const currentSeq = ++reqSeqRef.current;
    setLoading(true);
    setErrorMsg(null);
    setReadiness(null);

    fetch(`/api/tasks/${encodeURIComponent(taskId)}/reference-listing-draft`, {
      signal: AbortSignal.timeout(15_000),
    })
      .then(async (res) => {
        const json = await res.json();
        return { status: res.status, ok: res.ok, json };
      })
      .then(({ status, ok, json }) => {
        if (currentSeq !== reqSeqRef.current) return;
        if (!ok || !json.ok || !json.data) {
          setErrorMsg(json.error?.message || `读取资料准备情况失败 (${status})。`);
          return;
        }
        setReadiness(json.data as ReferenceDraftReadiness);
      })
      .catch((err) => {
        if (currentSeq !== reqSeqRef.current) return;
        console.error("[listing-preparation-summary] fetch error", err);
        setErrorMsg("网络异常或服务不可用，请稍后刷新重试。");
      })
      .finally(() => {
        if (currentSeq === reqSeqRef.current) {
          setLoading(false);
        }
      });
  }, [taskId]);

  return (
    <section
      id="listing-preparation-summary"
      data-testid="listing-preparation-summary"
      className="mt-6 rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50/60 via-white to-white p-5 shadow-sm"
      aria-label="创作资料交接"
    >
      {/* 标题栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              下一步
            </span>
            <h3 className="text-base font-bold text-slate-900">创作资料交接</h3>
            {readiness?.status === "ready" ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                ✓ 已具备创作条件
              </span>
            ) : (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                资料不足 · 待补充
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-600">
            梳理当前商品已确认事实与多维创作资料，安全交接至文案工作台与图片工作台。
          </p>
        </div>
      </div>

      {/* 紧凑摘要与统计 */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-700">
        {loading ? (
          <p className="text-slate-400">正在检查创作资料准备度...</p>
        ) : errorMsg ? (
          <p className="text-rose-600 font-medium">❌ {errorMsg}</p>
        ) : readiness ? (() => {
          const adoptedMaterials = Array.isArray(readiness.adoptedMaterials) ? readiness.adoptedMaterials : [];
          const excludedMaterials = Array.isArray(readiness.excludedMaterials) ? readiness.excludedMaterials : [];
          const adoptedCount = typeof readiness.adoptedCount === "number" ? readiness.adoptedCount : adoptedMaterials.length;
          const excludedCount = typeof readiness.excludedCount === "number" ? readiness.excludedCount : excludedMaterials.length;
          const totalCount = adoptedCount + excludedCount;
          const referenceStats = readiness.referenceStats ?? {
            keywordCount: 0,
            vocCount: 0,
            competitorCount: 0,
            hasSourcing: false,
          };

          return (
            <div>
              {/* 5 维度紧凑摘要卡片 */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                {/* 1. 商品事实 */}
                <div className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-2xs">
                  <span className="text-[11px] font-medium text-slate-500">商品事实</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <strong className="text-base font-bold text-emerald-700" data-testid="adopted-count">
                      {adoptedCount}
                    </strong>
                    <span className="text-xs text-slate-600">项已确认</span>
                  </div>
                </div>

                {/* 2. 关键词 */}
                <div className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-2xs">
                  <span className="text-[11px] font-medium text-slate-500">关键词</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <strong className="text-base font-bold text-indigo-700">
                      {referenceStats.keywordCount}
                    </strong>
                    <span className="text-xs text-slate-600">个可参考</span>
                  </div>
                </div>

                {/* 3. 买家声音 */}
                <div className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-2xs">
                  <span className="text-[11px] font-medium text-slate-500">买家声音</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <strong className="text-base font-bold text-amber-700">
                      {referenceStats.vocCount}
                    </strong>
                    <span className="text-xs text-slate-600">条可参考</span>
                  </div>
                </div>

                {/* 4. 竞品观察 */}
                <div className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-2xs">
                  <span className="text-[11px] font-medium text-slate-500">竞品观察</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <strong className="text-base font-bold text-sky-700">
                      {referenceStats.competitorCount}
                    </strong>
                    <span className="text-xs text-slate-600">条可参考</span>
                  </div>
                </div>

                {/* 5. 供应链 */}
                <div className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-2xs">
                  <span className="text-[11px] font-medium text-slate-500">供应链</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className={`text-xs font-semibold ${referenceStats.hasSourcing ? "text-slate-700" : "text-slate-400"}`}>
                      {referenceStats.hasSourcing ? "仅作采购参考" : "未提供"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 状态说明与统计 */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/60 pt-2.5 text-[11px] text-slate-500">
                <span>
                  隔离排除：
                  <strong className="text-slate-700 font-semibold ml-1" data-testid="excluded-count">
                    {excludedCount}
                  </strong>{" "}
                  项（市场数据、未确认声明及外部背景）
                </span>
                {readiness.status === "ready" ? (
                  <span className="text-emerald-700 font-medium">✓ 已具备创作条件，可进入文案与图片工作台</span>
                ) : null}
              </div>

              {/* 仅有基础身份信息，无实质规格时的提示 */}
              {readiness.status === "insufficient" ? (
                <p className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/80 p-2.5 text-xs text-amber-800 font-medium" data-testid="insufficient-warning">
                  ⚠️ 当前仅整理出基础身份信息，暂无足够的实质规格资料，尚不足以支撑完整 Listing 准备。
                </p>
              ) : null}

              {/* 操作按钮组 */}
              <div className="mt-3.5 flex flex-wrap items-center gap-3">
                <Link
                  href={`/listing-studio?taskId=${encodeURIComponent(taskId)}`}
                  className="linear-button inline-flex h-8 items-center justify-center px-4 text-xs font-semibold"
                  data-testid="goto-listing-studio-btn"
                >
                  进入文案工作台
                </Link>
                <button
                  type="button"
                  onClick={() => setDetailsOpen(!detailsOpen)}
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer"
                >
                  {detailsOpen ? "收起资料详情" : `查看资料详情（共 ${totalCount} 项）`}
                </button>
                <span className="text-[11px] text-slate-500">
                  文案生成将严格以已确认事实为准，买家声音与竞品仅作为场景与差异化参考
                </span>
              </div>

              {/* 查看资料详情展开区（3 层清晰划分） */}
              <details
                open={detailsOpen}
                onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
                className="mt-4 border-t border-slate-200/60 pt-3 text-slate-600"
                data-testid="listing-prep-details"
              >
                <summary className="cursor-pointer text-xs font-semibold text-indigo-700 hover:text-indigo-800 select-none">
                  {detailsOpen ? "收起创作资料三层清单" : `查看资料详情（共 ${totalCount} 项）`}
                </summary>
                <div className="mt-3 space-y-3.5">
                  {/* ① 可直接用于文案的商品事实 */}
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-emerald-900 text-xs">
                        ① 可直接用于文案的商品事实（{adoptedCount} 项已确认）
                      </h4>
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                        硬事实 · 决定商品本身规格与外观
                      </span>
                    </div>
                    {adoptedMaterials.length > 0 ? (
                      <ul className="mt-2.5 grid gap-2 sm:grid-cols-2" data-testid="adopted-materials-list">
                        {adoptedMaterials.map((item: ReferenceMaterialItem, idx: number) => (
                          <li key={item.id || idx} className="rounded-lg border border-emerald-100 bg-white/90 p-2 text-xs text-slate-800 flex items-start gap-2 shadow-2xs">
                            <span className="text-emerald-600 font-bold shrink-0 mt-0.5">✓</span>
                            <div className="min-w-0">
                              <span className="font-semibold text-emerald-950">{item.label}：</span>
                              <span className="font-medium text-slate-900">{item.value}</span>
                              <div className="mt-0.5 text-[10px] text-slate-500">来源：{item.sourceLabel}</div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-emerald-700">暂无可采用的基础规格。</p>
                    )}
                  </div>

                  {/* ② 仅用于创作参考 */}
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3.5">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-indigo-900 text-xs">
                        ② 仅用于创作参考（场景、词意与竞品观察）
                      </h4>
                      <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                        软资料 · 仅供拓展场景与差异化，禁止作为商品硬事实
                      </span>
                    </div>
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg border border-indigo-100 bg-white/90 p-2.5 shadow-2xs">
                        <span className="text-xs font-bold text-indigo-950">关键词证据</span>
                        <div className="mt-1 text-xs text-slate-700">
                          {referenceStats.keywordCount > 0 ? (
                            <span>已整理 <strong className="text-indigo-700">{referenceStats.keywordCount}</strong> 个高频/蓝海关键词，供文案与 SEO 埋词参考。</span>
                          ) : (
                            <span className="text-slate-400">暂无已采集关键词。</span>
                          )}
                        </div>
                        <div className="mt-1 text-[10px] text-indigo-600">用途：搜索意图与词意覆盖</div>
                      </div>
                      <div className="rounded-lg border border-amber-100 bg-white/90 p-2.5 shadow-2xs">
                        <span className="text-xs font-bold text-amber-950">买家声音 (VOC)</span>
                        <div className="mt-1 text-xs text-slate-700">
                          {referenceStats.vocCount > 0 ? (
                            <span>已分析 <strong className="text-amber-700">{referenceStats.vocCount}</strong> 条买家评论与痛点，供生成真实使用场景与卖点。</span>
                          ) : (
                            <span className="text-slate-400">暂无买家评论记录。</span>
                          )}
                        </div>
                        <div className="mt-1 text-[10px] text-amber-700">用途：痛点关注与使用情境</div>
                      </div>
                      <div className="rounded-lg border border-sky-100 bg-white/90 p-2.5 shadow-2xs">
                        <span className="text-xs font-bold text-sky-950">竞品观察</span>
                        <div className="mt-1 text-xs text-slate-700">
                          {referenceStats.competitorCount > 0 ? (
                            <span>已观测 <strong className="text-sky-700">{referenceStats.competitorCount}</strong> 款竞品表现，供提炼差异化优势。</span>
                          ) : (
                            <span className="text-slate-400">暂无竞品观察记录。</span>
                          )}
                        </div>
                        <div className="mt-1 text-[10px] text-sky-700">用途：视觉差异化与避坑参考</div>
                      </div>
                    </div>
                  </div>

                  {/* ③ 不进入当前文案 */}
                  <div className="rounded-xl border border-slate-200 bg-slate-100/70 p-3.5">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-800 text-xs">
                        ③ 不进入当前文案（{excludedCount} 项隔离）
                      </h4>
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        安全隔离 · 市场数据/未核实声明/采购线索
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      以下项目按安全规则与防作弊机制排除，不作为文案生成的事实依据：
                    </p>
                    {excludedMaterials.length > 0 ? (
                      <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2" data-testid="excluded-materials-list">
                        {excludedMaterials.map((item: ExcludedMaterialItem, idx: number) => (
                          <li key={idx} className="rounded-lg border border-slate-200 bg-white/80 p-2 text-xs text-slate-700 flex items-start gap-2">
                            <span className="text-amber-500 font-bold shrink-0 mt-0.5">✕</span>
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-1.5 flex-wrap">
                                <span className="font-semibold text-slate-900">{item.label || item.field}</span>
                                {item.value ? <span className="text-[11px] text-slate-500 truncate max-w-[200px]">({item.value})</span> : null}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-600">{item.reason}</div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">无排除隔离项。</p>
                    )}
                  </div>
                </div>
              </details>
            </div>
          );
        })() : (
          <p className="text-slate-400">暂无资料交接状态</p>
        )}
      </div>
    </section>
  );
}

export { ReferenceListingDraftPanel as ListingPreparationSummary };

