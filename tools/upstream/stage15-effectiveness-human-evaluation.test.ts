import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { buildStage15EffectivenessHumanEvaluation } from "./stage15-effectiveness-human-evaluation";

function hashed<T extends Record<string, unknown>>(body: T, key: "briefHash" | "evidenceHash") {
  return { ...body, [key]: stableHash(body) };
}

function source() {
  const brief = hashed({
    schemaVersion: "stage15-effectiveness-revalidation-brief.v1",
    briefId: "brief-01",
    sourceProtocolHash: "protocol-secret-group-map",
    sourceBlindPacketHash: "blind-secret",
    targets: Array.from({ length: 10 }, (_, index) => ({
      pilotItemId: `pilot-${index + 1}`,
      origin: "https://www.amazon.com",
      safePath: `/dp/B${String(index + 1).padStart(9, "0")}`,
      sourceUrlHash: `url-${index + 1}`,
    })),
  }, "briefHash");
  const pages = brief.targets.map((target, index) => {
    const diagnosticBody = {
      schemaVersion: "amazon-page-diagnostic.v2",
      classification: "amazon_normal",
      classificationReasonCodes: ["required_markers_present"],
    };
    const body = {
      schemaVersion: "stage15-effectiveness-product-evidence.v1",
      runId: "run-01",
      briefId: brief.briefId,
      pilotItemId: target.pilotItemId,
      expectedAsin: target.safePath.slice(-10),
      sourceType: "direct_observation",
      capturedAt: `2026-07-16T12:${String(index).padStart(2, "0")}:00.000Z`,
      requestedUrl: { origin: target.origin, path: target.safePath },
      finalUrl: { origin: target.origin, path: target.safePath },
      pageDiagnostic: { ...diagnosticBody, evidenceHash: stableHash(diagnosticBody) },
      gate: { status: "passed", errorCode: null, reasonCodes: [] },
      productEvidence: {
        observedAsin: target.safePath.slice(-10),
        identityConfirmed: true,
        title: `Product ${index + 1}`,
        variantText: null,
        dimensionsAndWeight: index === 0 ? [{ label: "Size", value: "30 cm" }] : [],
        materialAndConstruction: [],
        assemblyUsageAndRiskFacts: [],
        featureBullets: [`Feature ${index + 1}`],
        reviewSnippets: [],
        markerCounts: { title: 1, detailRows: 0, featureBullets: 1, reviewSnippets: 0 },
        missingReasons: {
          variantText: "variant_not_visible",
          dimensionsAndWeight: index === 0 ? null : "dimensions_or_weight_not_visible",
          materialAndConstruction: "material_or_construction_not_visible",
          assemblyUsageAndRiskFacts: "assembly_usage_or_capacity_not_visible",
          reviewSnippets: "counter_evidence_not_visible",
        },
      },
    };
    return { ...body, evidenceHash: stableHash(body) };
  });
  const runBody = {
    schemaVersion: "stage15-effectiveness-revalidation-run.v1",
    runId: "run-01",
    proofLevel: "real_public_product_detail_evidence_only",
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    authorizationEvidenceHash: "authorization-hash",
    capturedAt: "2026-07-16T12:30:00.000Z",
    status: "evidence_collected_pending_human_evaluation",
    errorCode: null,
    reasonCodes: [],
    realWebsiteAccessed: true,
    navigationBudget: { maximum: 10, used: 10, productDetailNavigations: 10, searchNavigations: 0, retries: 0 },
    evidenceCount: 10,
    pages,
    stage1OrStage15Mutated: false,
    stage2FieldsConsumed: false,
    candidateGenerated: false,
    databaseWritten: false,
    externalAiOrPaidApiCalled: false,
    cleanup: {
      pageClosed: true,
      browserClosed: true,
      forcedTerminationUsed: false,
      debugPortReleased: true,
      profileRemoved: true,
      browserProcessBaselineRestored: true,
    },
  };
  return { brief, run: { ...runBody, evidenceHash: stableHash(runBody) } };
}

describe("Stage 1.5 blinded human evaluation material", () => {
  it("builds ten deterministic items without group, ASIN, rank, locked answers, or Stage 2 leakage", () => {
    const input = source();
    const first = buildStage15EffectivenessHumanEvaluation(input);
    const second = buildStage15EffectivenessHumanEvaluation(input);

    expect(first).toEqual(second);
    expect(first.packet.items).toHaveLength(10);
    expect(new Set(first.packet.items.map((item) => item.evaluationItemId)).size).toBe(10);
    const serialized = JSON.stringify({ items: first.packet.items, resultTemplate: first.resultTemplate });
    for (const forbidden of ["pilotItemId", "expectedAsin", "observedAsin", "sourceProtocolHash", "sourceBlindPacketHash", "group", "productKey", "lockedHuman", "profit", "supplier", "logisticsCost"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(first.packet.items.every((item) => !("stage1Rank" in item))).toBe(true);
    expect(first.packet.items.every((item) => !("stage1Score" in item))).toBe(true);
    expect(first.packet.outcomeAutoDecisionGenerated).toBe(false);
    expect(first.packet.effectivenessConclusion).toBe("screening_effectiveness_not_validated");
  });

  it("preserves missing reasons and leaves every human answer null with an insufficient-evidence option", () => {
    const result = buildStage15EffectivenessHumanEvaluation(source());
    expect(result.packet.items[0].evaluation.allowedWorthFurtherInvestigation).toContain("insufficient_evidence");
    expect(result.packet.items.every((item) => Object.values(item.evaluation.answers).every((value) => value === null))).toBe(true);
    expect(result.packet.items.some((item) => item.evidence.dimensionsAndWeight.missingReason === "dimensions_or_weight_not_visible")).toBe(true);
    expect(result.packet.items.every((item) => item.evidence.reviewSnippets.missingReason === "counter_evidence_not_visible")).toBe(true);
  });

  it("describes the exact blinded boundary without claiming that product identity is absent", () => {
    const boundary = buildStage15EffectivenessHumanEvaluation(source()).packet.reviewerBoundary;
    expect(boundary).toMatchObject({ sourceIdentifiersHidden: true });
    expect("productIdentityHidden" in boundary).toBe(false);
  });


  it("binds all source evidence into hashes and changes when evidence changes", () => {
    const input = source();
    const first = buildStage15EffectivenessHumanEvaluation(input);
    const changed = source();
    changed.run.pages[0].productEvidence.featureBullets[0] = "Changed feature";
    const page = changed.run.pages[0];
    const { evidenceHash: _pageHash, ...pageBody } = page;
    page.evidenceHash = stableHash(pageBody);
    const { evidenceHash: _runHash, ...runBody } = changed.run;
    changed.run.evidenceHash = stableHash(runBody);
    const second = buildStage15EffectivenessHumanEvaluation(changed);

    expect(second.packet.packetHash).not.toBe(first.packet.packetHash);
    expect(second.resultTemplate.evidenceHash).not.toBe(first.resultTemplate.evidenceHash);
  });

  it.each([
    ["brief hash mismatch", (input: ReturnType<typeof source>) => { input.run.briefHash = "wrong"; }, "STAGE15_HUMAN_EVALUATION_BRIEF_BINDING_INVALID"],
    ["page count", (input: ReturnType<typeof source>) => { input.run.pages.pop(); }, "STAGE15_HUMAN_EVALUATION_PAGE_PARTITION_INVALID"],
    ["failed gate", (input: ReturnType<typeof source>) => { input.run.pages[0].gate.status = "failed"; }, "STAGE15_HUMAN_EVALUATION_PAGE_GATE_INVALID"],
    ["search navigation budget", (input: ReturnType<typeof source>) => { input.run.navigationBudget.searchNavigations = 1; }, "STAGE15_HUMAN_EVALUATION_NAVIGATION_BUDGET_INVALID"],
    ["retry budget", (input: ReturnType<typeof source>) => { input.run.navigationBudget.retries = 1; }, "STAGE15_HUMAN_EVALUATION_NAVIGATION_BUDGET_INVALID"],
    ["website access proof", (input: ReturnType<typeof source>) => { input.run.realWebsiteAccessed = false; }, "STAGE15_HUMAN_EVALUATION_SOURCE_BOUNDARY_INVALID"],
    ["forced termination", (input: ReturnType<typeof source>) => { input.run.cleanup.forcedTerminationUsed = true; }, "STAGE15_HUMAN_EVALUATION_CLEANUP_INVALID"],
    ["cleanup", (input: ReturnType<typeof source>) => { input.run.cleanup.profileRemoved = false; }, "STAGE15_HUMAN_EVALUATION_CLEANUP_INVALID"],
  ])("fails closed for %s", (_name, mutate, code) => {
    const input = source();
    mutate(input);
    expect(() => buildStage15EffectivenessHumanEvaluation(input)).toThrow(code);
  });
});
