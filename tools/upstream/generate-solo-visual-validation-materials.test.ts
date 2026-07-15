import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BlindReviewMaterialInput, NoviceVisualPresentationInput } from "./solo-validation-materials";
import { generateSoloVisualValidationMaterials } from "./generate-solo-visual-validation-materials";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

function sha256(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}

function fixtureFiles() {
  const root = mkdtempSync(join(tmpdir(), "solo-visual-materials-"));
  temporaryDirectories.push(root);
  const outputDirectory = join(root, "04-视觉盲评V2");
  const imageDirectory = join(root, "01-新手盲评-先填写", "商品图");
  mkdirSync(imageDirectory, { recursive: true });
  const imageContent = Buffer.from("public-product-image-fixture");
  const imageRelativePath = "01-新手盲评-先填写/商品图/blind-item-01.jpg";
  writeFileSync(join(imageDirectory, "blind-item-01.jpg"), imageContent);

  const blindReview: BlindReviewMaterialInput = {
    schemaVersion: "blind-review-material.v1",
    blindReviewId: "blind-test",
    criteria: ["是否值得继续调查"],
    items: [{
      blindItemId: "blind-test-01",
      candidateId: "candidate-internal",
      evidenceSnapshotId: "evidence-internal",
      title: "Test storage product",
      sourceUrl: "https://www.amazon.com/dp/TESTASIN01",
      capturedAt: "2026-07-14T00:00:00.000Z",
      evidence: { price: 20, rating: 4.5, reviewCount: 100, missingEvidence: [] },
    }],
  };
  const presentation: NoviceVisualPresentationInput = {
    schemaVersion: "solo-novice-visual-presentation-input.v1",
    sourceBlindReviewId: blindReview.blindReviewId,
    sourceVisualEvidenceHash: "source-visual-evidence-hash",
    items: [{
      blindItemId: "blind-test-01",
      image: {
        imageUrl: "https://m.media-amazon.com/images/I/test.jpg",
        sourceType: "direct_observation",
        capturedAt: "2026-07-14T00:00:00.000Z",
        missingReason: null,
        localAsset: {
          status: "available",
          relativePath: imageRelativePath,
          contentSha256: sha256(imageContent),
          bytes: imageContent.length,
          missingReason: null,
        },
      },
      chinesePresentation: {
        productTypeZh: "测试收纳商品",
        primaryUseZh: "用于整理衣物。",
        sourceType: "ai_generated",
        status: "presentation_aid_not_source_fact",
        basedOnFields: ["title"],
      },
    }],
  };
  const blindReviewFile = join(root, "stage1-blind-review-material.v1.json");
  const presentationFile = join(root, "novice-visual-presentation-input.v1.json");
  writeFileSync(blindReviewFile, JSON.stringify(blindReview), "utf8");
  writeFileSync(presentationFile, JSON.stringify(presentation), "utf8");
  return { root, outputDirectory, blindReviewFile, presentationFile, presentation };
}

describe("solo visual validation material generator", () => {
  it("writes only separate V2 materials and validates local image bytes and hash", () => {
    const fixture = fixtureFiles();
    const lockedV1 = join(fixture.root, "novice-blind-review-responses.v1.json");
    writeFileSync(lockedV1, "LOCKED_V1_RESPONSE", "utf8");
    const before = sha256(readFileSync(lockedV1));

    const result = generateSoloVisualValidationMaterials({
      blindReviewFile: fixture.blindReviewFile,
      presentationFile: fixture.presentationFile,
      assetRootDirectory: fixture.root,
      outputDirectory: fixture.outputDirectory,
    });

    expect(result.files).toEqual([
      "novice-visual-blind-review-packet.v2.json",
      "README-视觉盲评说明.md",
      "generation-summary.v2.json",
    ]);
    expect(result.visualSummary).toMatchObject({ localImageAvailableCount: 1, reviewReadiness: "ready" });
    expect(sha256(readFileSync(lockedV1))).toBe(before);
    const packet = JSON.parse(readFileSync(join(fixture.outputDirectory, result.files[0]), "utf8"));
    expect(packet.schemaVersion).toBe("solo-novice-visual-blind-review-packet.v2");
  });

  it("fails closed when an available local image does not match declared evidence", () => {
    const fixture = fixtureFiles();
    fixture.presentation.items[0].image.localAsset.contentSha256 = "f".repeat(64);
    writeFileSync(fixture.presentationFile, JSON.stringify(fixture.presentation), "utf8");

    expect(() => generateSoloVisualValidationMaterials({
      blindReviewFile: fixture.blindReviewFile,
      presentationFile: fixture.presentationFile,
      assetRootDirectory: fixture.root,
      outputDirectory: fixture.outputDirectory,
    })).toThrow("VISUAL_LOCAL_ASSET_MISMATCH");
  });

  it("rejects a local image path that escapes the declared asset root", () => {
    const fixture = fixtureFiles();
    fixture.presentation.items[0].image.localAsset.relativePath = "../outside.jpg";
    writeFileSync(fixture.presentationFile, JSON.stringify(fixture.presentation), "utf8");

    expect(() => generateSoloVisualValidationMaterials({
      blindReviewFile: fixture.blindReviewFile,
      presentationFile: fixture.presentationFile,
      assetRootDirectory: fixture.root,
      outputDirectory: fixture.outputDirectory,
    })).toThrow("VISUAL_LOCAL_ASSET_PATH_INVALID");
  });
});
