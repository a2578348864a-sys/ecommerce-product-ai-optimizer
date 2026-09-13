"use client";

import {
  type VisualAssetPlan,
  type VisualAssetSlot,
} from "@/lib/imageHandoff/visualAssetPlan";
import { imageStylePresetLabel } from "@/lib/imageStyleLibrary";
import { CheckCircle2, AlertCircle, Sparkles, Layers } from "lucide-react";

export function VisualAssetPlanCard({
  plan,
  selectedSlotId,
  onSelectSlot,
}: {
  plan: VisualAssetPlan;
  selectedSlotId?: string | null;
  onSelectSlot?: (slot: VisualAssetSlot) => void;
}) {
  return (
    <section
      className="rounded-2xl border border-teal-200/80 bg-gradient-to-b from-teal-50/50 to-white p-4 shadow-sm"
      data-testid="visual-asset-plan"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-teal-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              AI 视觉资产规划（Visual Asset Plan）
            </h3>
            <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-[11px] font-bold text-teal-800">
              AI 建议视觉组合
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            根据已确认事实与商品参考图智能推荐的视觉资产矩阵。点击槽位一键填入对应策略并联动 AI 视觉简报。
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                plan.readyCount === plan.totalCount
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-teal-200 bg-teal-50 text-teal-700"
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                就绪进度 {plan.readyCount} / {plan.totalCount} 项
              </span>
            </span>
          </div>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-200/70">
            <div
              className="h-full rounded-full bg-teal-600 transition-all duration-300"
              style={{ width: `${Math.round((plan.readyCount / plan.totalCount) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-teal-100/80 bg-white/90 px-3 py-1.5 text-xs text-slate-600 shadow-2xs">
        <span className="font-bold text-teal-800 shrink-0">视觉组合矩阵：</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">白底主图 (点击率)</span>
        <span className="text-slate-300">·</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">场景代入 (激发渴望)</span>
        <span className="text-slate-300">·</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">卖点信息 (快速读懂)</span>
        <span className="text-slate-300">·</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">细节特写 (品质信任)</span>
        <span className="text-slate-300">·</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">规格清单 (防退货)</span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plan.slots.map((slot) => {
          const isSelected = selectedSlotId === slot.slotId;
          const isReady = slot.readiness === "ready";
          const needsRef = slot.readiness === "blocked_needs_visual_reference";

          return (
            <div
              key={slot.slotId}
              data-testid={`visual-asset-slot-${slot.slotId}`}
              data-readiness={slot.readiness}
              data-selected={isSelected ? "true" : "false"}
              onClick={() => onSelectSlot?.(slot)}
              className={`group relative flex flex-col justify-between rounded-xl border p-3 text-xs transition cursor-pointer ${
                isSelected
                  ? "border-teal-500 bg-teal-50/70 shadow-sm ring-1 ring-teal-500"
                  : isReady
                    ? "border-slate-200 bg-white hover:border-teal-300 hover:bg-slate-50/70"
                    : "border-slate-200 bg-slate-50/60 opacity-90 hover:border-slate-300"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 font-mono text-[11px] font-extrabold text-slate-700">
                      0{slot.order}
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm truncate">{slot.title}</h4>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                      isSelected
                        ? "border-teal-400 bg-teal-100 text-teal-800"
                        : isReady
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : needsRef
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-slate-200 bg-slate-100 text-slate-600"
                    }`}
                  >
                    {isSelected
                      ? "● 当前槽位"
                      : isReady
                        ? "✓ 资料就绪"
                        : needsRef
                          ? "⚠ 需参考图"
                          : "⚠ 需补充事实"}
                  </span>
                </div>

                <p className="mt-1.5 text-slate-600 leading-relaxed text-xs">
                  {slot.purposeSummary}
                </p>

                {slot.blockedMessage && !isReady ? (
                  <div className="mt-2 flex items-start gap-1 rounded-lg border border-amber-200/60 bg-amber-50/70 p-1.5 text-[11px] text-amber-800">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" />
                    <span>{slot.blockedMessage}</span>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px]">
                <span className="flex items-center gap-1 text-slate-500">
                  <Sparkles className="h-3 w-3 text-teal-600" aria-hidden="true" />
                  <span className="truncate">
                    {imageStylePresetLabel(slot.suggestedStylePresetId)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSlot?.(slot);
                  }}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                    isSelected
                      ? "bg-teal-600 text-white"
                      : "bg-slate-100 text-slate-700 group-hover:bg-teal-50 group-hover:text-teal-700"
                  }`}
                >
                  {isSelected ? "✓ 策略已联动" : "应用此槽位"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
