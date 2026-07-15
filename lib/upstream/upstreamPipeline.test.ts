import { describe, expect, it } from "vitest";
import fixture from "./fixtures/amazon-us-closet-organizer.v1.json";
import {
  buildFixturePipeline,
  buildCollectionRunContentHash,
  buildImportPackageHash,
  canonicalizeAmazonProductUrl,
  detectLayoutChange,
} from "./pipeline";
import { InMemoryImportStore, importApprovedPackage, revokeImportBatch } from "./importService";
import { buildBlindReviewMaterial, calibrateStage2, rankStage1 } from "./ranking";
import { buildFixtureArtifacts, buildNonAuthoritativeCanaryEvidence } from "./artifacts";
import type { ImportPackage } from "./contracts";

function finalizeTestPackage(pkg: ImportPackage): ImportPackage {
  pkg.importPackageHash = buildImportPackageHash(pkg);
  pkg.importIdempotencyKey = `import:${pkg.importPackageHash}`;
  return pkg;
}

describe("upstream fixture pipeline", () => {
  it("binds requested and observed market evidence plus sampled IDs into the collection hash", () => {
    const base = buildCollectionRunContentHash(fixture.run, fixture.observations);
    const mutations = [
      { ...fixture.run, requested: { ...fixture.run.requested, marketplace: "amazon.co.jp" } },
      { ...fixture.run, requested: { ...fixture.run.requested, market: "JP" } },
      { ...fixture.run, requested: { ...fixture.run.requested, currency: "JPY" } },
      { ...fixture.run, observed: { ...fixture.run.observed, marketplace: "amazon.co.jp" } },
      { ...fixture.run, observed: { ...fixture.run.observed, market: "JP" } },
      { ...fixture.run, observed: { ...fixture.run.observed, currency: "JPY" } },
      { ...fixture.run, observed: { ...fixture.run.observed, deliveryRegion: "Japan" } },
      { ...fixture.run, observed: { ...fixture.run.observed, deliveryRegionMarket: "JP" } },
      { ...fixture.run, observed: { ...fixture.run.observed, language: "ja-jp" } },
      { ...fixture.run, sampledObservationIds: fixture.run.sampledObservationIds.slice(1) },
    ];
    expect(mutations.every((run) => buildCollectionRunContentHash(run, fixture.observations) !== base)).toBe(true);
  });

  it("fails closed when sampled product currency conflicts even if page-wide diagnostics look healthy", () => {
    const conflicted = structuredClone(fixture);
    conflicted.run.diagnosticVisiblePriceNodeCount = 60;
    conflicted.observations[0].priceCurrency = "JPY";
    expect(() => buildFixturePipeline(conflicted)).toThrow(/conflicting_values/);
  });

  it.each([
    ["marketplace unknown", { observed: { ...fixture.run.observed, marketplace: null } }],
    ["market conflict", { observed: { ...fixture.run.observed, market: "JP" } }],
    ["currency unknown", { observed: { ...fixture.run.observed, currency: null } }],
    ["delivery market conflict", { observed: { ...fixture.run.observed, deliveryRegionMarket: "JP" } }],
    ["language unknown", { observed: { ...fixture.run.observed, language: null } }],
    ["login wall", { pageStatus: "login_wall" }],
    ["error page", { pageStatus: "error_page" }],
    ["captcha", { pageStatus: "captcha" }],
    ["unknown page", { pageStatus: "unknown_page" }],
  ])("fails closed for %s", (_label, runPatch) => {
    const input = structuredClone(fixture) as unknown as Record<string, unknown> & { run: Record<string, unknown> };
    input.run = { ...input.run, ...runPatch };
    expect(() => buildFixturePipeline(input)).toThrow();
  });

  it("normalizes URLs, preserves appearances, deduplicates products, and quarantines missing identity", () => {
    expect(canonicalizeAmazonProductUrl("https://www.amazon.com/dp/B0FIX00001?tag=x#detail"))
      .toBe("https://www.amazon.com/dp/B0FIX00001");

    const result = buildFixturePipeline(fixture);
    expect(result.rawObservationCount).toBe(8);
    expect(result.uniqueProductCount).toBe(6);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].qualityGate.errorCodes).toContain("missing_identity");

    const duplicatedProduct = result.importPackage.candidates.find((item) => item.productKey.endsWith("B0FIX00001"));
    expect(duplicatedProduct?.appearanceKeys).toEqual([
      "appearance-p1-01-sponsored",
      "appearance-p1-05-organic",
    ]);
    expect(duplicatedProduct?.appearances).toEqual([
      { appearanceKey: "appearance-p1-01-sponsored", sponsored: true },
      { appearanceKey: "appearance-p1-05-organic", sponsored: false },
    ]);
    expect(duplicatedProduct?.evidenceSnapshot.sourceTypes).toContain("direct_observation");
    expect(duplicatedProduct?.evidenceSnapshot.capturedAt).toBe(fixture.run.capturedAt);
    expect(duplicatedProduct?.minimumEvidencePack.importBatchId).toBe(result.importPackage.importBatchId);
  });

  it("uses null plus reasons and keeps insufficient evidence out of normal scoring", () => {
    const result = buildFixturePipeline(fixture);
    const missing = result.importPackage.candidates.find((item) => item.productKey.endsWith("B0FIX00004"));
    expect(missing?.evidenceSnapshot.product.rating.normalizedValue).toBeNull();
    expect(missing?.evidenceSnapshot.product.rating.missingReason).toBe("not_visible");

    const ranking = rankStage1(result.importPackage, fixture.brief.createdAt);
    expect(ranking.results.find((item) => item.productKey.endsWith("B0FIX00004"))?.promotionDecision)
      .toBe("insufficient_evidence");
  });

  it("stops a batch when layout metrics materially fall below the fixture baseline", () => {
    const gate = detectLayoutChange({
      rawCardCount: 20,
      requestedSampleLimit: 5,
      expectedSampleCount: 5,
      extractedObservationCount: 5,
      samplingCoverage: { observedCount: 5, denominator: 5, ratio: 1, missingReason: null },
      identitySuccessCount: 3,
      priceVisibleCount: 2,
      ratingVisibleCount: 2,
      reviewVisibleCount: 2,
      sponsoredKnownCount: 0,
      quarantinedCount: 17,
      uniqueProductCount: 3,
      keyContainerFound: true,
      blockedPage: false,
    });
    expect(gate.status).toBe("failed");
    expect(gate.errorCodes).toContain("suspected_layout_change");
  });

  it("imports idempotently across runs without changing an abandoned decision or linked task", () => {
    const store = new InMemoryImportStore();
    const firstPackage = buildFixturePipeline(fixture).importPackage;
    const first = importApprovedPackage(store, "owner:local", firstPackage);
    const repeated = importApprovedPackage(store, "owner:local", firstPackage);
    expect(first.createdCandidates).toBe(6);
    expect(repeated).toEqual({ ...first, reusedExistingResult: true });
    expect(store.snapshot("owner:local").candidates).toHaveLength(6);

    const abandonedKey = firstPackage.candidates[0].productKey;
    store.setHumanState("owner:local", abandonedKey, "abandoned", "task-existing");
    const nextRunPackage = finalizeTestPackage({
      ...firstPackage,
      collectionRunId: "run-fixture-amazon-us-closet-organizer-v2",
      importBatchId: "batch-fixture-next-run",
      candidates: firstPackage.candidates.slice(0, 1).map((candidate) => ({
        ...candidate,
        importBatchId: "batch-fixture-next-run",
        evidenceSnapshot: {
          ...candidate.evidenceSnapshot,
          evidenceSnapshotId: `${candidate.evidenceSnapshot.evidenceSnapshotId}-next-run`,
          collectionRunId: "run-fixture-amazon-us-closet-organizer-v2",
          importBatchId: "batch-fixture-next-run",
        },
        minimumEvidencePack: {
          ...candidate.minimumEvidencePack,
          evidenceSnapshotId: `${candidate.evidenceSnapshot.evidenceSnapshotId}-next-run`,
          importBatchId: "batch-fixture-next-run",
        },
      })),
    });
    const next = importApprovedPackage(store, "owner:local", nextRunPackage);
    expect(next.createdCandidates).toBe(0);
    expect(next.createdEvidence).toBe(1);
    const preserved = store.snapshot("owner:local").candidates.find((item) => item.productKey === abandonedKey);
    expect(preserved?.status).toBe("abandoned");
    expect(preserved?.linkedTaskId).toBe("task-existing");
    expect(preserved?.newEvidenceNotice).toBe(true);
  });

  it("keeps named in-memory namespaces separate without claiming authorization", () => {
    const store = new InMemoryImportStore();
    const pkg = buildFixturePipeline(fixture).importPackage;
    importApprovedPackage(store, "owner:local", pkg);
    expect(store.snapshot("visitor:demo-a").candidates).toHaveLength(0);
    expect(() => store.snapshot("visitor:demo-a").evidence[0].evidenceSnapshotId).toThrow();
    expect(revokeImportBatch(store, "owner:local", pkg.importBatchId).status).toBe("revoked");

    const visitorPackage = finalizeTestPackage({
      ...pkg,
      importBatchId: "batch-visitor",
      candidates: pkg.candidates.map((candidate) => ({
        ...candidate,
        importBatchId: "batch-visitor",
        evidenceSnapshot: { ...candidate.evidenceSnapshot, importBatchId: "batch-visitor" },
        minimumEvidencePack: { ...candidate.minimumEvidencePack, importBatchId: "batch-visitor" },
      })),
    });
    importApprovedPackage(store, "visitor:demo-a", visitorPackage);
    store.setHumanState("visitor:demo-a", visitorPackage.candidates[0].productKey, "promoted", "visitor-task");
    expect(revokeImportBatch(store, "visitor:demo-a", "batch-visitor").status).toBe("source_invalidated");
  });

  it("keeps stored evidence immutable from input and snapshot references", () => {
    const store = new InMemoryImportStore();
    const pkg = structuredClone(buildFixturePipeline(fixture).importPackage);
    const originalTitle = pkg.candidates[0].evidenceSnapshot.product.title.rawValue;
    importApprovedPackage(store, "namespace-a", pkg);

    pkg.candidates[0].evidenceSnapshot.product.title.rawValue = "mutated input";
    const firstSnapshot = store.snapshot("namespace-a");
    expect(firstSnapshot.evidence[0].product.title.rawValue).toBe(originalTitle);

    firstSnapshot.evidence[0].product.title.rawValue = "mutated snapshot";
    expect(store.snapshot("namespace-a").evidence[0].product.title.rawValue).toBe(originalTitle);
  });

  it("rejects an invalid package atomically without partial candidates, evidence, or import result", () => {
    const store = new InMemoryImportStore();
    const pkg = structuredClone(buildFixturePipeline(fixture).importPackage);
    pkg.candidates.push({
      ...structuredClone(pkg.candidates[0]),
      candidateId: "candidate-malformed",
      productKey: "amazon:US:B0BROKEN01",
    });
    finalizeTestPackage(pkg);

    expect(() => importApprovedPackage(store, "namespace-a", pkg)).toThrow("IMPORT_CANDIDATE_EVIDENCE_MISMATCH");
    expect(store.snapshot("namespace-a")).toEqual({ candidates: [], evidence: [], importResults: [] });
  });

  it("rejects a content-tampered package by hash before any in-memory mutation", () => {
    const store = new InMemoryImportStore();
    const pkg = structuredClone(buildFixturePipeline(fixture).importPackage);
    pkg.candidates[0].evidenceSnapshot.product.title.rawValue = "tampered after preview";

    expect(() => importApprovedPackage(store, "namespace-a", pkg)).toThrow("IMPORT_PACKAGE_HASH_MISMATCH");
    expect(store.snapshot("namespace-a")).toEqual({ candidates: [], evidence: [], importResults: [] });
  });

  it("revokes only the selected batch and preserves candidate evidence from another batch", () => {
    const store = new InMemoryImportStore();
    const firstPackage = structuredClone(buildFixturePipeline(fixture).importPackage);
    firstPackage.candidates = firstPackage.candidates.slice(0, 1);
    finalizeTestPackage(firstPackage);
    importApprovedPackage(store, "namespace-a", firstPackage);

    const secondPackage = structuredClone(firstPackage);
    secondPackage.collectionRunId = "run-second";
    secondPackage.importBatchId = "batch-second";
    secondPackage.candidates[0].importBatchId = "batch-second";
    secondPackage.candidates[0].evidenceSnapshot.importBatchId = "batch-second";
    secondPackage.candidates[0].evidenceSnapshot.collectionRunId = "run-second";
    secondPackage.candidates[0].evidenceSnapshot.evidenceSnapshotId = "evidence-second";
    secondPackage.candidates[0].minimumEvidencePack.evidenceSnapshotId = "evidence-second";
    secondPackage.candidates[0].minimumEvidencePack.importBatchId = "batch-second";
    finalizeTestPackage(secondPackage);
    importApprovedPackage(store, "namespace-a", secondPackage);

    expect(revokeImportBatch(store, "namespace-a", "batch-second").status).toBe("revoked");
    const snapshot = store.snapshot("namespace-a");
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0].evidenceLinks).toEqual([
      { evidenceSnapshotId: firstPackage.candidates[0].evidenceSnapshot.evidenceSnapshotId, importBatchId: firstPackage.importBatchId },
    ]);
    expect(snapshot.evidence.map((item) => item.evidenceSnapshotId)).toEqual([
      firstPackage.candidates[0].evidenceSnapshot.evidenceSnapshotId,
    ]);
  });

  it("ranks deterministically after hard gates and produces blind-review material without judgments", () => {
    const pkg = buildFixturePipeline(fixture).importPackage;
    const first = rankStage1(pkg, fixture.brief.createdAt);
    const second = rankStage1(pkg, fixture.brief.createdAt);
    expect(second).toEqual(first);
    expect(first.results.find((item) => item.productKey.endsWith("B0FIX00005"))?.promotionDecision).toBe("rejected");
    expect(first.results.find((item) => item.productKey.endsWith("B0FIX00005"))?.hardGateResult.passed).toBe(false);
    expect(first.results.every((item) => item.nextValidationPlan.length > 0 && item.killCriteria.length > 0)).toBe(true);

    const blind = buildBlindReviewMaterial(pkg, "blind-fixture-v1");
    expect(blind.items).toHaveLength(pkg.candidates.length);
    expect(blind.items.every((item) => !("score" in item) && !("rank" in item) && !("humanDecision" in item))).toBe(true);
    expect(blind.criteria).toContain("是否值得进一步调查");
  });

  it("scores organic, sponsored, and unknown placement states without parsing appearance keys", () => {
    const base = structuredClone(buildFixturePipeline(fixture).importPackage);
    const candidate = base.candidates.find((item) => item.productKey.endsWith("B0FIX00003"));
    expect(candidate).toBeDefined();
    if (!candidate) return;

    const scoreFor = (sponsored: boolean | null) => {
      const pkg = {
        ...base,
        candidates: [{
          ...structuredClone(candidate),
          appearanceKeys: ["placement-without-semantic-name"],
          appearances: [{ appearanceKey: "placement-without-semantic-name", sponsored }],
        }],
      };
      return rankStage1(pkg, fixture.brief.createdAt).results[0].componentScores.placementDiversity;
    };

    expect(scoreFor(false)).toBe(25);
    expect(scoreFor(true)).toBe(10);
    expect(scoreFor(null)).toBe(0);
  });

  it("chooses a family leader only after minimum evidence and hard gates", () => {
    const base = structuredClone(buildFixturePipeline(fixture).importPackage);
    const blocked = base.candidates.find((item) => item.productKey.endsWith("B0FIX00005"));
    const valid = base.candidates.find((item) => item.productKey.endsWith("B0FIX00003"));
    expect(blocked && valid).toBeTruthy();
    if (!blocked || !valid) return;
    blocked.variantGroupKey = "amazon:US:FAMILY-GATE";
    blocked.evidenceSnapshot.product.variantGroupKey = blocked.variantGroupKey;
    valid.variantGroupKey = "amazon:US:FAMILY-GATE";
    valid.evidenceSnapshot.product.variantGroupKey = valid.variantGroupKey;

    const ranking = rankStage1({ ...base, candidates: [blocked, valid] }, fixture.brief.createdAt);
    const validResult = ranking.results.find((item) => item.productKey === valid.productKey);
    expect(validResult?.totalScore).not.toBeNull();
    expect(validResult?.counterEvidence.some((item) => item.includes("family") || item.includes("家族"))).toBe(false);
  });

  it("returns insufficient evidence for incomplete Stage 2 inputs and calculates transparent scenarios when complete", () => {
    const insufficient = calibrateStage2({
      candidateId: "candidate-fixture",
      currency: "USD",
      salePrice: 29.99,
      bom: null,
      firstMile: null,
      platformCommission: null,
      fba: null,
      packaging: null,
      storage: null,
      returnReserve: null,
    });
    expect(insufficient.status).toBe("profit_insufficient_evidence");
    expect(insufficient.missingInputs).toContain("bom");

    const complete = calibrateStage2({
      candidateId: "candidate-fixture",
      currency: "USD",
      salePrice: 30,
      bom: 6,
      firstMile: 2,
      platformCommission: 4.5,
      fba: 5,
      packaging: 1,
      storage: 0.5,
      returnReserve: 1,
    });
    expect(complete.status).toBe("calculated");
    expect(complete.normalContributionMargin).toBe(10);
    expect(complete.breakEvenAcos).toBeCloseTo(1 / 3, 5);
  });

  it.each([
    ["zero sale price", { salePrice: 0 }, "salePrice"],
    ["negative sale price", { salePrice: -1 }, "salePrice"],
    ["non-finite sale price", { salePrice: Number.POSITIVE_INFINITY }, "salePrice"],
    ["negative unit cost", { bom: -1 }, "bom"],
    ["non-finite unit cost", { fba: Number.NaN }, "fba"],
  ])("fails closed for %s instead of emitting pseudo-precise profit", (_label, override, expectedInput) => {
    const result = calibrateStage2({
      candidateId: "candidate-invalid-fixture",
      currency: "USD",
      salePrice: 30,
      bom: 6,
      firstMile: 2,
      platformCommission: 4.5,
      fba: 5,
      packaging: 1,
      storage: 0.5,
      returnReserve: 1,
      ...override,
    });

    expect(result.status).toBe("profit_insufficient_evidence");
    expect(result.missingInputs).toContain(expectedInput);
    expect(result.normalContributionMargin).toBeNull();
    expect(result.stressContributionMargin).toBeNull();
    expect(result.breakEvenAcos).toBeNull();
  });

  it("builds reproducible Stage 1, blind review, and four-bucket Stage 2 materials without fabricated inputs", () => {
    const artifacts = buildFixtureArtifacts(fixture);
    expect(artifacts.stage1).toEqual(rankStage1(artifacts.pipeline.importPackage, fixture.brief.createdAt));
    expect(artifacts.blindReview.items.every((item) => !("score" in item))).toBe(true);
    expect(artifacts.stage2Calibration.map((item) => item.sampleBucket)).toEqual([
      "high_rank",
      "middle_rank",
      "low_rank",
      "insufficient_evidence",
    ]);
    expect(artifacts.stage2Calibration.every((item) => item.calibration.status === "profit_insufficient_evidence"))
      .toBe(true);
    expect(artifacts.canaryEvidence).toMatchObject({
      schemaVersion: "amazon-public-page-canary-evidence.v2",
      evidenceAuthority: "offline_fixture",
      qualityGate: { status: "passed" },
      formalCandidateGenerated: false,
      productionDatabaseWritten: false,
    });
  });

  it("downgrades legacy live Canary files into the unified non-authoritative schema", () => {
    const downgraded = buildNonAuthoritativeCanaryEvidence({
      schemaVersion: "amazon-usd-canary-run.v1",
      capturedAt: "2026-07-14T01:23:33.778Z",
      request: { marketplace: "amazon.com", market: "US", currency: "USD" },
      observation: {
        marketplace: "amazon.com",
        market: "US",
        currency: "USD",
        deliveryRegion: "New York 10001",
        language: "en-us",
      },
      observations: [{ appearanceKey: "legacy-1", priceText: "$29.99" }],
    });
    expect(downgraded).toMatchObject({
      schemaVersion: "amazon-public-page-canary-evidence.v2",
      evidenceAuthority: "non_authoritative_canary_evidence",
      historicalSchemaVersion: "amazon-usd-canary-run.v1",
      qualityGate: {
        status: "failed",
        errorCodes: ["requires_live_recollection"],
      },
    });
  });
});
