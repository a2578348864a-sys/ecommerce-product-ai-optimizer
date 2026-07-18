import { stableHash } from "../../lib/upstream/pipeline";

type JsonRecord = Record<string, unknown>;

export type Stage15EffectivenessHumanEvaluationInput = {
  brief: JsonRecord;
  run: JsonRecord;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function withoutHash(value: JsonRecord, key: string) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function verifyHash(value: JsonRecord, key: string, errorCode: string) {
  if (stringValue(value[key]) === null || stableHash(withoutHash(value, key)) !== value[key]) {
    throw new Error(errorCode);
  }
}

function requiredRecord(value: unknown, errorCode: string): JsonRecord {
  if (!isRecord(value)) throw new Error(errorCode);
  return value;
}

function requiredArray(value: unknown, errorCode: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(errorCode);
  return value;
}

function field<T>(value: T, missingReason: unknown, fallback: string) {
  const present = Array.isArray(value) ? value.length > 0 : stringValue(value) !== null;
  return {
    value,
    missingReason: present ? null : stringValue(missingReason) ?? fallback,
  };
}

function verifySource(input: Stage15EffectivenessHumanEvaluationInput) {
  const brief = requiredRecord(input.brief, "STAGE15_HUMAN_EVALUATION_BRIEF_INVALID");
  const run = requiredRecord(input.run, "STAGE15_HUMAN_EVALUATION_RUN_INVALID");
  if (brief.schemaVersion !== "stage15-effectiveness-revalidation-brief.v1") {
    throw new Error("STAGE15_HUMAN_EVALUATION_BRIEF_INVALID");
  }
  if (run.schemaVersion !== "stage15-effectiveness-revalidation-run.v1"
    || run.status !== "evidence_collected_pending_human_evaluation"
    || run.proofLevel !== "real_public_product_detail_evidence_only") {
    throw new Error("STAGE15_HUMAN_EVALUATION_RUN_INVALID");
  }
  if (run.briefId !== brief.briefId || run.briefHash !== brief.briefHash) {
    throw new Error("STAGE15_HUMAN_EVALUATION_BRIEF_BINDING_INVALID");
  }
  const navigationBudget = requiredRecord(run.navigationBudget, "STAGE15_HUMAN_EVALUATION_NAVIGATION_BUDGET_INVALID");
  if (navigationBudget.maximum !== 10 || navigationBudget.used !== 10
    || navigationBudget.productDetailNavigations !== 10
    || navigationBudget.searchNavigations !== 0 || navigationBudget.retries !== 0) {
    throw new Error("STAGE15_HUMAN_EVALUATION_NAVIGATION_BUDGET_INVALID");
  }

  const targets = requiredArray(brief.targets, "STAGE15_HUMAN_EVALUATION_TARGET_PARTITION_INVALID");
  const pages = requiredArray(run.pages, "STAGE15_HUMAN_EVALUATION_PAGE_PARTITION_INVALID");
  if (targets.length !== 10 || pages.length !== 10 || run.evidenceCount !== 10) {
    throw new Error("STAGE15_HUMAN_EVALUATION_PAGE_PARTITION_INVALID");
  }
  const targetIds = targets.map((value) => requiredRecord(value, "STAGE15_HUMAN_EVALUATION_TARGET_PARTITION_INVALID").pilotItemId);
  const pageIds = pages.map((value) => requiredRecord(value, "STAGE15_HUMAN_EVALUATION_PAGE_PARTITION_INVALID").pilotItemId);
  if (new Set(targetIds).size !== 10 || new Set(pageIds).size !== 10
    || targetIds.some((id) => typeof id !== "string" || !pageIds.includes(id))) {
    throw new Error("STAGE15_HUMAN_EVALUATION_PAGE_PARTITION_INVALID");
  }
  for (const rawPage of pages) {
    const page = requiredRecord(rawPage, "STAGE15_HUMAN_EVALUATION_PAGE_INVALID");
    const gate = requiredRecord(page.gate, "STAGE15_HUMAN_EVALUATION_PAGE_GATE_INVALID");
    const evidence = requiredRecord(page.productEvidence, "STAGE15_HUMAN_EVALUATION_PRODUCT_EVIDENCE_INVALID");
    const diagnostic = requiredRecord(page.pageDiagnostic, "STAGE15_HUMAN_EVALUATION_PAGE_DIAGNOSTIC_INVALID");
    if (gate.status !== "passed" || gate.errorCode !== null || arrayValue(gate.reasonCodes).length !== 0) {
      throw new Error("STAGE15_HUMAN_EVALUATION_PAGE_GATE_INVALID");
    }
    if (evidence.identityConfirmed !== true) throw new Error("STAGE15_HUMAN_EVALUATION_IDENTITY_INVALID");
    if (diagnostic.classification !== "amazon_normal") {
      throw new Error("STAGE15_HUMAN_EVALUATION_PAGE_DIAGNOSTIC_INVALID");
    }
  }
  const cleanup = requiredRecord(run.cleanup, "STAGE15_HUMAN_EVALUATION_CLEANUP_INVALID");
  if (cleanup.pageClosed !== true || cleanup.browserClosed !== true || cleanup.forcedTerminationUsed !== false
    || cleanup.debugPortReleased !== true || cleanup.profileRemoved !== true || cleanup.browserProcessBaselineRestored !== true) {
    throw new Error("STAGE15_HUMAN_EVALUATION_CLEANUP_INVALID");
  }
  if (run.realWebsiteAccessed !== true || run.stage1OrStage15Mutated !== false || run.stage2FieldsConsumed !== false
    || run.candidateGenerated !== false || run.databaseWritten !== false
    || run.externalAiOrPaidApiCalled !== false) {
    throw new Error("STAGE15_HUMAN_EVALUATION_SOURCE_BOUNDARY_INVALID");
  }
  verifyHash(brief, "briefHash", "STAGE15_HUMAN_EVALUATION_BRIEF_HASH_INVALID");
  for (const rawPage of pages) {
    const page = rawPage as JsonRecord;
    const diagnostic = page.pageDiagnostic as JsonRecord;
    verifyHash(diagnostic, "evidenceHash", "STAGE15_HUMAN_EVALUATION_DIAGNOSTIC_HASH_INVALID");
    verifyHash(page, "evidenceHash", "STAGE15_HUMAN_EVALUATION_PAGE_HASH_INVALID");
  }
  verifyHash(run, "evidenceHash", "STAGE15_HUMAN_EVALUATION_RUN_HASH_INVALID");
  return { brief, run, targets, pages };
}

export function buildStage15EffectivenessHumanEvaluation(input: Stage15EffectivenessHumanEvaluationInput) {
  const { brief, run, targets, pages } = verifySource(input);
  const pageByPilotId = new Map(pages.map((rawPage) => {
    const page = rawPage as JsonRecord;
    return [page.pilotItemId as string, page];
  }));
  const items = targets.map((rawTarget) => {
    const target = rawTarget as JsonRecord;
    const page = pageByPilotId.get(target.pilotItemId as string)!;
    if (page.runId !== run.runId || page.briefId !== brief.briefId) {
      throw new Error("STAGE15_HUMAN_EVALUATION_PAGE_BINDING_INVALID");
    }
    const requestedUrl = requiredRecord(page.requestedUrl, "STAGE15_HUMAN_EVALUATION_PAGE_BINDING_INVALID");
    const finalUrl = requiredRecord(page.finalUrl, "STAGE15_HUMAN_EVALUATION_PAGE_BINDING_INVALID");
    if (requestedUrl.origin !== target.origin || requestedUrl.path !== target.safePath
      || finalUrl.origin !== target.origin || finalUrl.path !== target.safePath) {
      throw new Error("STAGE15_HUMAN_EVALUATION_PAGE_BINDING_INVALID");
    }
    const evidence = page.productEvidence as JsonRecord;
    const missing = requiredRecord(evidence.missingReasons, "STAGE15_HUMAN_EVALUATION_PRODUCT_EVIDENCE_INVALID");
    const evaluationItemId = `evaluation-${stableHash({
      schemaVersion: "stage15-effectiveness-human-evaluation-item.v1",
      runEvidenceHash: run.evidenceHash,
      pageEvidenceHash: page.evidenceHash,
    }).slice(0, 20)}`;
    const itemBody = {
      schemaVersion: "stage15-effectiveness-human-evaluation-item.v1" as const,
      evaluationItemId,
      evidence: {
        sourceType: "direct_observation" as const,
        capturedAt: page.capturedAt,
        title: field(stringValue(evidence.title), null, "title_not_visible"),
        variantText: field(stringValue(evidence.variantText), missing.variantText, "variant_not_visible"),
        dimensionsAndWeight: field(arrayValue(evidence.dimensionsAndWeight), missing.dimensionsAndWeight, "dimensions_or_weight_not_visible"),
        materialAndConstruction: field(arrayValue(evidence.materialAndConstruction), missing.materialAndConstruction, "material_or_construction_not_visible"),
        assemblyUsageAndRiskFacts: field(arrayValue(evidence.assemblyUsageAndRiskFacts), missing.assemblyUsageAndRiskFacts, "assembly_usage_or_capacity_not_visible"),
        featureBullets: field(arrayValue<string>(evidence.featureBullets), null, "feature_bullets_not_visible"),
        reviewSnippets: field(arrayValue<string>(evidence.reviewSnippets), missing.reviewSnippets, "counter_evidence_not_visible"),
      },
      evaluation: {
        allowedWorthFurtherInvestigation: ["yes", "no", "insufficient_evidence"] as const,
        allowedEvidenceSufficient: ["yes", "no"] as const,
        allowedConfidence: ["high", "medium", "low"] as const,
        answers: {
          worthFurtherInvestigation: null,
          evidenceSufficient: null,
          obviousStopReason: null,
          confidence: null,
          reason: null,
        },
      },
      sourceEvidenceHash: page.evidenceHash,
    };
    return { ...itemBody, itemHash: stableHash(itemBody) };
  }).sort((left, right) => stableHash({ runEvidenceHash: run.evidenceHash, evaluationItemId: left.evaluationItemId })
    .localeCompare(stableHash({ runEvidenceHash: run.evidenceHash, evaluationItemId: right.evaluationItemId }))
    || left.evaluationItemId.localeCompare(right.evaluationItemId));

  const coverage = (key: "dimensionsAndWeight" | "materialAndConstruction" | "assemblyUsageAndRiskFacts" | "reviewSnippets") =>
    items.filter((item) => item.evidence[key].missingReason === null).length;
  const packetBody = {
    schemaVersion: "stage15-effectiveness-human-evaluation-packet.v1" as const,
    status: "pending_human_evaluation" as const,
    proofLevel: "real_public_evidence_blinded_for_human_evaluation" as const,
    sourceBriefHash: brief.briefHash,
    sourceRunEvidenceHash: run.evidenceHash,
    reviewerBoundary: {
      groupAssignmentHidden: true as const,
      stage1RankAndScoreHidden: true as const,
      stage1AndStage15StatusHidden: true as const,
      lockedHumanAnswersHidden: true as const,
      sourceIdentifiersHidden: true as const,
      stage2FieldsHidden: true as const,
    },
    evidenceCoverage: {
      itemCount: items.length,
      dimensionsAndWeightPresent: coverage("dimensionsAndWeight"),
      materialAndConstructionPresent: coverage("materialAndConstruction"),
      assemblyUsageAndRiskFactsPresent: coverage("assemblyUsageAndRiskFacts"),
      reviewSnippetsPresent: coverage("reviewSnippets"),
      evaluationMustAllowInsufficientEvidence: true as const,
    },
    items,
    outcomeAutoDecisionGenerated: false as const,
    stage1OrStage15Mutated: false as const,
    stage2FieldsConsumed: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalWebsiteAccessed: false as const,
    externalAiOrPaidApiCalled: false as const,
    effectivenessConclusion: "screening_effectiveness_not_validated" as const,
  };
  const packet = { ...packetBody, packetHash: stableHash(packetBody) };
  const resultBody = {
    schemaVersion: "stage15-effectiveness-human-evaluation-result-template.v1" as const,
    status: "pending_human_evaluation" as const,
    sourcePacketHash: packet.packetHash,
    items: items.map((item) => ({
      evaluationItemId: item.evaluationItemId,
      answers: { ...item.evaluation.answers },
    })),
    metrics: {
      worthFurtherInvestigationYesCount: null,
      worthFurtherInvestigationNoCount: null,
      insufficientEvidenceCount: null,
      evidenceSufficientYesCount: null,
    },
    outcomeAutoDecisionGenerated: false as const,
    effectivenessConclusion: "screening_effectiveness_not_validated" as const,
  };
  const resultTemplate = { ...resultBody, evidenceHash: stableHash(resultBody) };
  return { packet, resultTemplate };
}
