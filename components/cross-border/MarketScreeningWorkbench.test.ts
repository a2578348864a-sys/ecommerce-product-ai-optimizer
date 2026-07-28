import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketScreeningWorkbench } from "@/components/cross-border/MarketScreeningWorkbench";
import { loadMarketScreeningBatch, type MarketScreeningBatchLoadResult } from "@/lib/marketScreeningBatchLoader";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";
import { buildMarketScreeningWorkbenchRenderModel } from "@/lib/marketScreeningWorkbench";
import { resolveProjectMaterialsRoot } from "@/lib/projectMaterialsRoot";

const materialsRoot = resolveProjectMaterialsRoot();
if (materialsRoot.status !== "ready") throw new Error(materialsRoot.errorCode);
const projectMaterialsRoot = materialsRoot.projectMaterialsRoot;

function readyFixture() {
  const result = loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot });
  if (result.status !== "ready") throw new Error(result.status);
  const preview = loadStage15ScreeningPreview({ environment: "development", projectMaterialsRoot });
  if (preview.status !== "ready") throw new Error(preview.errorCode);
  return { result, preview: preview.preview };
}

function render(result: MarketScreeningBatchLoadResult, preview?: ReturnType<typeof readyFixture>["preview"]) {
  const model = buildMarketScreeningWorkbenchRenderModel(result, preview);
  return renderToStaticMarkup(createElement(MarketScreeningWorkbench, { model }));
}

describe("MarketScreeningWorkbench", () => {
  it("renders the candidate pool before collapsed technical evidence with exact partition and local images", () => {
    const { result, preview } = readyFixture();
    const html = render(result, preview);

    for (const region of [
      "发现商品",
      "商品候选池",
      "高级证据详情",
      "Selection Brief",
      "来源健康",
      "Evidence / Quality Gate",
      "Stage 1 初筛",
      "Stage 1.5 调查分区",
      "高级导入 / 历史候选",
    ]) expect(html).toContain(region);
    expect(html).toContain('data-region="advanced-evidence"');
    expect(html).toContain("开始商品研究");
    expect(html).toContain("这里不是正式选品结论");
    expect(html).toContain("不代表可采购、可上架或一定有利润");
    expect(html).toContain("advance 5");
    expect(html).toContain("watch 11");
    expect(html).toContain("reject 3");
    expect(html).toContain("insufficient 1");
    expect(html).toContain("可选详情证据：已验证");
    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).toContain("图片未缓存");
    expect((html.match(/data-testid="market-screening-item"/gu) ?? [])).toHaveLength(20);
    expect(html).not.toContain("m.media-amazon.com");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("保存 Candidate");
    expect(html).not.toContain("创建 Task");
    expect(html).not.toContain("启动 Stage 2");
  });

  it("shows limitations in both header and Stage region for ready_partial", () => {
    const { result, preview } = readyFixture();
    const partial: MarketScreeningBatchLoadResult = {
      status: "ready",
      batch: {
        ...result.batch,
        batchReadiness: {
          ...result.batch.batchReadiness,
          status: "ready_partial",
          failedSourceIds: ["optional-source"],
        },
      },
    };
    const html = render(partial, preview);
    expect((html.match(/部分来源失败，结果仅用于受限预筛/gu) ?? [])).toHaveLength(2);
  });

  it("renders a neutral empty state only when a ready batch has no candidate items", () => {
    const { result, preview } = readyFixture();
    const model = buildMarketScreeningWorkbenchRenderModel(result, preview);
    if (model.status !== "ready") throw new Error(model.status);

    const html = renderToStaticMarkup(createElement(MarketScreeningWorkbench, {
      model: {
        ...model,
        view: {
          ...model.view,
          items: [],
        },
      },
    }));

    expect(html).toContain("暂无候选商品");
    expect(html).toContain("当前没有可展示的商品候选。");
    expect(html).toContain("导入市场数据");
    expect(html).toContain("添加候选商品");
    expect(html).not.toContain("商品候选暂时不可用");
    expect(html).not.toContain("当前数据没有通过完整性检查");
  });

  it("renders upstream-only without Stage summaries or product cards", () => {
    const { result } = readyFixture();
    const upstream: MarketScreeningBatchLoadResult = {
      status: "upstream_only",
      upstream: {
        manifest: result.batch.manifest,
        artifacts: {
          selectionBrief: result.batch.artifacts.selectionBrief,
          collectionRun: result.batch.artifacts.collectionRun,
          sourceAdapterResult: result.batch.artifacts.sourceAdapterResult,
          importPackage: result.batch.artifacts.importPackage,
        },
        batchReadiness: {
          ...result.batch.batchReadiness,
          status: "upstream_only",
          reasonCodes: ["stage_artifact_not_ready"],
        },
      },
    };
    const html = render(upstream);
    expect(html).toContain("候选商品池正在准备");
    expect(html).toContain("当前证据已读取，但还不能形成可供人工研究的商品列表");
    expect(html).toContain("高级证据详情");
    expect(html).toContain("Selection Brief");
    expect(html).toContain("来源健康");
    expect(html).not.toContain("Stage 1 初筛");
    expect(html).not.toContain("data-testid=\"market-screening-item\"");
  });

  it("fails closed for blocked batches without rendering evidence cards", () => {
    const { result } = readyFixture();
    const blocked: MarketScreeningBatchLoadResult = {
      status: "blocked",
      errorCode: "artifact_identity_conflict",
      batchReadiness: {
        ...result.batch.batchReadiness,
        status: "blocked",
        reasonCodes: ["artifact_identity_conflict"],
      },
    };
    const html = render(blocked);
    expect(html).toContain("商品候选暂时不可用");
    expect(html).toContain("当前数据没有通过完整性检查，因此不会展示可能误导你的候选商品");
    expect(html).not.toContain("暂无候选商品");
    expect(html).toContain("高级证据详情");
    expect(html).toContain("artifact_identity_conflict");
    expect(html).not.toContain("Selection Brief");
    expect(html).not.toContain("data-testid=\"market-screening-item\"");
  });

  it("shows a deterministic materials-unavailable error instead of an empty state", () => {
    const { result } = readyFixture();
    const unavailable: MarketScreeningBatchLoadResult = {
      status: "blocked",
      errorCode: "project_materials_root_unavailable",
      batchReadiness: {
        ...result.batch.batchReadiness,
        status: "blocked",
        reasonCodes: ["manifest_invalid"],
      },
    };

    const html = render(unavailable);
    expect(html).toContain("材料不可用");
    expect(html).toContain("当前运行环境没有可验证的项目材料来源");
    expect(html).not.toContain("暂无候选商品");
  });
});
