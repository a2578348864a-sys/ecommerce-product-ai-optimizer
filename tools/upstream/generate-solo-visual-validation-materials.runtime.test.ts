import { describe, expect, it } from "vitest";
import { generateSoloVisualValidationMaterials } from "./generate-solo-visual-validation-materials";

const blindReviewFile = process.env.SOLO_VISUAL_BLIND_REVIEW_FILE;
const presentationFile = process.env.SOLO_VISUAL_PRESENTATION_FILE;
const assetRootDirectory = process.env.SOLO_VISUAL_ASSET_ROOT_DIRECTORY;
const outputDirectory = process.env.SOLO_VISUAL_OUTPUT_DIRECTORY;

describe("solo visual validation material runtime generator", () => {
  it.runIf(Boolean(blindReviewFile && presentationFile && assetRootDirectory && outputDirectory))(
    "generates the current offline V2 visual packet without touching the locked V1 response",
    () => {
      const result = generateSoloVisualValidationMaterials({
        blindReviewFile: blindReviewFile!,
        presentationFile: presentationFile!,
        assetRootDirectory: assetRootDirectory!,
        outputDirectory: outputDirectory!,
      });
      expect(result.visualSummary).toEqual({
        totalItemCount: 20,
        localImageAvailableCount: 11,
        localImageCompleteness: 0.55,
        reviewReadiness: "incomplete_visual_evidence",
      });
    },
  );
});
