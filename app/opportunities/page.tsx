import type { Metadata } from "next";
import { resolve } from "node:path";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { MarketScreeningWorkbench } from "@/components/cross-border/MarketScreeningWorkbench";
import { loadMarketScreeningBatch } from "@/lib/marketScreeningBatchLoader";
import { getActiveProductionMarketScreeningRegistration } from "@/lib/marketScreeningProductionRegistry";
import { buildMarketScreeningWorkbenchRenderModel } from "@/lib/marketScreeningWorkbench";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "发现商品 - 轻选 Agent",
  description: "查看商品候选、市场信号与下一步研究动作，再由人工决定是否继续研究。",
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
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0">
          <WorkspaceMobileNav />
          <MarketScreeningWorkbench model={model} />
        </div>
      </div>
    </main>
  );
}
