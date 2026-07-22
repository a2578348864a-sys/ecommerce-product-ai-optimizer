import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Stage2EvidenceGapInventory, Stage2EvidenceSubmission } from "./stage2-evidence-intake";
import {
  buildStage2PublicCostResearchBrief,
  type Stage2PublicCostResearchBrief,
} from "./stage2-public-cost-research-brief";
import {
  buildStage2PublicCostDerivationPreview,
  buildStage2PublicCostEvidenceTemplate,
  validateStage2PublicCostEvidence,
  type Stage2PublicCostEvidence,
} from "./stage2-public-cost-evidence";

const PROJECT = TEST_PROJECT_MATERIALS_ROOT;

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(PROJECT, relativePath), "utf8")) as T;
}

function brief(): Stage2PublicCostResearchBrief {
  return buildStage2PublicCostResearchBrief({
    inventory: readJson<Stage2EvidenceGapInventory>(
      "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json",
    ),
    submission: readJson<Stage2EvidenceSubmission>(
      "06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/stage2-evidence-submission.partial.v1.json",
    ),
    sourceValidation: readJson(
      "06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/stage2-evidence-validation.partial.v1.json",
    ),
    sampleId: "stage2-high-01",
    createdAt: "2026-07-15T16:30:00+08:00",
  });
}

function reference(sourceUrl: string) {
  return {
    sourceType: "direct_observation" as const,
    sourceUrl,
    capturedAt: "2026-07-15T17:00:00+08:00",
    note: "公开页面白名单字段观察。",
    contentHash: "a".repeat(64),
  };
}

function partialEvidence(): Stage2PublicCostEvidence {
  const result = buildStage2PublicCostEvidenceTemplate(brief());
  result.status = "partial";
  result.capturedAt = "2026-07-15T17:00:00+08:00";
  result.observations.supplierUnitPriceCny = {
    value: 18.5,
    missingReason: null,
    evidence: { ...reference("https://detail.1688.com/offer/980209804939.html"), sourceType: "manual" },
  };
  result.observations.exchangeRate = {
    value: { quoteDirection: "CNY_PER_USD", rate: 7.2, effectiveDate: "2026-07-14" },
    missingReason: null,
    evidence: reference("https://www.federalreserve.gov/releases/h10/current/"),
  };
  result.observations.referralFee = {
    value: { matchedCategory: "Home and Kitchen", rate: 0.15, minimumFeeUsd: 0.3, effectiveDate: "2026-07-15" },
    missingReason: null,
    evidence: reference("https://sell.amazon.com/pricing"),
  };
  result.observations.fbaFulfillmentFee = {
    value: {
      feeUsd: 4.55,
      sizeTier: "large_standard_non_apparel",
      shippingWeightBasis: "requires_exact_package_height",
      effectiveDate: "2026-07-15",
      applicability: "blocked_package_dimension_conflict",
    },
    missingReason: null,
    evidence: reference("https://sell.amazon.com/pricing"),
  };
  return result;
}

describe("Stage 2 公开成本证据与推导预览", () => {
  it("生成全空待研究模板，不把缺失值伪装为 0", () => {
    const template = buildStage2PublicCostEvidenceTemplate(brief());
    const preview = buildStage2PublicCostDerivationPreview(brief(), template);
    expect(template.status).toBe("not_collected");
    expect(template.capturedAt).toBeNull();
    expect(Object.values(template.observations).every((entry) => (
      entry.value === null && entry.missingReason === "pending_authorized_research" && entry.evidence === null
    ))).toBe(true);
    expect(validateStage2PublicCostEvidence(brief(), template)).toMatchObject({
      status: "valid_pending_research",
      reasonCodes: [],
    });
    expect(preview.status).toBe("pending_research");
    expect(Object.values(preview.derivedStage2Fields).every((field) => field.value === null)).toBe(true);
  });

  it("部分官方证据只推导 BOM 与佣金，包装高度冲突时 FBA 继续为空", () => {
    const source = partialEvidence();
    const validation = validateStage2PublicCostEvidence(brief(), source);
    const preview = buildStage2PublicCostDerivationPreview(brief(), source);

    expect(validation.status).toBe("valid_partial");
    expect(preview.status).toBe("partial_cost_inputs");
    expect(preview.derivedStage2Fields).toMatchObject({
      bom: { value: 2.57, status: "derived" },
      platformCommission: { value: 2.4, status: "derived" },
      fba: { value: null, status: "blocked_package_dimension_conflict" },
    });
    expect(preview.boundary).toEqual({
      stage2SubmissionMutated: false,
      profitCalculated: false,
      humanDecisionRecorded: false,
      candidateCreated: false,
      databaseWritten: false,
    });
  });

  it("FBA 只有明确匹配同一包装尺寸重量后才可进入成本预览", () => {
    const source = partialEvidence();
    const value = source.observations.fbaFulfillmentFee.value;
    if (value === null) throw new Error("TEST_SETUP_INVALID");
    source.status = "complete";
    source.observations.fbaFulfillmentFee.value = {
      ...value,
      shippingWeightBasis: "31x31x3.8cm_0.58kg_exact_match",
      applicability: "exact_package_match",
    };
    const preview = buildStage2PublicCostDerivationPreview(brief(), source);

    expect(validateStage2PublicCostEvidence(brief(), source).status).toBe("valid_complete");
    expect(preview.status).toBe("public_cost_inputs_ready_for_stage2_submission_review");
    expect(preview.derivedStage2Fields.fba).toMatchObject({ value: 4.55, status: "direct_official_schedule_match" });
  });

  it("非官方 Origin、错误 Hash、无来源值或状态夸大时 fail-closed", () => {
    const source = partialEvidence();
    source.observations.referralFee.evidence = reference("https://example.com/pricing");
    source.observations.exchangeRate.evidence = null;
    source.status = "complete";
    const result = validateStage2PublicCostEvidence(brief(), source);

    expect(result.status).toBe("rejected");
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      "referralFee_source_origin_invalid",
      "exchangeRate_evidence_missing",
      "evidence_status_invalid",
    ]));
  });

  it("畸形供应商 URL 返回拒绝原因而不是抛出解析异常", () => {
    const source = partialEvidence();
    const supplierEvidence = source.observations.supplierUnitPriceCny.evidence;
    if (supplierEvidence === null) throw new Error("TEST_SETUP_INVALID");
    supplierEvidence.sourceUrl = "not-a-url";

    expect(() => validateStage2PublicCostEvidence(brief(), source)).not.toThrow();
    expect(validateStage2PublicCostEvidence(brief(), source)).toMatchObject({
      status: "rejected",
      reasonCodes: expect.arrayContaining(["supplierUnitPriceCny_source_origin_invalid"]),
    });
  });

  it("修改原始汇率会改变推导输入 Hash 和 BOM，不覆盖原始值", () => {
    const firstSource = partialEvidence();
    const secondSource = structuredClone(firstSource);
    const secondRate = secondSource.observations.exchangeRate.value;
    if (secondRate === null) throw new Error("TEST_SETUP_INVALID");
    secondSource.observations.exchangeRate.value = { ...secondRate, rate: 7.4 };

    const first = buildStage2PublicCostDerivationPreview(brief(), firstSource);
    const second = buildStage2PublicCostDerivationPreview(brief(), secondSource);
    expect(first.inputHash).not.toBe(second.inputHash);
    expect(first.derivedStage2Fields.bom.value).toBe(2.57);
    expect(second.derivedStage2Fields.bom.value).toBe(2.5);
    expect(firstSource.observations.exchangeRate.value).toMatchObject({ rate: 7.2 });
  });
});
