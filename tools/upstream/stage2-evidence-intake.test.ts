import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  STAGE2_OBJECTIVE_EVIDENCE_FIELDS,
  buildStage2CalibrationFromSubmission,
  buildStage2EvidenceSubmissionTemplate,
  validateStage2EvidenceSubmission,
  type Stage2EvidenceFieldName,
  type Stage2EvidenceGapInventory,
  type Stage2EvidenceSubmission,
} from "./stage2-evidence-intake";

const INVENTORY_PATH = resolve(
  process.cwd(),
  "../06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json",
);
const CAPTURED_AT = "2026-07-14T12:00:00.000Z";

function loadInventory(): Stage2EvidenceGapInventory {
  return JSON.parse(readFileSync(INVENTORY_PATH, "utf8")) as Stage2EvidenceGapInventory;
}

function objectiveValue(field: Stage2EvidenceFieldName): string | number {
  const values: Record<Stage2EvidenceFieldName, string | number> = {
    supplierUrl: "https://example.com/supplier/variant-a",
    supplierCapturedAt: CAPTURED_AT,
    moq: 100,
    bom: 4.25,
    packageLengthCm: 30,
    packageWidthCm: 20,
    packageHeightCm: 8,
    packageWeightKg: 0.9,
    firstMile: 1.8,
    logisticsEvidenceUrl: "https://example.com/logistics/quote-a",
    platformCommission: 2.4,
    fba: 3.2,
    packaging: 0.4,
    storage: 0.25,
    returnReserve: 0.8,
    complianceEvidenceUrl: "https://example.com/compliance/rule-a",
    executionRiskNotes: "合成 Fixture：安装、耐用性与质量仍需真实人工核验。",
  };
  return values[field];
}

function completeSyntheticSubmission(inventory = loadInventory()): {
  inventory: Stage2EvidenceGapInventory;
  submission: Stage2EvidenceSubmission;
} {
  const submission = buildStage2EvidenceSubmissionTemplate(inventory, {
    submissionId: "stage2-synthetic-complete-01",
    createdAt: CAPTURED_AT,
    evidenceMode: "synthetic_fixture",
    submittedBy: "test_fixture",
  });
  for (const sample of submission.samples) {
    sample.variantIdentity = {
      status: "confirmed",
      amazonVariant: "variant-a",
      supplierVariant: "variant-a",
      confirmedAt: CAPTURED_AT,
      evidence: {
        sourceType: "manual",
        sourceUrl: "https://example.com/variant-match/variant-a",
        capturedAt: CAPTURED_AT,
        note: "合成 Fixture 的同变体人工确认。",
        inputHash: null,
      },
    };
    for (const field of STAGE2_OBJECTIVE_EVIDENCE_FIELDS) {
      sample.fields[field] = {
        value: objectiveValue(field),
        missingReason: null,
        evidence: {
          sourceType: "direct_observation",
          sourceUrl: `https://example.com/evidence/${field}`,
          capturedAt: CAPTURED_AT,
          note: `合成 Fixture 来源：${field}`,
          inputHash: null,
        },
      };
    }
  }
  return { inventory, submission };
}

describe("Stage 2 客观证据录入", () => {
  it("从真实缺口清单生成 7 条全 null 模板，保持人工决定在契约之外", () => {
    const inventory = loadInventory();
    const first = buildStage2EvidenceSubmissionTemplate(inventory, {
      submissionId: "stage2-real-template-01",
      createdAt: CAPTURED_AT,
      evidenceMode: "real_evidence",
      submittedBy: "project_owner",
    });
    const second = buildStage2EvidenceSubmissionTemplate(inventory, {
      submissionId: "stage2-real-template-01",
      createdAt: CAPTURED_AT,
      evidenceMode: "real_evidence",
      submittedBy: "project_owner",
    });

    expect(first).toEqual(second);
    expect(first.samples).toHaveLength(7);
    expect(first.sourceGapInventoryHash).toBe(inventory.packetHash);
    expect(JSON.stringify(first)).not.toContain("humanContinueDecision");
    expect(first.samples.every((sample) => STAGE2_OBJECTIVE_EVIDENCE_FIELDS.every((field) => (
      sample.fields[field].value === null
      && sample.fields[field].evidence === null
      && sample.fields[field].missingReason === "not_collected"
    )))).toBe(true);

    const validation = validateStage2EvidenceSubmission(inventory, first);
    expect(validation.status).toBe("incomplete");
    expect(validation.summary.readyForCalibrationCount).toBe(0);
    expect(validation.summary.profitInsufficientEvidenceCount).toBe(7);
    expect(validation.samples.every((sample) => sample.calibration.status === "profit_insufficient_evidence")).toBe(true);
  });

  it("完整合成 Fixture 可确定性进入 Stage 2 校准，但明确不构成业务验证", () => {
    const { inventory, submission } = completeSyntheticSubmission();
    const first = validateStage2EvidenceSubmission(inventory, submission);
    const second = validateStage2EvidenceSubmission(inventory, structuredClone(submission));
    const calibration = buildStage2CalibrationFromSubmission(inventory, submission);

    expect(first).toEqual(second);
    expect(first.status).toBe("ready_for_calibration");
    expect(first.summary.readyForCalibrationCount).toBe(7);
    expect(first.boundary.businessValidationProven).toBe(false);
    expect(calibration.status).toBe("synthetic_fixture_calculated");
    expect(calibration.samples).toHaveLength(7);
    expect(calibration.samples.every((sample) => sample.calibration.status === "calculated")).toBe(true);
    expect(calibration.samples[0].calibration.normalContributionMargin).toBeCloseTo(2.88, 8);
  });

  it.each([0, -1])("售价 %s 无法形成可用利润输入时整包 fail-closed", (salePrice) => {
    const inventory = structuredClone(loadInventory());
    inventory.samples[0].sourceEvidence.salePrice = salePrice;
    const { packetHash: _oldHash, ...body } = inventory;
    inventory.packetHash = stableHash(body);

    expect(() => buildStage2EvidenceSubmissionTemplate(inventory, {
      submissionId: "stage2-invalid-sale-price-01",
      createdAt: CAPTURED_AT,
      evidenceMode: "synthetic_fixture",
      submittedBy: "test_fixture",
    })).toThrow("STAGE2_GAP_INVENTORY_SALE_PRICE_INVALID");
  });

  it("非 USD 来源价格不能进入当前轻量校准", () => {
    const inventory = structuredClone(loadInventory());
    (inventory.samples[0].sourceEvidence as { salePrice: number | null; currency: string }).currency = "JPY";
    const { packetHash: _oldHash, ...body } = inventory;
    inventory.packetHash = stableHash(body);

    expect(() => buildStage2EvidenceSubmissionTemplate(inventory, {
      submissionId: "stage2-invalid-currency-01",
      createdAt: CAPTURED_AT,
      evidenceMode: "synthetic_fixture",
      submittedBy: "test_fixture",
    })).toThrow("STAGE2_GAP_INVENTORY_CURRENCY_INVALID");
  });

  it("来源售价缺失时不得把商业字段齐全的样本标记为 ready", () => {
    const inventory = structuredClone(loadInventory());
    inventory.samples[0].sourceEvidence.salePrice = null;
    const { packetHash: _oldHash, ...body } = inventory;
    inventory.packetHash = stableHash(body);
    const { submission } = completeSyntheticSubmission(inventory);

    const validation = validateStage2EvidenceSubmission(inventory, submission);

    expect(validation.samples[0].calibration.status).toBe("profit_insufficient_evidence");
    expect(validation.samples[0].calibration.missingInputs).toContain("salePrice");
    expect(validation.samples[0].status).toBe("incomplete");
    expect(validation.summary.readyForCalibrationCount).toBe(inventory.samples.length - 1);
  });

  it("任一关键证据值变化都会改变提交 Hash 和校验 input Hash", () => {
    const { inventory, submission } = completeSyntheticSubmission();
    const before = validateStage2EvidenceSubmission(inventory, submission);
    const changed = structuredClone(submission);
    changed.samples[0].fields.bom.value = 4.5;
    const after = validateStage2EvidenceSubmission(inventory, changed);

    expect(after.submissionHash).not.toBe(before.submissionHash);
    expect(after.inputHash).not.toBe(before.inputHash);
  });

  it("非空值没有来源时 fail-closed，且不会被当成缺失值静默接受", () => {
    const { inventory, submission } = completeSyntheticSubmission();
    submission.samples[0].fields.bom.evidence = null;

    const validation = validateStage2EvidenceSubmission(inventory, submission);
    expect(validation.status).toBe("rejected");
    expect(validation.samples[0].reasonCodes).toContain("bom_evidence_missing");
  });

  it("未知、冲突的变体身份和不安全 URL 均 fail-closed", () => {
    const { inventory, submission } = completeSyntheticSubmission();
    submission.samples[0].variantIdentity.status = "mismatch";
    submission.samples[1].fields.supplierUrl.value = "http://127.0.0.1/private";

    const validation = validateStage2EvidenceSubmission(inventory, submission);
    expect(validation.status).toBe("rejected");
    expect(validation.samples[0].reasonCodes).toContain("variant_identity_mismatch");
    expect(validation.samples[1].reasonCodes).toContain("supplierUrl_value_url_invalid");
  });

  it("样本缺失、重复或跨 productKey 时拒绝整包", () => {
    const { inventory, submission } = completeSyntheticSubmission();
    submission.samples[0].productKey = "amazon:US:DIFFERENT";
    submission.samples.pop();

    expect(() => validateStage2EvidenceSubmission(inventory, submission)).toThrow("STAGE2_SUBMISSION_SAMPLE_MISMATCH");
  });

  it("客观证据录入拒绝混入人工晋级决定", () => {
    const { inventory, submission } = completeSyntheticSubmission();
    (submission.samples[0] as unknown as Record<string, unknown>).humanContinueDecision = "continue";
    (submission as unknown as Record<string, unknown>).humanDecisionReason = "不应出现在客观证据包";

    const validation = validateStage2EvidenceSubmission(inventory, submission);
    expect(validation.status).toBe("rejected");
    expect(validation.samples[0].reasonCodes).toContain("unexpected_sample_field");
    expect(validation.packageReasonCodes).toContain("unexpected_submission_field");
  });

  it("额外客观字段和来源隐藏字段不能绕过白名单契约", () => {
    const { inventory, submission } = completeSyntheticSubmission();
    (submission.samples[0].fields as unknown as Record<string, unknown>).secretOverride = { value: 1 };
    (submission.samples[1].fields.bom.evidence as unknown as Record<string, unknown>).authorization = "secret";

    const validation = validateStage2EvidenceSubmission(inventory, submission);
    expect(validation.status).toBe("rejected");
    expect(validation.samples[0].reasonCodes).toContain("unexpected_objective_field");
    expect(validation.samples[1].reasonCodes).toContain("bom_evidence_unexpected_field");
  });
});
