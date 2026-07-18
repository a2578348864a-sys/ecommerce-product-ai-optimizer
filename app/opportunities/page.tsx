import type { Metadata } from "next";
import { resolve } from "node:path";
import { MarketScreeningWorkbench } from "@/components/cross-border/MarketScreeningWorkbench";
import { loadMarketScreeningBatch } from "@/lib/marketScreeningBatchLoader";
import { getActiveProductionMarketScreeningRegistration } from "@/lib/marketScreeningProductionRegistry";
import { buildMarketScreeningWorkbenchRenderModel } from "@/lib/marketScreeningWorkbench";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "市场预筛工作台 - 轻选 Agent",
  description: "从冻结市场批次中检查来源证据、Stage 1 初筛与 Stage 1.5 调查短名单。",
};

export default function OpportunitiesPage() {
  const productionRegistration = getActiveProductionMarketScreeningRegistration() ?? undefined;
  const loaderOptions = {
    environment: "production",
    projectMaterialsRoot: resolve(process.cwd(), ".."),
    productionRegistration,
  } as const;
  const batch = loadMarketScreeningBatch(loaderOptions);
  const preview = batch.status === "ready" ? loadStage15ScreeningPreview(loaderOptions) : null;
  const model = buildMarketScreeningWorkbenchRenderModel(
    batch,
    preview?.status === "ready" ? preview.preview : undefined,
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <MarketScreeningWorkbench model={model} />
    </main>
  );
}
