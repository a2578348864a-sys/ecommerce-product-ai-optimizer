import { describe, expect, it } from "vitest";
import { generateStage2AdvancementMaterials } from "./generate-stage2-advancement-materials";

const required = {
  inventoryFile: process.env.STAGE2_ADVANCEMENT_INVENTORY_FILE,
  evidenceSubmissionFile: process.env.STAGE2_ADVANCEMENT_SUBMISSION_FILE,
  stage2PacketFile: process.env.STAGE2_ADVANCEMENT_PACKET_FILE,
  rankingFile: process.env.STAGE2_ADVANCEMENT_RANKING_FILE,
  outputDirectory: process.env.STAGE2_ADVANCEMENT_OUTPUT_DIRECTORY,
  decidedAt: process.env.STAGE2_ADVANCEMENT_DECIDED_AT,
};

describe("Stage 2 advancement runtime generator", () => {
  it.runIf(Object.values(required).every(Boolean))(
    "generates the current blocked decision and candidate preview materials",
    () => {
      const result = generateStage2AdvancementMaterials(required as Record<keyof typeof required, string>);
      expect(result).toMatchObject({
        decisionStatus: "blocked_by_evidence",
        previewStatus: "blocked_by_evidence",
        candidatePreviewCount: 0,
      });
    },
  );
});
