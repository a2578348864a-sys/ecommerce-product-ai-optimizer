import type { Metadata } from "next";
import Link from "next/link";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { MarketScreeningWorkbench } from "@/components/cross-border/MarketScreeningWorkbench";
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
          <div className="flex flex-col gap-4">
            <section className="surface-card mx-auto flex w-full max-w-7xl flex-col gap-4 border-teal-200 bg-teal-50/40 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <p className="eyebrow">卖家精灵数据导入</p>
                <div>
                  <h2 className="section-title text-lg">先安全预览商品报表</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    上传卖家精灵美国站搜索结果导出，核对字段、缺失和冲突；只读预览，不会进入商品研究池。
                  </p>
                </div>
              </div>
              <Link
                href="/opportunities/sellersprite-preview"
                className="linear-button-primary inline-flex min-h-10 shrink-0 items-center justify-center px-4 py-2 text-sm font-semibold"
              >
                安全预览报表
              </Link>
            </section>
            <ProductBatchManager />
            <details className="surface-card mx-auto w-full max-w-7xl p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                旧版候选兼容视图
              </summary>
              <div className="mt-4">
                <MarketScreeningWorkbench model={model} />
              </div>
            </details>
          </div>
        </div>
      </div>
    </main>
  );
}
