import { describe, expect, it } from "vitest";
import { generateSoloValidationMaterials } from "./generate-solo-validation-materials";

const rankingFile = process.env.SOLO_VALIDATION_RANKING_FILE;
const blindReviewFile = process.env.SOLO_VALIDATION_BLIND_REVIEW_FILE;
const outputDirectory = process.env.SOLO_VALIDATION_OUTPUT_DIRECTORY;

describe("solo validation material generator", () => {
  it.runIf(Boolean(rankingFile && blindReviewFile && outputDirectory))(
    "generates the novice-first packet and sealed Stage 2 packet through one code path",
    () => {
      const result = generateSoloValidationMaterials({
        rankingFile: rankingFile!,
        blindReviewFile: blindReviewFile!,
        outputDirectory: outputDirectory!,
      });
      expect(result.files).toEqual([
        "01-新手盲评-先填写/novice-blind-review-packet.v1.json",
        "01-新手盲评-先填写/README-怎么开始.md",
        "02-盲评完成后再打开/stage2-objective-calibration-packet.v1.json",
        "02-盲评完成后再打开/README-客观取证清单.md",
        "generation-summary.v1.json",
      ]);
      expect(result.noviceItemCount).toBe(20);
      expect(result.stage2SampleCount).toBe(7);
    },
  );
});
