import { describe, expect, it } from "vitest";
import { generateStage2EvidenceGapInventory } from "./generate-stage2-evidence-gap-inventory";

const stage2PacketFile = process.env.STAGE2_GAP_SOURCE_PACKET_FILE;
const outputDirectory = process.env.STAGE2_GAP_OUTPUT_DIRECTORY;

describe("Stage 2 evidence gap inventory runtime generator", () => {
  it.runIf(Boolean(stage2PacketFile && outputDirectory))(
    "generates the current seven-sample offline evidence gap inventory",
    () => {
      const result = generateStage2EvidenceGapInventory({
        stage2PacketFile: stage2PacketFile!,
        outputDirectory: outputDirectory!,
      });
      expect(result.summary).toEqual({
        sampleCount: 7,
        samplesBlockedForProfit: 7,
        missingEvidenceFieldCount: 119,
        pendingHumanDecisionFieldCount: 14,
        readyForProfitCalculationCount: 0,
      });
    },
  );
});
