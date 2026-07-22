import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Stage2EvidenceGapInventory, Stage2EvidenceSubmission } from "./stage2-evidence-intake";
import {
  buildStage2PublicCostResearchBrief,
  type Stage2EvidenceValidationResult,
  validateStage2PublicCostResearchBrief,
} from "./stage2-public-cost-research-brief";

const PROJECT = TEST_PROJECT_MATERIALS_ROOT;
const INVENTORY_FILE = resolve(
  PROJECT,
  "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json",
);
const SUBMISSION_FILE = resolve(
  PROJECT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/stage2-evidence-submission.partial.v1.json",
);
const VALIDATION_FILE = resolve(
  PROJECT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/stage2-evidence-validation.partial.v1.json",
);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sources() {
  return {
    inventory: readJson<Stage2EvidenceGapInventory>(INVENTORY_FILE),
    submission: readJson<Stage2EvidenceSubmission>(SUBMISSION_FILE),
    sourceValidation: readJson<Stage2EvidenceValidationResult>(VALIDATION_FILE),
  };
}

describe("Stage 2 公开成本研究 Brief", () => {
  it("绑定当前 high-01 部分证据，只请求官方汇率与 Amazon US 公开费用", () => {
    const brief = buildStage2PublicCostResearchBrief({
      ...sources(),
      sampleId: "stage2-high-01",
      createdAt: "2026-07-15T16:30:00+08:00",
    });

    expect(brief.status).toBe("pending_user_authorization");
    expect(brief.sample).toMatchObject({
      sampleId: "stage2-high-01",
      productKey: "amazon:US:B07SYPLVTG",
      salePriceUsd: 15.98,
      currentEvidenceStatus: "incomplete",
    });
    expect(brief.requestedResearch.map((item) => item.researchKey)).toEqual([
      "cny_usd_exchange_rate",
      "amazon_us_referral_fee",
      "amazon_us_fba_fulfillment_fee",
    ]);
    expect(brief.requestedScope).toEqual({
      allowedOrigins: ["https://www.federalreserve.gov", "https://sell.amazon.com"],
      maxTotalNavigations: 6,
      automaticRetryCount: 0,
      maxSamples: 1,
    });
    expect(brief.authorization).toEqual({
      status: "not_granted",
      authorizedAt: null,
      authorizedBy: null,
    });
    expect(validateStage2PublicCostResearchBrief(brief)).toMatchObject({
      status: "valid_pending_authorization",
      reasonCodes: [],
    });
  });

  it("明确公开研究只能补官方费率证据，不能估算其他成本或直接开放利润", () => {
    const brief = buildStage2PublicCostResearchBrief({
      ...sources(),
      sampleId: "stage2-high-01",
      createdAt: "2026-07-15T16:30:00+08:00",
    });

    expect(brief.unresolvedOutsideThisResearch).toEqual([
      "supplierCapturedAt",
      "packageHeightCm",
      "firstMile",
      "logisticsEvidenceUrl",
      "packaging",
      "storage",
      "returnReserve",
      "complianceEvidenceUrl",
    ]);
    expect(brief.applicationRules).toMatchObject({
      preserveRawSupplierPriceCny: true,
      preserveRawExchangeRate: true,
      derivedBomRequiresBothInputs: true,
      referralFeeRequiresMatchingCategory: true,
      fbaFeeRequiresExactPackageDimensionsAndWeight: true,
      packageHeightConflictRemainsBlocking: true,
      noAutomaticStage2Decision: true,
      noCandidateCreation: true,
    });
    expect(brief.expectedOutput).toMatchObject({
      schemaVersion: "stage2-public-cost-evidence.v1",
      missingValuesRemainNull: true,
      stage2SubmissionIsNotAutomaticallyMutated: true,
    });
  });

  it("相同输入确定，关键范围、来源 Hash 或样本被修改时 fail-closed", () => {
    const input = {
      ...sources(),
      sampleId: "stage2-high-01",
      createdAt: "2026-07-15T16:30:00+08:00",
    };
    const first = buildStage2PublicCostResearchBrief(input);
    const second = buildStage2PublicCostResearchBrief(input);
    expect(first).toEqual(second);

    const changedScope = structuredClone(first);
    changedScope.requestedScope.maxTotalNavigations = 7 as 6;
    const scopeValidation = validateStage2PublicCostResearchBrief(changedScope);
    expect(scopeValidation.status).toBe("invalid_hash");
    expect(scopeValidation.reasonCodes).toEqual(expect.arrayContaining([
      "brief_hash_mismatch",
      "research_scope_invalid",
    ]));

    const tampered = structuredClone(input.submission);
    tampered.samples[0].fields.moq.value = 2;
    expect(() => buildStage2PublicCostResearchBrief({ ...input, submission: tampered }))
      .toThrow("STAGE2_PUBLIC_COST_SOURCE_INVALID");
    expect(() => buildStage2PublicCostResearchBrief({ ...input, sampleId: "unknown" }))
      .toThrow("STAGE2_PUBLIC_COST_SAMPLE_NOT_FOUND");
  });

  it("授权边界或官方来源白名单被扩大时无效", () => {
    const brief = buildStage2PublicCostResearchBrief({
      ...sources(),
      sampleId: "stage2-high-01",
      createdAt: "2026-07-15T16:30:00+08:00",
    });
    const expanded = structuredClone(brief);
    (expanded.requestedScope.allowedOrigins as string[]).push("https://example.com");
    expanded.boundary.thisBriefIsNotAuthorization = false as true;
    const validation = validateStage2PublicCostResearchBrief(expanded);

    expect(validation.status).toBe("invalid_hash");
    expect(validation.reasonCodes).toEqual(expect.arrayContaining([
      "brief_hash_mismatch",
      "allowed_origins_invalid",
      "boundary_invalid",
    ]));
  });
});
