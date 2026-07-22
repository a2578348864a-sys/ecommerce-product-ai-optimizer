import { TEST_PROJECT_MATERIALS_ROOT } from "../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "@/lib/upstream/pipeline";
import {
  buildStage15ScreeningPreview,
  Stage15ScreeningPreviewError,
  type Stage15PreviewImageInput,
} from "@/lib/stage15ScreeningPreview";

const projectRoot = TEST_PROJECT_MATERIALS_ROOT;
const screeningDirectory = resolve(
  projectRoot,
  "06_测试与验证",
  "2026-07-15-Phase-Stage1.5-Novice-Screening-01",
);
const visualDirectory = resolve(
  projectRoot,
  "06_测试与验证",
  "2026-07-14-Phase-Stage1-Solo-Validation-01",
  "04-视觉盲评V2",
);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function realInputs() {
  const screeningRun = readJson(resolve(screeningDirectory, "novice-market-screening-run.v1.json"));
  const acceptance = readJson(resolve(screeningDirectory, "novice-market-screening-acceptance.v1.json"));
  const generationSummary = readJson(resolve(
    screeningDirectory,
    "generation-summary.novice-market-screening.v1.json",
  ));
  const visualPacket = readJson(resolve(visualDirectory, "novice-visual-blind-review-packet.v2.json"));
  const packetItems = (visualPacket as { items: Array<{
    blindItemId: string;
    image: { localAsset: { status: "available" | "not_cached" } };
  }> }).items;
  const localImages = Object.fromEntries(packetItems.map((item): [string, Stage15PreviewImageInput] => [
    item.blindItemId,
    item.image.localAsset.status === "available"
      ? { status: "available", dataUrl: "data:image/jpeg;base64,/9j/2Q==", reason: null }
      : { status: "image_not_cached", dataUrl: null, reason: "image_not_cached" },
  ]));
  return { screeningRun, acceptance, generationSummary, visualPacket, localImages };
}

function expectPreviewError(action: () => unknown, code: string) {
  try {
    action();
    throw new Error("EXPECTED_PREVIEW_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(Stage15ScreeningPreviewError);
    expect((error as Stage15ScreeningPreviewError).code).toBe(code);
  }
}

describe("buildStage15ScreeningPreview", () => {
  it("projects the locked 20-item run without writes, Stage 2 fields, or remote image URLs", () => {
    const input = realInputs();
    const before = JSON.stringify(input);

    const preview = buildStage15ScreeningPreview(input);

    expect(preview.schemaVersion).toBe("stage1-5-screening-preview-view.v1");
    expect(preview.proofLevel).toBe("local_read_only_artifact_projection");
    expect(preview.displayName).toBe("调查短名单预览");
    expect(preview.summary).toEqual({ advance: 5, watch: 11, reject: 3, insufficient: 1 });
    expect(preview.items).toHaveLength(20);
    expect(preview.items.filter((item) => item.image.status === "available")).toHaveLength(11);
    expect(preview.items.filter((item) => item.image.status === "image_not_cached")).toHaveLength(9);
    expect(preview.readOnly).toBe(true);
    expect(preview.formalCandidateGenerated).toBe(false);
    expect(preview.productionDatabaseWritten).toBe(false);
    expect(preview.externalNetworkRequired).toBe(false);
    expect(preview.effectivenessConclusion).toBe("screening_effectiveness_not_validated");
    expect(preview.advanceMeaning).toBe("top_k_investigation_quota_not_quality_or_commercial_approval");

    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain("m.media-amazon.com");
    expect(serialized).not.toContain("stage2");
    expect(serialized).not.toContain("supplier");
    expect(serialized).not.toContain("profit");
    expect(serialized).not.toContain("candidateId");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("fails closed when a runtime schema is unknown", () => {
    const input = realInputs();
    (input.screeningRun as { schemaVersion: string }).schemaVersion = "novice-market-screening-run.v999";

    expectPreviewError(() => buildStage15ScreeningPreview(input), "preview_schema_invalid");
  });

  it("fails closed when a bound Hash changes", () => {
    const input = realInputs();
    (input.screeningRun as { summary: { advance: number } }).summary.advance += 1;

    expectPreviewError(() => buildStage15ScreeningPreview(input), "preview_hash_binding_invalid");
  });

  it("fails closed when the four-state partition is internally inconsistent", () => {
    const input = realInputs();
    const run = input.screeningRun as Record<string, unknown> & {
      summary: { advance: number };
      screeningHash: string;
    };
    run.summary.advance += 1;
    const { screeningHash: _screeningHash, ...runBody } = run;
    run.screeningHash = stableHash(runBody);

    const acceptance = input.acceptance as Record<string, unknown> & {
      sourceScreeningHash: string;
      evidenceHash: string;
    };
    acceptance.sourceScreeningHash = run.screeningHash;
    const { evidenceHash: _acceptanceEvidenceHash, ...acceptanceBody } = acceptance;
    acceptance.evidenceHash = stableHash(acceptanceBody);

    const summary = input.generationSummary as Record<string, unknown> & {
      screeningHash: string;
      acceptanceEvidenceHash: string;
      itemCounts: { advance: number };
      evidenceHash: string;
    };
    summary.screeningHash = run.screeningHash;
    summary.acceptanceEvidenceHash = acceptance.evidenceHash;
    summary.itemCounts.advance += 1;
    const { evidenceHash: _summaryEvidenceHash, ...summaryBody } = summary;
    summary.evidenceHash = stableHash(summaryBody);

    expectPreviewError(() => buildStage15ScreeningPreview(input), "preview_partition_invalid");
  });

  it("fails closed when a visual ASIN no longer matches the product identity", () => {
    const input = realInputs();
    const packet = input.visualPacket as Record<string, unknown> & {
      items: Array<{ sourceUrl: string }>;
      packetHash: string;
    };
    packet.items[0].sourceUrl = "https://www.amazon.com/dp/B000000000";
    const { packetHash: _packetHash, ...packetBody } = packet;
    packet.packetHash = stableHash(packetBody);

    expectPreviewError(() => buildStage15ScreeningPreview(input), "preview_product_identity_conflict");
  });

  it("fails closed instead of returning a partial list when a visual item is missing", () => {
    const input = realInputs();
    const packet = input.visualPacket as Record<string, unknown> & {
      items: Array<{ blindItemId: string }>;
      visualSummary: { totalItemCount: number };
      packetHash: string;
    };
    const removed = packet.items.pop();
    expect(removed).toBeDefined();
    packet.visualSummary.totalItemCount -= 1;
    const { packetHash: _packetHash, ...packetBody } = packet;
    packet.packetHash = stableHash(packetBody);

    expectPreviewError(() => buildStage15ScreeningPreview(input), "preview_visual_binding_invalid");
  });
});
