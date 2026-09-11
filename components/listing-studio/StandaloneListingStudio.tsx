"use client";

/**
 * 独立 Listing 创作工具（STANDALONE）— `/listing-studio` 无 taskId 时的入口模式。
 *
 * 入口语义（第十二轮 UI 修复）：
 * - 有 taskId → 研究主链路模式（服务端重新核验研究事实 + V5 Strategy/Writer/Validator 链）；
 * - 无 taskId → 本模式：资料完全由用户提供，不读取任何商品研究事实，
 *   V5 主链路（Strategy / Writer / Validator / Repair / Rewrite / Recovery / fallback）
 *   完全不参与，因此不会出现「必须从研究任务进入」的阻断。
 *
 * 生成沿用既有独立接口 `/api/listing-studio`（默认 mock；real 需服务端开关 + 显式确认），
 * 生成规则、门禁与结果结构均未改动；本次只修入口状态判断与对应 UI。
 * 需要基于已确认事实生成时，从研究记录进入 taskId 模式。
 */
import Link from "next/link";
import { useCallback, useState } from "react";
import { CopyStrategyPanel } from "@/components/listing-handoff/CopyStrategyPanel";
import { ManualListingStudioClient } from "@/components/listing-studio/ListingStudioClient";
import { StudioProgressRail } from "@/components/studio/StudioProgressRail";
import { deriveListingStudioProgress } from "@/lib/client/studioProgress";

export function StandaloneListingStudio() {
  const [progressInput, setProgressInput] = useState({
    briefReady: false,
    isGenerating: false,
    hasResult: false,
  });
  const handleManualProgress = useCallback((state: {
    briefReady: boolean;
    isGenerating: boolean;
    hasResult: boolean;
  }) => setProgressInput(state), []);

  return (
    <div data-testid="listing-studio-standalone-mode" className="studio-main-flow">
      <StudioProgressRail label="Listing 制作进度" steps={deriveListingStudioProgress(progressInput)} />
      <div
        className="mb-3 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold leading-5 text-slate-600"
        data-testid="listing-mode-standalone"
      >
        <span className="whitespace-nowrap">独立工具（STANDALONE）</span>
        <span>资料由你提供，未经商品研究验证</span>
      </div>
      <section className="surface-card mb-3 p-4" data-testid="listing-studio-standalone-intro">
        <p className="text-sm font-semibold text-slate-900">独立 Listing 创作工具</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          在下方填写商品名称与资料即可生成草稿。本模式不读取商品研究事实，也不经过商品研究的证据校验，
          生成结果只作为草稿供你审核。
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          需要基于已确认事实生成时，请从
          <Link href="/tasks" className="mx-1 font-semibold text-emerald-700 underline-offset-2 hover:underline">
            研究记录
          </Link>
          进入对应商品。
        </p>
      </section>
      <CopyStrategyPanel strategy={null} />
      <ManualListingStudioClient onProgressChange={handleManualProgress} />
    </div>
  );
}
