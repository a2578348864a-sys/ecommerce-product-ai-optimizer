import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateStage2NextEvidenceReceiptMaterials,
  type Stage2NextEvidenceHandoff,
} from "./stage2-next-evidence-receipt";

const project = process.env.STAGE2_NEXT_EVIDENCE_RECEIPT_PROJECT;
const createdAt = process.env.STAGE2_NEXT_EVIDENCE_RECEIPT_CREATED_AT;

describe("Stage 2 next-evidence receipt runtime generator", () => {
  it.runIf(Boolean(project && createdAt))("writes the pending receipt materials", () => {
    const handoff = JSON.parse(readFileSync(join(
      project!,
      "06_测试与验证/2026-07-15-Phase-Stage2-Next-Evidence-Handoff-02/stage2-next-evidence-handoff.v1.json",
    ), "utf8")) as Stage2NextEvidenceHandoff;
    const result = generateStage2NextEvidenceReceiptMaterials({
      handoff,
      createdAt: createdAt!,
      outputDirectory: join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Next-Evidence-Receipt-01"),
    });

    expect(result.receipt.amazonFeeEvidence.status).toBe("pending");
    expect(result.receipt.freightQuoteEvidence.status).toBe("pending");
    expect(result.validation.status).toBe("pending_evidence");
  });
});
