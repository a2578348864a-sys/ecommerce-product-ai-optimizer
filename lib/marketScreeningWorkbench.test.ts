import { TEST_PROJECT_MATERIALS_ROOT } from "../tests/helpers/project-materials";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadMarketScreeningBatch,
  type MarketScreeningBatchLoadResult,
  type VerifiedUpstreamBatch,
} from "@/lib/marketScreeningBatchLoader";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";
import {
  buildMarketScreeningWorkbenchRenderModel,
  buildMarketScreeningWorkbenchView,
} from "@/lib/marketScreeningWorkbench";

const projectMaterialsRoot = TEST_PROJECT_MATERIALS_ROOT;

function readyFixture() {
  const result = loadMarketScreeningBatch({ environment: "development", projectMaterialsRoot });
  if (result.status !== "ready") throw new Error(result.status);
  const preview = loadStage15ScreeningPreview({ environment: "development", projectMaterialsRoot });
  if (preview.status !== "ready") throw new Error(preview.errorCode);
  return { result, preview: preview.preview };
}

describe("market screening workbench view", () => {
  it("projects the frozen batch into traceable evidence fields without mutating source artifacts", () => {
    const { result, preview } = readyFixture();
    const before = JSON.stringify(result.batch.artifacts);
    const view = buildMarketScreeningWorkbenchView(result.batch, preview);

    expect(view.manifestId).toBe("phase0-market-screening-frozen-20260717-01");
    expect(view.batchMode).toBe("frozen_validation_batch");
    expect(view.brief.query).toMatchObject({
      value: "closet organizer",
      source: "selectionBrief",
      confidence: "high",
      missingReason: null,
    });
    expect(view.sourceRuns).toHaveLength(1);
    expect(view.batchHealth).toMatchObject({
      acceptedUniqueProductCount: 20,
      imageAvailableCount: 11,
      imageNotCachedCount: 9,
      optionalDetailStatus: "verified",
    });
    expect(view.stage15Summary).toMatchObject({ advance: 5, watch: 11, reject: 3, insufficient: 1 });
    expect(view.items).toHaveLength(20);
    expect(view.items.filter((item) => item.image.status === "available")).toHaveLength(11);
    expect(view.items.filter((item) => item.image.status === "image_not_cached")).toHaveLength(9);
    expect(view.items.every((item) => item.title.source === "importPackage")).toBe(true);
    expect(view.items.every((item) => item.price.source === "importPackage")).toBe(true);
    expect(view.items.some((item) => item.detailEvidence.value !== null)).toBe(true);
    expect(JSON.stringify(view)).not.toContain("m.media-amazon.com");
    expect(JSON.stringify(result.batch.artifacts)).toBe(before);
  });

  it("returns one deterministic discriminated union for every readiness state", () => {
    const { result, preview } = readyFixture();
    const readyFull = buildMarketScreeningWorkbenchRenderModel(result, preview);

    const readyPartialResult: MarketScreeningBatchLoadResult = {
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
    const readyPartial = buildMarketScreeningWorkbenchRenderModel(readyPartialResult, preview);

    const upstreamResult: MarketScreeningBatchLoadResult = {
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
      } satisfies VerifiedUpstreamBatch,
    };
    const upstream = buildMarketScreeningWorkbenchRenderModel(upstreamResult);

    const blockedResult: MarketScreeningBatchLoadResult = {
      status: "blocked",
      errorCode: "artifact_hash_mismatch",
      batchReadiness: {
        ...result.batch.batchReadiness,
        status: "blocked",
        reasonCodes: ["artifact_hash_mismatch"],
      },
    };
    const blocked = buildMarketScreeningWorkbenchRenderModel(blockedResult);

    expect([readyFull.status, readyPartial.status, upstream.status, blocked.status]).toEqual([
      "ready",
      "ready",
      "upstream_only",
      "blocked",
    ]);
    expect(readyFull.status === "ready" && readyFull.readiness).toBe("ready_full");
    expect(readyPartial.status === "ready" && readyPartial.readiness).toBe("ready_partial");
    expect(upstream.status === "upstream_only" && "stage1Summary" in upstream.view).toBe(false);
    expect(blocked.status === "blocked" && "view" in blocked).toBe(false);
  });
});
