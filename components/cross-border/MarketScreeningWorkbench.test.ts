import { createElement } from "react";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketScreeningWorkbench } from "@/components/cross-border/MarketScreeningWorkbench";
import { loadMarketScreeningBatch, type MarketScreeningBatchLoadResult } from "@/lib/marketScreeningBatchLoader";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";
import { buildMarketScreeningWorkbenchRenderModel } from "@/lib/marketScreeningWorkbench";

const projectMaterialsRoot = resolve(process.cwd(), "..");

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
  it("leads with the screening conclusion, keeps run details secondary, and preserves evidence", () => {
    const { result, preview } = readyFixture();
    const html = render(result, preview);

    for (const region of [
      "工作台状态",
      "Selection Brief",
      "来源健康",
      "Evidence / Quality Gate",
      "Stage 1 初筛",
      "Stage 1.5 调查短名单",
      "高级导入 / 历史候选",
    ]) expect(html).toContain(region);
    expect(html).toContain("data-region=\"screening-summary\"");
    expect(html).toContain("20 个商品已完成初筛");
    expect(html).toContain("建议继续调查 5 个，还不是商业候选");
    expect(html).toContain("继续调查");
    expect(html).toContain("暂时观察");
    expect(html).toContain("不建议继续");
    expect(html).toContain("证据不足");
    expect(html).toContain("查看本批调查范围与运行信息");
    expect(html).toContain("可选详情证据：已验证");
    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).toContain("图片未缓存");
    expect((html.match(/data-testid="market-screening-item"/gu) ?? [])).toHaveLength(20);
    expect(html).not.toContain("m.media-amazon.com");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("保存 Candidate");
    expect(html).not.toContain("创建 Task");
    expect(html).not.toContain("启动 Stage 2");
    expect(html).not.toContain("frozen_validation_batch");
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
    expect(html).toContain("上游证据可信，Stage 尚未就绪");
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
    expect(html).toContain("批次已阻断");
    expect(html).toContain("artifact_identity_conflict");
    expect(html).not.toContain("Selection Brief");
    expect(html).not.toContain("data-testid=\"market-screening-item\"");
  });
});
