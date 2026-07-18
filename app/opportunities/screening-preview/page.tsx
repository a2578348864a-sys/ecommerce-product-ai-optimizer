import type { Metadata } from "next";
import { resolve } from "node:path";
import { notFound } from "next/navigation";
import { MarketScreeningWorkbench } from "@/components/cross-border/MarketScreeningWorkbench";
import { loadMarketScreeningBatch } from "@/lib/marketScreeningBatchLoader";
import { buildMarketScreeningWorkbenchRenderModel } from "@/lib/marketScreeningWorkbench";
import { isStage15ScreeningPreviewAvailable } from "@/lib/stage15ScreeningPreviewAvailability";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "调查短名单预览 - 轻选 Agent",
  description: "Stage 1.5 本地只读调查短名单预览。",
};

export default function ScreeningPreviewPage() {
  if (!isStage15ScreeningPreviewAvailable(process.env.NODE_ENV)) notFound();

  const loaderOptions = {
    environment: "development",
    projectMaterialsRoot: resolve(process.cwd(), ".."),
  } as const;
  const batch = loadMarketScreeningBatch(loaderOptions);
  const preview = batch.status === "ready" ? loadStage15ScreeningPreview(loaderOptions) : null;
  const model = buildMarketScreeningWorkbenchRenderModel(
    batch,
    preview?.status === "ready" ? preview.preview : undefined,
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto mb-4 max-w-7xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
        内部诊断 · 非正式导航
      </div>
      <MarketScreeningWorkbench model={model} />
    </main>
  );
}
