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
    >
      {/* 标题栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              下一步
            </span>
            <h3 className="text-base font-bold text-slate-900">Listing 准备情况</h3>
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
              资料整理分析 · 待人工复核
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            梳理当前商品已保存的规格与背景资料，辅助评估是否可以进入正式 Listing 创作。
          </p>
        </div>
      </div>

      {/* 状态与统计 */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-700">
        {loading ? (
          <p className="text-slate-400">正在检查现有资料准备度...</p>
        ) : errorMsg ? (
          <p className="text-rose-600 font-medium">❌ {errorMsg}</p>
        ) : readiness ? (() => {
          const adoptedMaterials = Array.isArray(readiness.adoptedMaterials) ? readiness.adoptedMaterials : [];
          const excludedMaterials = Array.isArray(readiness.excludedMaterials) ? readiness.excludedMaterials : [];
          const adoptedCount = typeof readiness.adoptedCount === "number" ? readiness.adoptedCount : adoptedMaterials.length;
          const excludedCount = typeof readiness.excludedCount === "number" ? readiness.excludedCount : excludedMaterials.length;
          const totalCount = adoptedCount + excludedCount;

          return (
            <div>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-semibold text-slate-900">当前已整理：</span>
                <span>
                  可用于 Listing 准备：
                  <strong className="text-emerald-700 font-bold ml-1" data-testid="adopted-count">
                    {adoptedCount}
                  </strong>{" "}
                  项
                </span>
                <span>
                  暂不采用：
                  <strong className="text-slate-600 font-bold ml-1" data-testid="excluded-count">
                    {excludedCount}
                  </strong>{" "}
                  项
                </span>
              </div>

              {/* 仅有基础身份信息，无实质规格时的提示 */}
              {readiness.status === "insufficient" ? (
                <p className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/80 p-2.5 text-xs text-amber-800 font-medium" data-testid="insufficient-warning">
                  ⚠️ 当前仅整理出基础身份信息，暂无足够的实质规格资料，尚不足以支撑完整 Listing 准备。
                </p>
              ) : (
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  当前资料仍需人工复核，正式文案请进入 Listing Studio 完成。
                </p>
              )}

              {/* 现有 Listing Studio 正式入口 */}
              <div className="mt-3.5 flex flex-wrap items-center gap-3">
                <Link
                  href={`/listing-studio?taskId=${encodeURIComponent(taskId)}`}
                  className="linear-button inline-flex h-8 items-center justify-center px-4 text-xs font-semibold"
                  data-testid="goto-listing-studio-btn"
                >
                  进入 Listing Studio
                </Link>
                <span className="text-[11px] text-slate-500">
                  进入正式工作区进行文案创作与多语言适配
                </span>
              </div>

              {/* 查看资料依据折叠区 */}
              <details className="mt-4 border-t border-slate-200/60 pt-3 text-slate-600" data-testid="listing-prep-details">
                <summary className="cursor-pointer text-xs font-semibold text-indigo-700 hover:text-indigo-800 select-none">
                  查看资料依据（共 {totalCount} 项）
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {/* 当前可用于 Listing 准备 */}
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                    <h4 className="font-bold text-emerald-800">
                      可用于 Listing 准备（{adoptedCount} 项）
                    </h4>
                    {adoptedMaterials.length > 0 ? (
                      <ul className="mt-2 space-y-1.5" data-testid="adopted-materials-list">
                        {adoptedMaterials.map((item: ReferenceMaterialItem, idx: number) => (
                          <li key={item.id || idx} className="text-xs text-emerald-950 flex items-start gap-1.5">
                            <span className="text-emerald-600 font-bold shrink-0">✓</span>
                            <div>
                              <span className="font-semibold">{item.label}：</span>
                              <span>{item.value}</span>{" "}
                              <span className="text-[10px] text-emerald-700 font-normal">
                                （来源：{item.sourceLabel}）
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-emerald-700">暂无可采用的基础规格。</p>
                    )}
                  </div>

                  {/* 暂不采用说明 */}
                  <div className="rounded-lg border border-slate-200 bg-slate-100/60 p-3">
                    <h4 className="font-bold text-slate-700">
                      暂不采用（{excludedCount} 项）
                    </h4>
                    {excludedMaterials.length > 0 ? (
                      <ul className="mt-2 space-y-1.5" data-testid="excluded-materials-list">
                        {excludedMaterials.map((item: ExcludedMaterialItem, idx: number) => (
                          <li key={idx} className="text-xs text-slate-700 flex items-start gap-1.5">
                            <span className="text-amber-600 font-bold shrink-0">⚠</span>
                            <div>
                              <span className="font-semibold">{item.label || item.field}：</span>
                              <span>{item.reason}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">无排除项。</p>
                    )}
                  </div>
                </div>
              </details>
            </div>
          );
        })() : (
          <p className="text-slate-400">暂无资料准备状态</p>
        )}
      </div>
    </section>
  );
}

export { ReferenceListingDraftPanel as ListingPreparationSummary };

