import { describe, expect, it } from "vitest";
import { generateStage2EvidenceCollectionBrief } from "./generate-stage2-evidence-collection-brief";

const required = {
  inventoryFile: process.env.STAGE2_COLLECTION_BRIEF_INVENTORY_FILE,
  stage2PacketFile: process.env.STAGE2_COLLECTION_BRIEF_PACKET_FILE,
  sampleId: process.env.STAGE2_COLLECTION_BRIEF_SAMPLE_ID,
  createdAt: process.env.STAGE2_COLLECTION_BRIEF_CREATED_AT,
  outputDirectory: process.env.STAGE2_COLLECTION_BRIEF_OUTPUT_DIRECTORY,
};

describe("Stage 2 collection brief runtime generator", () => {
  it.runIf(Object.values(required).every(Boolean))(
    "generates the current stage2-high-01 authorization material",
    () => {
      const result = generateStage2EvidenceCollectionBrief(required as Record<keyof typeof required, string>);
      expect(result).toMatchObject({ status: "valid_pending_authorization", sampleId: "stage2-high-01" });
    },
  );
});
