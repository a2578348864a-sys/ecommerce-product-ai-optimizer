import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStage2PublicCostReviewDecision,
  buildStage2PublicCostReviewRequest,
  validateStage2PublicCostReviewDecision,
  validateStage2PublicCostReviewRequest,
} from "./stage2-public-cost-review";

const ROOT = resolve(process.cwd(), "../06_测试与验证");
const read = (relative: string) => JSON.parse(readFileSync(resolve(ROOT, relative), "utf8"));
function source() {
  const runRoot = "2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01";
  return {
    brief: read("2026-07-15-Phase-Stage2-Public-Cost-Research-Brief-01/stage2-public-cost-research-brief.v1.json"),
    run: read(`${runRoot}/stage2-public-cost-research-run.v1.json`),
    evidence: read(`${runRoot}/stage2-public-cost-evidence.v1.json`),
    validation: read(`${runRoot}/stage2-public-cost-evidence-validation.v1.json`),
    preview: read(`${runRoot}/stage2-public-cost-derivation-preview.v1.json`),
    patchPreview: read(`${runRoot}/stage2-public-cost-submission-patch.preview.v1.json`),
  };
}

describe("Stage 2 公开成本人工复核门禁", () => {
  it("把BOM和全部来源Hash绑定到pending request", () => {
    const sources = source();
    const request = buildStage2PublicCostReviewRequest({ ...sources, createdAt: "2026-07-15T18:03:00+08:00" });
    expect(validateStage2PublicCostReviewRequest(sources, request)).toMatchObject({ status: "valid_pending_user_review", reasonCodes: [] });
    expect(request).toMatchObject({
      status: "pending_user_review",
      proposedBom: { value: 2.73, currency: "USD", unit: "per_item" },
      stage2SubmissionMutated: false,
    });
  });

  it("确认短语必须逐字匹配，决定仍不自动改submission", () => {
    const sources = source();
    const request = buildStage2PublicCostReviewRequest({ ...sources, createdAt: "2026-07-15T18:03:00+08:00" });
    expect(() => buildStage2PublicCostReviewDecision({ request, confirmationText: `${request.exactConfirmationText} `, decidedAt: "2026-07-15T18:04:00+08:00" }))
      .toThrow("STAGE2_PUBLIC_COST_REVIEW_TEXT_MISMATCH");
    const decision = buildStage2PublicCostReviewDecision({ request, confirmationText: request.exactConfirmationText, decidedAt: "2026-07-15T18:04:00+08:00" });
    expect(validateStage2PublicCostReviewDecision(request, decision).status).toBe("valid_accepted_not_applied");
    expect(decision).toMatchObject({ decision: "accepted_as_provisional_derived_input", stage2SubmissionMutated: false });
    expect(decision).not.toHaveProperty("confirmationText");
  });

  it("来源或请求Hash被篡改时fail-closed", () => {
    const sources = source();
    const request = buildStage2PublicCostReviewRequest({ ...sources, createdAt: "2026-07-15T18:03:00+08:00" });
    const changed = structuredClone(sources);
    changed.preview.derivedStage2Fields.bom.value = 2.74;
    expect(validateStage2PublicCostReviewRequest(changed, request).status).not.toBe("valid_pending_user_review");
    const tampered = structuredClone(request);
    tampered.proposedBom.value = 2.74;
    expect(validateStage2PublicCostReviewRequest(sources, tampered).status).not.toBe("valid_pending_user_review");
  });
});
