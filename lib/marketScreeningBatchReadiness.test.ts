import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadMarketScreeningBatchManifest } from "@/lib/marketScreeningBatchManifest";
import {
  determineMarketScreeningBatchReadiness,
  type ArtifactValidationState,
} from "@/lib/marketScreeningBatchReadiness";

function realManifest() {
  const result = loadMarketScreeningBatchManifest({
    environment: "development",
    projectMaterialsRoot: resolve(process.cwd(), ".."),
  });
  if (result.status !== "ready") throw new Error(result.errorCode);
  return result.manifest;
}

function states(defaultState: ArtifactValidationState = "verified") {
  return Object.fromEntries(realManifest().artifacts.map((artifact) => [artifact.key, defaultState]));
}

function input(artifactStates = states()) {
  return {
    manifest: realManifest(),
    artifactStates,
    successfulSourceIds: ["human_assisted_amazon"],
    failedSourceIds: [] as string[],
    pendingSourceIds: [] as string[],
    includedSourceBatchIds: ["source-batch-4e6574b31b375cc2af96b971"],
    acceptedUniqueProductCount: 20,
    stage1InputCount: 20,
    stage15PartitionCount: 20,
  };
}

describe("determineMarketScreeningBatchReadiness", () => {
  it("returns ready_full for the complete trusted batch", () => {
    expect(determineMarketScreeningBatchReadiness(input())).toMatchObject({
      status: "ready_full",
      optionalDetailStatus: "verified",
      reasonCodes: [],
    });
  });

  it.each([
    ["stage1Ranking", "stage_artifact_not_ready"],
    ["visualPacket", "presentation_artifact_not_ready"],
  ] as const)("returns upstream_only when %s is genuinely absent", (key, reason) => {
    const artifactStates = states();
    artifactStates[key] = "missing";
    expect(determineMarketScreeningBatchReadiness(input(artifactStates))).toMatchObject({
      status: "upstream_only",
      reasonCodes: [reason],
    });
  });

  it("blocks a missing upstream artifact", () => {
    const artifactStates = states();
    artifactStates.selectionBrief = "missing";
    expect(determineMarketScreeningBatchReadiness(input(artifactStates))).toMatchObject({
      status: "blocked",
      reasonCodes: ["upstream_artifact_missing"],
    });
  });

  it("blocks when a required source is not in the verified successful set", () => {
    expect(determineMarketScreeningBatchReadiness({
      ...input(),
      successfulSourceIds: [],
    })).toMatchObject({
      status: "blocked",
      reasonCodes: ["required_source_failed"],
    });
  });

  it.each([
    ["path_invalid", "artifact_path_invalid"],
    ["hash_mismatch", "artifact_hash_mismatch"],
    ["schema_invalid", "artifact_schema_invalid"],
    ["identity_conflict", "artifact_identity_conflict"],
  ] as const)("blocks a present contradictory artifact: %s", (state, reason) => {
    const artifactStates = states();
    artifactStates.stage15Run = state;
    expect(determineMarketScreeningBatchReadiness(input(artifactStates))).toMatchObject({
      status: "blocked",
      reasonCodes: [reason],
    });
  });

  it("omits a partially missing optional detail group without downgrading trusted core", () => {
    const artifactStates = states();
    artifactStates.detailRun = "missing";
    expect(determineMarketScreeningBatchReadiness(input(artifactStates))).toMatchObject({
      status: "ready_full",
      optionalDetailStatus: "incomplete_omitted",
      reasonCodes: ["detail_evidence_group_incomplete"],
    });
  });

  it("returns ready_partial only when every partial-source gate passes", () => {
    const manifest = {
      ...realManifest(),
      sourcePolicy: {
        ...realManifest().sourcePolicy,
        optionalSourceIds: ["optional_source"],
        allowStageOutputsWhenPartial: true,
      },
    };
    const result = determineMarketScreeningBatchReadiness({
      ...input(),
      manifest,
      failedSourceIds: ["optional_source"],
    });
    expect(result.status).toBe("ready_partial");
  });

  it("blocks partial data when source batch sets only overlap instead of matching exactly", () => {
    expect(determineMarketScreeningBatchReadiness({
      ...input(),
      includedSourceBatchIds: ["source-batch-4e6574b31b375cc2af96b971", "unexpected-batch"],
      failedSourceIds: ["optional_source"],
      manifest: {
        ...realManifest(),
        sourcePolicy: {
          ...realManifest().sourcePolicy,
          optionalSourceIds: ["optional_source"],
          allowStageOutputsWhenPartial: true,
        },
      },
    })).toMatchObject({
      status: "blocked",
      reasonCodes: ["partial_source_gate_failed"],
    });
  });

  it.each([
    ["acceptedUniqueProductCount", { acceptedUniqueProductCount: 19 }],
    ["stage1InputCount", { stage1InputCount: 19 }],
    ["stage15PartitionCount", { stage15PartitionCount: 19 }],
  ])("blocks a frozen count drift: %s", (_name, override) => {
    expect(determineMarketScreeningBatchReadiness({
      ...input(),
      ...override,
    })).toMatchObject({
      status: "blocked",
      reasonCodes: ["partial_source_gate_failed"],
    });
  });
});
