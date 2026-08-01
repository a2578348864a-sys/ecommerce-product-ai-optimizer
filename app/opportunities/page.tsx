import type { Metadata } from "next";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { MarketScreeningWorkbench } from "@/components/cross-border/MarketScreeningWorkbench";
import { OpportunitiesConvergenceView } from "@/components/cross-border/OpportunitiesConvergenceView";
import { ProductBatchManager } from "@/components/cross-border/ProductBatchManager";
import { loadMarketScreeningBatch } from "@/lib/marketScreeningBatchLoader";
import { getActiveProductionMarketScreeningRegistration } from "@/lib/marketScreeningProductionRegistry";
import { buildMarketScreeningWorkbenchRenderModel } from "@/lib/marketScreeningWorkbench";
import { resolveProjectMaterialsRoot } from "@/lib/projectMaterialsRoot";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "发现商品 - 轻选 Agent",
  description: "查看商品候选、市场信号与下一步研究动作，再由人工决定是否继续研究。",
};

export default function OpportunitiesPage() {
  const productionRegistration = getActiveProductionMarketScreeningRegistration() ?? undefined;
  const materialsRoot = resolveProjectMaterialsRoot();
  const loaderOptions = {
    environment: "production",
    projectMaterialsRoot: materialsRoot.status === "ready"
      ? materialsRoot.projectMaterialsRoot
      : null,
    productionRegistration,
  } as const;
  const batch = loadMarketScreeningBatch(loaderOptions);
  const preview = materialsRoot.status === "ready" && batch.status === "ready"
    ? loadStage15ScreeningPreview({
        ...loaderOptions,
        projectMaterialsRoot: materialsRoot.projectMaterialsRoot,
      })
    : null;
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
          <OpportunitiesConvergenceView
            legacyContent={(
              <div className="flex flex-col gap-5">
                <ProductBatchManager />
                <section aria-label="旧版候选兼容视图">
                  <div className="mb-3">
                    <p className="eyebrow">历史候选</p>
                    <h2 className="section-title mt-1 text-lg">旧版候选兼容视图</h2>
                  </div>
                  <MarketScreeningWorkbench model={model} />
                </section>
              </div>
            )}
          />
        </div>
      </div>
    </main>
  );
}
