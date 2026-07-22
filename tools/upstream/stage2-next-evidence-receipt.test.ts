import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectMaterialPath } from "../../tests/helpers/project-materials";
import {
  buildStage2NextEvidencePatchPreview,
  buildStage2NextEvidenceReceiptTemplate,
  generateStage2NextEvidenceReceiptMaterials,
  validateStage2NextEvidenceReceipt,
  type Stage2NextEvidenceHandoff,
  type Stage2NextEvidenceReceipt,
} from "./stage2-next-evidence-receipt";

const HANDOFF = readFileSync(projectMaterialPath(
  "06_测试与验证/2026-07-15-Phase-Stage2-Next-Evidence-Handoff-02/stage2-next-evidence-handoff.v1.json",
), "utf8");
const handoff = JSON.parse(HANDOFF) as Stage2NextEvidenceHandoff;

function template() {
  return buildStage2NextEvidenceReceiptTemplate({
    handoff,
    createdAt: "2026-07-15T19:40:00+08:00",
  });
}

function completeReceipt(): Stage2NextEvidenceReceipt {
  const receipt = template();
  receipt.submittedBy = "project_owner";
  receipt.amazonFeeEvidence = {
    status: "provided",
    capturedAt: "2026-07-15T19:45:00+08:00",
    sourceUrl: "https://sellercentral.amazon.com/example-calculator-result",
    sourceImageSha256: "a".repeat(64),
    feeCategory: "Home and Kitchen",
    currency: "USD",
    referralFeeUsdPerItem: 2.4,
    fbaFeeUsdPerItem: 4.5,
    catalogDimensionsAndWeightText: "12.2 x 12.2 x 1.4 in; 1.3 lb",
    note: "Manual transcription from the visible official calculator result.",
    missingReason: null,
  };
  receipt.freightQuoteEvidence = {
    status: "provided",
    capturedAt: "2026-07-15T19:46:00+08:00",
    sourceUrl: null,
    sourceImageSha256: "b".repeat(64),
    quotedQuantityUnits: 100,
    totalQuote: 120,
    currency: "USD",
    routeAndTransportMode: "Supplier city to US Amazon warehouse, sea freight",
    includedCharges: ["freight", "customs_clearance", "delivery"],
    excludedCharges: ["import_duty"],
    quoteValidUntil: "2026-07-31",
    note: "Redacted freight quote screenshot retained outside the JSON; only its hash is stored.",
    missingReason: null,
  };
  return receipt;
}

describe("Stage 2 next-evidence receipt", () => {
  it("creates a pending blank template without inventing values", () => {
    const receipt = template();
    const validation = validateStage2NextEvidenceReceipt(handoff, receipt);

    expect(receipt.amazonFeeEvidence).toMatchObject({ status: "pending", missingReason: "not_provided" });
    expect(receipt.freightQuoteEvidence).toMatchObject({ status: "pending", missingReason: "not_provided" });
    expect(validation).toMatchObject({
      status: "pending_evidence",
      reasonCodes: ["amazon_fee_evidence_missing", "freight_quote_evidence_missing"],
    });
  });

  it("derives a per-item USD freight preview only after a complete quote", () => {
    const receipt = completeReceipt();
    const validation = validateStage2NextEvidenceReceipt(handoff, receipt);
    const preview = buildStage2NextEvidencePatchPreview(handoff, receipt);

    expect(validation).toMatchObject({ status: "valid_for_manual_review", reasonCodes: [] });
    expect(preview.proposedFields).toMatchObject({
      platformCommission: { value: 2.4, currency: "USD", status: "manual_review_required" },
      fba: { value: 4.5, currency: "USD", status: "manual_review_required" },
      firstMile: {
        value: 1.2,
        currency: "USD",
        status: "derived_from_quote_manual_review_required",
      },
      logisticsEvidenceUrl: { value: null, status: "missing_public_url_screenshot_hash_only" },
    });
    expect(preview.boundary).toMatchObject({ submissionMutated: false, profitCalculated: false });
  });

  it("keeps a CNY freight quote unconverted until exchange-rate evidence exists", () => {
    const receipt = completeReceipt();
    receipt.freightQuoteEvidence.currency = "CNY";
    receipt.freightQuoteEvidence.totalQuote = 800;
    const validation = validateStage2NextEvidenceReceipt(handoff, receipt);
    const preview = buildStage2NextEvidencePatchPreview(handoff, receipt);

    expect(validation).toMatchObject({
      status: "valid_partial_requires_exchange_rate",
      reasonCodes: ["freight_quote_exchange_rate_required"],
    });
    expect(preview.proposedFields.firstMile).toMatchObject({
      value: null,
      status: "exchange_rate_evidence_required",
    });
  });

  it("rejects tampered handoff binding and invalid quote quantities", () => {
    const receipt = completeReceipt();
    receipt.handoffHash = "0".repeat(64);
    expect(validateStage2NextEvidenceReceipt(handoff, receipt).status).toBe("rejected");

    const invalid = completeReceipt();
    invalid.freightQuoteEvidence.quotedQuantityUnits = 0;
    expect(validateStage2NextEvidenceReceipt(handoff, invalid)).toMatchObject({
      status: "rejected",
      reasonCodes: expect.arrayContaining(["freight_quote_quantity_invalid"]),
    });
  });

  it("writes pending materials idempotently", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-next-evidence-receipt-"));
    const first = generateStage2NextEvidenceReceiptMaterials({
      handoff,
      createdAt: "2026-07-15T19:40:00+08:00",
      outputDirectory,
    });
    const second = generateStage2NextEvidenceReceiptMaterials({
      handoff,
      createdAt: "2026-07-15T19:40:00+08:00",
      outputDirectory,
    });

    expect(first.artifactWrite.written).toHaveLength(3);
    expect(second.artifactWrite.unchanged).toHaveLength(3);
    expect(readFileSync(join(outputDirectory, "README-收到截图后不用自己填写.md"), "utf8"))
      .toContain("不要自己改 JSON");
  });
});
