import { describe, expect, it } from "vitest";
import { generateStage2PublicCostResearchRun } from "./stage2-public-cost-research-run";

const root = process.env.STAGE2_PUBLIC_COST_RUN_ROOT;
describe("Stage 2 public cost real run generator", () => {
  it.runIf(Boolean(root))("writes the authorized partial evidence package", () => {
    const result = generateStage2PublicCostResearchRun({
      briefFile: `${root}/06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01/stage2-public-cost-research-brief.v1.json`,
      requestFile: `${root}/06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Authorization-01/stage2-public-cost-research-authorization-request.v1.json`,
      grantFile: `${root}/06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01/stage2-public-cost-research-authorization-grant.v1.json`,
      consumptionFile: `${root}/06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01/stage2-public-cost-research-authorization-consumption.v1.json`,
      supplierFile: `${root}/06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/manual-supplier-evidence-stage2-high-01.v1.json`,
      outputDirectory: `${root}/06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01`,
      observed: {
        capturedAt: "2026-07-15T17:55:00+08:00", externalReadCount: 6, retryCount: 0,
        uniqueUrls: ["https://www.federalreserve.gov/releases/h10/current/", "https://sell.amazon.com/pricing", "https://sell.amazon.com/fulfillment-by-amazon"],
        exchangeRate: { rate: 6.7766, effectiveDate: "2026-07-10", releaseDate: "2026-07-13", sourceUrl: "https://www.federalreserve.gov/releases/h10/current/" },
        referralSchedule: { category: "Home and Kitchen", rate: 0.15, minimumFeeUsd: 0.30, sourceUrl: "https://sell.amazon.com/pricing", productFeeCategoryConfirmed: false, effectiveDate: null },
        fbaPage: { sourceUrl: "https://sell.amazon.com/fulfillment-by-amazon", exactFeeObserved: false, packageDimensionConflict: true },
      },
    });
    expect(result.preview.derivedStage2Fields.bom.value).toBe(2.73);
    expect(result.review).toMatchObject({
      status: "partial_patch_requires_manual_review",
      boundary: { stage2SubmissionMutated: false },
    });
  });
});
