import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage15EffectivenessPilot } from "./generate-stage15-effectiveness-pilot";

const screeningRunFile = process.env.STAGE15_PILOT_SCREENING_RUN_FILE;
const visualPacketFile = process.env.STAGE15_PILOT_VISUAL_PACKET_FILE;
const outputDirectory = process.env.STAGE15_PILOT_OUTPUT_DIRECTORY;
const createdAt = process.env.STAGE15_PILOT_CREATED_AT;

describe("Stage 1.5 effectiveness pilot runtime generator", () => {
  it.runIf(Boolean(screeningRunFile && visualPacketFile && outputDirectory && createdAt))(
    "writes the frozen 5+5 offline protocol and pending evidence packet",
    () => {
      const result = generateStage15EffectivenessPilot({
        screeningRunFile: screeningRunFile!,
        visualPacketFile: visualPacketFile!,
        outputDirectory: outputDirectory!,
        createdAt: createdAt!,
      });
      const protocol = JSON.parse(readFileSync(join(outputDirectory!, result.files[0]), "utf8"));
      const blindPacket = JSON.parse(readFileSync(join(outputDirectory!, result.files[1]), "utf8"));
      const resultTemplate = JSON.parse(readFileSync(join(outputDirectory!, result.files[2]), "utf8"));

      expect(protocol.sampleSummary).toEqual({
        advanceCount: 5,
        comparableControlPoolCount: 7,
        selectedControlCount: 5,
        blindedItemCount: 10,
      });
      expect(blindPacket.items).toHaveLength(10);
      expect(JSON.stringify(blindPacket)).not.toContain('"group"');
      expect(resultTemplate.items.every((entry: { outcome: string }) => entry.outcome === "missing")).toBe(true);
      expect(result.summary.effectivenessConclusion).toBe("screening_effectiveness_not_validated");
      expect(result.summary.externalWebsiteAccessed).toBe(false);
      expect(result.summary.stage2FieldsConsumed).toBe(false);
    },
  );
});
