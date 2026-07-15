import { describe, expect, it } from "vitest";
import fixture from "../../lib/upstream/fixtures/amazon-us-closet-organizer.v1.json";
import { buildFixturePipeline } from "../../lib/upstream/pipeline";
import {
  buildPhase2AcceptanceReport,
  phase2AcceptanceReportHashIsValid,
} from "./phase2-acceptance";

function validInput() {
  return {
    sourceRunSchemaVersion: "human-assisted-amazon-run.v2",
    sourceInputHash: "a".repeat(64),
    sourceEvidenceHash: "b".repeat(64),
    evaluatedAt: "2026-07-14T16:00:00.000Z",
    pipeline: buildFixturePipeline(fixture),
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
  } as const;
}

describe("Phase 2 acceptance report", () => {
  it("rebuilds identity, Evidence and Quality deterministically at the declared proof level", () => {
    const report = buildPhase2AcceptanceReport(validInput());

    expect(report.status).toBe("passed");
    expect(report.proofLevel).toBe("pure_function_fixture_real_package_in_memory");
    expect(report.counts).toMatchObject({
      rawObservationCount: fixture.observations.length,
      uniqueProductCount: 6,
      quarantinedCount: 1,
      importPreviewCandidateCount: 6,
    });
    expect(report.criteria).toMatchObject({
      contextQualityPassed: true,
      layoutQualityPassed: true,
      deterministicPipelineReplayMatched: true,
      storedPipelineMatchesReplay: true,
      identityCountsConsistent: true,
      evidenceTraceabilityComplete: true,
      evidenceFreshnessExplicit: true,
      formalCandidateNotGenerated: true,
      productionDatabaseNotWritten: true,
    });
    expect(report.excludedProof).toEqual([
      "api_integration",
      "database_transaction",
      "database_concurrency",
      "owner_visitor_authorization",
      "id_guessing_protection",
    ]);
    expect(phase2AcceptanceReportHashIsValid(report)).toBe(true);
  });

  it("fails closed when the stored pipeline no longer matches the replayed source facts", () => {
    const input = structuredClone(validInput());
    (input.pipeline.importPackage.candidates[0].evidenceSnapshot.product.title as unknown as { value: string }).value = "tampered";

    const report = buildPhase2AcceptanceReport(input);

    expect(report.status).toBe("failed");
    expect(report.criteria.storedPipelineMatchesReplay).toBe(false);
    expect(report.reasonCodes).toContain("stored_pipeline_replay_mismatch");
  });

  it("fails closed when Candidate/Evidence traceability is broken", () => {
    const input = structuredClone(validInput());
    input.pipeline.importPackage.candidates[0].minimumEvidencePack.evidenceSnapshotId = "wrong-evidence";

    const report = buildPhase2AcceptanceReport(input);

    expect(report.status).toBe("failed");
    expect(report.criteria.evidenceTraceabilityComplete).toBe(false);
    expect(report.reasonCodes).toContain("evidence_traceability_incomplete");
  });

  it("does not describe a run that generated a formal Candidate or wrote a database as Phase 2 passed", () => {
    const input = { ...validInput(), formalCandidateGenerated: true, productionDatabaseWritten: true };
    const report = buildPhase2AcceptanceReport(input);

    expect(report.status).toBe("failed");
    expect(report.reasonCodes).toEqual(expect.arrayContaining([
      "formal_candidate_generated",
      "production_database_written",
    ]));
  });

  it("binds report evidence fields into its hash", () => {
    const report = buildPhase2AcceptanceReport(validInput());
    const changed = structuredClone(report);
    changed.counts.rawObservationCount += 1;

    expect(phase2AcceptanceReportHashIsValid(changed)).toBe(false);
  });
});
