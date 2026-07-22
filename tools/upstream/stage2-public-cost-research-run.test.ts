import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStage2PublicCostResearchRun } from "./stage2-public-cost-research-run";

const ROOT = TEST_PROJECT_MATERIALS_ROOT;
const read = <T>(path: string) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as T;

function fixture() {
  return {
    brief: read<any>("06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01/stage2-public-cost-research-brief.v1.json"),
    request: read<any>("06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Authorization-01/stage2-public-cost-research-authorization-request.v1.json"),
    grant: read<any>("06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01/stage2-public-cost-research-authorization-grant.v1.json"),
    consumption: read<any>("06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01/stage2-public-cost-research-authorization-consumption.v1.json"),
    supplier: read<any>("06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/manual-supplier-evidence-stage2-high-01.v1.json"),
    observed: {
      capturedAt: "2026-07-15T17:55:00+08:00", externalReadCount: 6, retryCount: 0 as const,
      uniqueUrls: ["https://www.federalreserve.gov/releases/h10/current/", "https://sell.amazon.com/pricing", "https://sell.amazon.com/fulfillment-by-amazon"],
      exchangeRate: { rate: 6.7766, effectiveDate: "2026-07-10", releaseDate: "2026-07-13", sourceUrl: "https://www.federalreserve.gov/releases/h10/current/" },
      referralSchedule: { category: "Home and Kitchen", rate: 0.15, minimumFeeUsd: 0.30, sourceUrl: "https://sell.amazon.com/pricing", productFeeCategoryConfirmed: false as const, effectiveDate: null },
      fbaPage: { sourceUrl: "https://sell.amazon.com/fulfillment-by-amazon", exactFeeObserved: false as const, packageDimensionConflict: true as const },
    },
  };
}

describe("Stage 2 公开成本真实运行构建", () => {
  it("只推导已具备原始证据的 BOM，其余费用保持 null", () => {
    const result = buildStage2PublicCostResearchRun(fixture());
    expect(result.run.status).toBe("partial_official_evidence");
    expect(result.evidence.observations.referralFee.value).toBeNull();
    expect(result.evidence.observations.fbaFulfillmentFee.value).toBeNull();
    expect(result.preview.derivedStage2Fields.bom.value).toBe(2.73);
    expect(result.preview.derivedStage2Fields.platformCommission.value).toBeNull();
    expect(result.preview.derivedStage2Fields.fba.value).toBeNull();
  });

  it("超过导航预算或出现非允许 Origin 时 fail-closed", () => {
    const over = fixture(); over.observed.externalReadCount = 7;
    expect(() => buildStage2PublicCostResearchRun(over)).toThrow("STAGE2_PUBLIC_COST_NAVIGATION_BUDGET_INVALID");
    const outside = fixture(); outside.observed.uniqueUrls.push("https://example.com/");
    expect(() => buildStage2PublicCostResearchRun(outside)).toThrow("STAGE2_PUBLIC_COST_SOURCE_ORIGIN_INVALID");
  });
});
