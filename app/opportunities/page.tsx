import type { Metadata } from "next";
import { resolve } from "node:path";
import { MarketScreeningWorkbench } from "@/components/cross-border/MarketScreeningWorkbench";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { loadMarketScreeningBatch } from "@/lib/marketScreeningBatchLoader";
import { getActiveProductionMarketScreeningRegistration } from "@/lib/marketScreeningProductionRegistry";
import { buildMarketScreeningWorkbenchRenderModel } from "@/lib/marketScreeningWorkbench";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "市场预筛工作台 - 轻选 Agent",
  description: "查看市场证据、初筛结论和下一步调查清单。",
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
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0 space-y-5">
          <header className="workspace-header">
            <p className="eyebrow">轻选工作台</p>
            <h1 className="section-title mt-1 text-2xl">市场预筛</h1>
            <p className="muted-text mt-1 max-w-3xl text-sm leading-6">
              先看哪些商品值得继续调查，再展开证据和运行信息。
            </p>
            <WorkspaceMobileNav />
          </header>
          <MarketScreeningWorkbench model={model} />
        </div>
      </div>
    </main>
  );
}
