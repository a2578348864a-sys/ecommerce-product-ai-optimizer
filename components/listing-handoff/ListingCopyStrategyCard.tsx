"use client";

import type { CopyStrategyV1 } from "@/lib/listingHandoff/copyStrategy/types";
import {
  localizeTargetAudience,
  localizePurchaseMotivation,
  localizePrimaryAngle,
  localizeTone,
  localizeUseCase,
  localizeAvoidClaim,
} from "@/lib/client/strategyDisplayLocalization";

type ListingCopyStrategyCardProps = {
  strategy?: CopyStrategyV1 | null;
  /** Only set when the server confirms this strategy was part of the generation input. */
  applied?: boolean;
  /** Result view uses a compact single line instead of the pre-generation details. */
  summaryOnly?: boolean;
};

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function valuesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(textOf).filter(Boolean);
}

function firstValue(value: unknown): string {
  return valuesOf(value)[0] ?? "";
}

function strategyValue(strategy: CopyStrategyV1 | null | undefined, key: string): unknown {
  if (!strategy || typeof strategy !== "object") return undefined;
  return (strategy as unknown as Record<string, unknown>)[key];
}

/**
 * Human-facing strategy card for the Listing Studio. It exposes only copy
 * direction; no fact ids, claims, schema names, or internal provenance.
 */
export function ListingCopyStrategyCard({
  strategy = null,
  applied = false,
  summaryOnly = false,
}: ListingCopyStrategyCardProps) {
  const targetBuyerRaw = textOf(strategyValue(strategy, "targetBuyer"));
  const painPointRaw = firstValue(strategyValue(strategy, "buyerPainPoints"));
  const mainAngleRaw = textOf(strategyValue(strategy, "mainAngle"));
  const toneRaw = textOf(strategyValue(strategy, "copyTone"));
  const titleStrategy = textOf(strategyValue(strategy, "titleStrategy"));
  const descriptionStrategyRaw = textOf(strategyValue(strategy, "descriptionStrategy"));
  const targetBuyer = localizeTargetAudience(targetBuyerRaw);
  const painPoint = localizePurchaseMotivation(painPointRaw);
  const mainAngle = localizePrimaryAngle(mainAngleRaw);
  const tone = localizeTone(toneRaw);
  const descriptionStrategy = localizeUseCase(descriptionStrategyRaw);
  const bulletStrategies = Array.isArray(strategyValue(strategy, "bulletStrategies"))
    ? (strategyValue(strategy, "bulletStrategies") as Array<{ order?: number; structure?: string; purpose?: string }>)
        .filter((item) => item && typeof item === "object")
        .slice(0, 5)
    : [];
  const avoidExpressions = valuesOf(strategyValue(strategy, "avoidExpressions")).map(localizeAvoidClaim);
  const hasStrategy = Boolean(targetBuyer || painPoint || mainAngle || tone || titleStrategy || descriptionStrategy || bulletStrategies.length);

  if (!hasStrategy) {
    return (
      <section className="min-w-0 rounded-xl border border-violet-200 bg-violet-50/50 p-3" data-testid="listing-copy-strategy-card" aria-label="营销文案策略">
        <h3 className="text-sm font-bold text-violet-950">营销文案策略</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">当前研究资料暂未形成表达策略，仍可依据已确认事实生成安全稿。</p>
      </section>
    );
  }

  if (summaryOnly) {
    return (
      <section className="min-w-0 rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2" data-testid="listing-copy-strategy-applied-summary" aria-label="本次采用策略">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-violet-950">
          <span className="font-bold">本次采用策略</span>
          {targetBuyer ? <span className="break-words">{targetBuyer}</span> : null}
          {painPoint ? <><span className="text-violet-300">·</span><span className="break-words">{painPoint}</span></> : null}
          {mainAngle ? <><span className="text-violet-300">·</span><span className="break-words">{mainAngle}</span></> : null}
          {tone ? <><span className="text-violet-300">·</span><span className="break-words">{tone}</span></> : null}
          {applied ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">✓ 已应用到本次 Listing</span> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/50 p-3" data-testid="listing-copy-strategy-card" aria-label="营销文案策略">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-violet-950">营销文案策略</h3>
            {applied ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">✓ 已应用到本次 Listing</span> : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-violet-900/75">
            来自 VOC / 关键词 / 竞品研究，仅指导表达，不作为商品事实。
          </p>
        </div>
      </div>

      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="min-w-0 rounded-lg border border-violet-100 bg-white/85 p-2">
          <p className="text-[11px] font-semibold text-slate-500">目标买家</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-800">{targetBuyer || "未形成明确方向"}</p>
        </div>
        <div className="min-w-0 rounded-lg border border-violet-100 bg-white/85 p-2">
          <p className="text-[11px] font-semibold text-slate-500">核心需求 / 痛点</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-800">{painPoint || "按已确认资料表达"}</p>
        </div>
        <div className="min-w-0 rounded-lg border border-violet-100 bg-white/85 p-2">
          <p className="text-[11px] font-semibold text-slate-500">主表达角度</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-800">{mainAngle || "事实优先"}</p>
        </div>
        <div className="min-w-0 rounded-lg border border-violet-100 bg-white/85 p-2">
          <p className="text-[11px] font-semibold text-slate-500">文案语气</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-800">{tone || "清晰、克制"}</p>
        </div>
        <div className="min-w-0 rounded-lg border border-violet-100 bg-white/85 p-2">
          <p className="text-[11px] font-semibold text-slate-500">使用场景</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-800">{descriptionStrategy || "结合用户实际使用场景"}</p>
        </div>
      </div>

      <details className="mt-2.5 rounded-lg border border-violet-100 bg-white/60 p-2.5 text-xs">
        <summary className="cursor-pointer font-semibold text-violet-900 hover:text-violet-950">展开详细策略</summary>
        <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-slate-100 bg-white p-2.5">
            <p className="font-semibold text-slate-700">标题策略</p>
            <p className="mt-1 break-words leading-5 text-slate-600">{titleStrategy || "先说清品牌、品类和主要特点，保持可读"}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-slate-100 bg-white p-2.5">
            <p className="font-semibold text-slate-700">商品描述策略</p>
            <p className="mt-1 break-words leading-5 text-slate-600">{descriptionStrategy || "产品是什么 → 对用户有什么帮助 → 合理使用场景"}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-slate-100 bg-white p-2.5 md:col-span-2">
            <p className="font-semibold text-slate-700">五点描述表达结构</p>
            <ul className="mt-1 space-y-1 leading-5 text-slate-600">
              {bulletStrategies.length > 0
                ? bulletStrategies.map((item, index) => <li key={`${item.order ?? index}-${item.purpose ?? index}`} className="break-words"><span className="font-semibold text-violet-900">Feature → Benefit → Scenario</span>{item.purpose ? ` · ${item.purpose}` : ""}</li>)
                : <li>Feature → Benefit → Scenario；每条承担不同的购买价值</li>}
            </ul>
          </div>
          <div className="min-w-0 rounded-lg border border-amber-100 bg-amber-50/70 p-2.5 md:col-span-2">
            <p className="font-semibold text-amber-800">避免表达</p>
            <p className="mt-1 break-words leading-5 text-amber-900">{avoidExpressions.length > 0 ? avoidExpressions.join("、") : "不使用未经证实的性能、认证或夸张承诺"}</p>
          </div>
        </div>
      </details>
    </section>
  );
}
