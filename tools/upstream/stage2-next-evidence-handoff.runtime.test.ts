import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage2NextEvidenceHandoff } from "./stage2-next-evidence-handoff";
import type { Stage2EvidenceGapInventory, Stage2EvidenceSubmission } from "./stage2-evidence-intake";

const project = process.env.STAGE2_NEXT_EVIDENCE_HANDOFF_PROJECT;
const createdAt = process.env.STAGE2_NEXT_EVIDENCE_HANDOFF_CREATED_AT;
const outputDirectory = process.env.STAGE2_NEXT_EVIDENCE_HANDOFF_OUTPUT_DIRECTORY;

describe("Stage 2 next-evidence handoff runtime generator", () => {
  it.runIf(Boolean(project && createdAt))("writes the authoritative two-step beginner handoff", () => {
    const read = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
    const source = join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Package-Height-Confirmation-01");
    const result = generateStage2NextEvidenceHandoff({
      inventory: read<Stage2EvidenceGapInventory>(join(project!, "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json")),
      submission: read<Stage2EvidenceSubmission>(join(source, "stage2-evidence-submission.package-height-applied.v1.json")),
      validation: read(join(source, "stage2-evidence-validation.package-height-applied.v1.json")),
      request: read(join(project!, "06_测试与验证/2026-07-15-Phase-Stage2-Remaining-Evidence-03/stage2-remaining-evidence-request.v1.json")),
      createdAt: createdAt!,
      outputDirectory: join(project!, outputDirectory
        ?? "06_测试与验证/2026-07-15-Phase-Stage2-Next-Evidence-Handoff-01"),
    });

    expect(result.handoff.status).toBe("pending_manual_evidence_capture");
    expect(result.handoff.tracks).toHaveLength(2);
    expect(result.handoff.boundary.externalWebsiteAccessed).toBe(false);
  });
});
