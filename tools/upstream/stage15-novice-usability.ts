import { stableHash } from "../../lib/upstream/pipeline";
import type { NoviceMarketScreeningRun } from "./novice-market-screening";

const PROTOCOL_SCHEMA = "stage15-novice-usability-protocol.v1" as const;
const WORKSHEET_SCHEMA = "stage15-novice-usability-worksheet.v1" as const;

export type Stage15NoviceUsabilityResponse = {
  schemaVersion: "stage15-novice-usability-response.v1";
  selectedBlindItemIds: string[];
  itemExplanations: Array<{
    blindItemId: string;
    mainReason: string;
    nextValidation: string;
    killCriterion: string;
  }>;
  advanceMeaningAnswer: "investigation_quota_only" | "quality_approved" | "profitability_proven" | "missing";
  canDistinguishFourStatuses: "yes" | "no" | "uncertain" | "missing";
  elapsedSeconds: number | null;
  interruptionOccurred: "yes" | "no" | "missing";
  note: string | null;
};

type Stage15NoviceUsabilityProtocol = {
  schemaVersion: typeof PROTOCOL_SCHEMA;
  status: "engineering_ready_pending_real_user_session";
  sourceScreeningHash: string;
  sourceInputHash: string;
  createdAt: string;
  previewRoute: "/opportunities/screening-preview";
  expectedAdvanceCount: 5;
  expectedAdvanceBlindItemIds: string[];
  knownBlindItemIds: string[];
  taskDefinition: {
    identifyShortlist: "find_the_five_advance_items";
    explainEach: readonly ["main_reason", "next_validation", "kill_criterion"];
    boundaryQuestion: "what_does_advance_mean";
    fourStatusQuestion: "can_distinguish_advance_watch_reject_insufficient";
    elapsedTimeRecordedDescriptively: true;
    elapsedTimePassThreshold: null;
  };
  passCriteria: {
    exactAdvanceSetRequired: true;
    fiveCompleteExplanationsRequired: true;
    advanceMeaningRequired: "investigation_quota_only";
    fourStatusesAnswerRequired: "yes";
    positiveElapsedSecondsRequired: true;
    timeSavingClaimAllowed: false;
  };
  validates: readonly string[];
  doesNotValidate: readonly string[];
  stage2FieldsConsumed: false;
  externalWebsiteAccessed: false;
  externalAiApiCalled: false;
  productionDatabaseWritten: false;
  protocolHash: string;
};

type Stage15NoviceUsabilityWorksheet = {
  schemaVersion: typeof WORKSHEET_SCHEMA;
  status: "pending_user_input";
  sourceProtocolHash: string;
  previewRoute: "/opportunities/screening-preview";
  instructions: string[];
  allowedAnswers: {
    advanceMeaning: string[];
    ternary: string[];
  };
  response: Stage15NoviceUsabilityResponse;
  worksheetHash: string;
};

function withoutHash<T extends Record<string, unknown>, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function verifyScreeningRun(run: NoviceMarketScreeningRun) {
  if (run.schemaVersion !== "novice-market-screening-run.v1") {
    throw new Error("STAGE15_USABILITY_SOURCE_SCHEMA_INVALID");
  }
  if (stableHash(withoutHash(run, "screeningHash")) !== run.screeningHash) {
    throw new Error("STAGE15_USABILITY_SOURCE_HASH_INVALID");
  }
  if (run.summary.advance !== 5) throw new Error("STAGE15_USABILITY_ADVANCE_COUNT_INVALID");
  const blindIds = run.items.map((item) => item.rawHumanAnswer.blindItemId);
  if (blindIds.some((id) => !id) || new Set(blindIds).size !== run.items.length) {
    throw new Error("STAGE15_USABILITY_BLIND_BINDING_INVALID");
  }
}

export function buildStage15NoviceUsabilityMaterials(run: NoviceMarketScreeningRun, createdAt: string) {
  verifyScreeningRun(run);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) throw new Error("STAGE15_USABILITY_CREATED_AT_INVALID");
  const expectedAdvanceBlindItemIds = run.items
    .filter((item) => item.status === "advance")
    .sort((left, right) => (left.stage1Rank ?? Number.MAX_SAFE_INTEGER)
      - (right.stage1Rank ?? Number.MAX_SAFE_INTEGER)
      || left.productKey.localeCompare(right.productKey))
    .map((item) => item.rawHumanAnswer.blindItemId!);
  const knownBlindItemIds = run.items.map((item) => item.rawHumanAnswer.blindItemId!).sort();
  const protocolBody = {
    schemaVersion: PROTOCOL_SCHEMA,
    status: "engineering_ready_pending_real_user_session" as const,
    sourceScreeningHash: run.screeningHash,
    sourceInputHash: run.inputHash,
    createdAt,
    previewRoute: "/opportunities/screening-preview" as const,
    expectedAdvanceCount: 5 as const,
    expectedAdvanceBlindItemIds,
    knownBlindItemIds,
    taskDefinition: {
      identifyShortlist: "find_the_five_advance_items" as const,
      explainEach: ["main_reason", "next_validation", "kill_criterion"] as const,
      boundaryQuestion: "what_does_advance_mean" as const,
      fourStatusQuestion: "can_distinguish_advance_watch_reject_insufficient" as const,
      elapsedTimeRecordedDescriptively: true as const,
      elapsedTimePassThreshold: null,
    },
    passCriteria: {
      exactAdvanceSetRequired: true as const,
      fiveCompleteExplanationsRequired: true as const,
      advanceMeaningRequired: "investigation_quota_only" as const,
      fourStatusesAnswerRequired: "yes" as const,
      positiveElapsedSecondsRequired: true as const,
      timeSavingClaimAllowed: false as const,
    },
    validates: ["novice_comprehension", "local_preview_operability", "boundary_understanding"] as const,
    doesNotValidate: [
      "screening_effectiveness",
      "time_saving_without_comparable_baseline",
      "profitability",
      "supplier_logistics_or_compliance",
      "commercial_candidate_readiness",
    ] as const,
    stage2FieldsConsumed: false as const,
    externalWebsiteAccessed: false as const,
    externalAiApiCalled: false as const,
    productionDatabaseWritten: false as const,
  };
  const protocol = { ...protocolBody, protocolHash: stableHash(protocolBody) };
  const blankResponse: Stage15NoviceUsabilityResponse = {
    schemaVersion: "stage15-novice-usability-response.v1",
    selectedBlindItemIds: [],
    itemExplanations: [],
    advanceMeaningAnswer: "missing",
    canDistinguishFourStatuses: "missing",
    elapsedSeconds: null,
    interruptionOccurred: "missing",
    note: null,
  };
  const worksheetBody = {
    schemaVersion: WORKSHEET_SCHEMA,
    status: "pending_user_input" as const,
    sourceProtocolHash: protocol.protocolHash,
    previewRoute: protocol.previewRoute,
    instructions: [
      "打开本地调查短名单预览，不打开协议答案文件",
      "找到5个优先调查商品并记录页面上的blindItemId",
      "为每条写主要原因、下一步验证和停止条件",
      "回答advance含义与四态区分问题",
      "记录实际耗时及是否被中断",
    ],
    allowedAnswers: {
      advanceMeaning: ["investigation_quota_only", "quality_approved", "profitability_proven", "missing"],
      ternary: ["yes", "no", "uncertain", "missing"],
    },
    response: blankResponse,
  };
  const worksheet = { ...worksheetBody, worksheetHash: stableHash(worksheetBody) };
  const resultTemplate = evaluateStage15NoviceUsability(protocol, worksheet, blankResponse);
  return { protocol, worksheet, resultTemplate };
}

function textComplete(value: string) {
  return value.trim().length > 0 && value.trim().length <= 500;
}

export function evaluateStage15NoviceUsability(
  protocol: Stage15NoviceUsabilityProtocol,
  worksheet: Stage15NoviceUsabilityWorksheet,
  response: Stage15NoviceUsabilityResponse,
) {
  if (stableHash(withoutHash(protocol, "protocolHash")) !== protocol.protocolHash) {
    throw new Error("STAGE15_USABILITY_PROTOCOL_HASH_INVALID");
  }
  if (stableHash(withoutHash(worksheet, "worksheetHash")) !== worksheet.worksheetHash
    || worksheet.sourceProtocolHash !== protocol.protocolHash) {
    throw new Error("STAGE15_USABILITY_WORKSHEET_HASH_INVALID");
  }
  if (response.schemaVersion !== "stage15-novice-usability-response.v1") {
    throw new Error("STAGE15_USABILITY_RESPONSE_SCHEMA_INVALID");
  }
  const selectedIds = response.selectedBlindItemIds;
  if (selectedIds.length > protocol.expectedAdvanceCount
    || new Set(selectedIds).size !== selectedIds.length
    || selectedIds.some((id) => !protocol.knownBlindItemIds.includes(id))) {
    throw new Error("STAGE15_USABILITY_SELECTED_IDS_INVALID");
  }
  const explanationIds = response.itemExplanations.map((item) => item.blindItemId);
  if (new Set(explanationIds).size !== explanationIds.length
    || explanationIds.some((id) => !selectedIds.includes(id))) {
    throw new Error("STAGE15_USABILITY_EXPLANATION_BINDING_INVALID");
  }
  for (const explanation of response.itemExplanations) {
    if (!textComplete(explanation.mainReason)
      || !textComplete(explanation.nextValidation)
      || !textComplete(explanation.killCriterion)) {
      throw new Error("STAGE15_USABILITY_EXPLANATION_INVALID");
    }
  }
  const elapsedValid = typeof response.elapsedSeconds === "number"
    && Number.isFinite(response.elapsedSeconds)
    && response.elapsedSeconds > 0;
  const responseComplete = selectedIds.length === protocol.expectedAdvanceCount
    && response.itemExplanations.length === protocol.expectedAdvanceCount
    && response.advanceMeaningAnswer !== "missing"
    && response.canDistinguishFourStatuses !== "missing"
    && response.interruptionOccurred !== "missing"
    && elapsedValid;
  const expected = new Set(protocol.expectedAdvanceBlindItemIds);
  const selected = new Set(selectedIds);
  const identifiedAdvanceCount = selectedIds.filter((id) => expected.has(id)).length;
  const falseSelectionCount = selectedIds.filter((id) => !expected.has(id)).length;
  const missingAdvanceCount = protocol.expectedAdvanceBlindItemIds.filter((id) => !selected.has(id)).length;
  const explanationCompleteCount = response.itemExplanations.filter((item) =>
    textComplete(item.mainReason) && textComplete(item.nextValidation) && textComplete(item.killCriterion)).length;
  const boundaryUnderstood = response.advanceMeaningAnswer === protocol.passCriteria.advanceMeaningRequired;
  const fourStatusesUnderstood = response.canDistinguishFourStatuses === protocol.passCriteria.fourStatusesAnswerRequired;
  const exactAdvanceSet = identifiedAdvanceCount === protocol.expectedAdvanceCount
    && falseSelectionCount === 0
    && missingAdvanceCount === 0;
  const passed = responseComplete
    && exactAdvanceSet
    && explanationCompleteCount === protocol.expectedAdvanceCount
    && boundaryUnderstood
    && fourStatusesUnderstood;
  const reasonCodes = responseComplete
    ? [
        exactAdvanceSet ? null : "shortlist_identification_incorrect",
        explanationCompleteCount === protocol.expectedAdvanceCount ? null : "explanations_incomplete",
        boundaryUnderstood ? null : "advance_boundary_misunderstood",
        fourStatusesUnderstood ? null : "four_statuses_not_understood",
      ].filter((reason): reason is string => reason !== null)
    : ["manual_user_input_incomplete"];
  const manualUserInputObserved = selectedIds.length > 0
    || response.itemExplanations.length > 0
    || response.advanceMeaningAnswer !== "missing"
    || response.canDistinguishFourStatuses !== "missing"
    || response.elapsedSeconds !== null
    || response.interruptionOccurred !== "missing"
    || Boolean(response.note?.trim());
  const body = {
    schemaVersion: "stage15-novice-usability-result.v1" as const,
    sourceProtocolHash: protocol.protocolHash,
    sourceWorksheetHash: worksheet.worksheetHash,
    status: responseComplete ? (passed ? "passed" as const : "needs_revision" as const) : "pending_user_input" as const,
    rawResponse: response,
    metrics: {
      identifiedAdvanceCount,
      falseSelectionCount,
      missingAdvanceCount,
      explanationCompleteCount,
      boundaryUnderstood,
      fourStatusesUnderstood,
      elapsedSeconds: elapsedValid ? response.elapsedSeconds : null,
      interruptionOccurred: response.interruptionOccurred,
    },
    reasonCodes,
    manualUserInputObserved,
    usabilityConclusion: responseComplete
      ? passed
        ? "novice_comprehension_and_operability_observed" as const
        : "novice_comprehension_needs_revision" as const
      : "novice_usability_not_executed" as const,
    timeSavingConclusion: "not_validated_without_comparable_baseline" as const,
    effectivenessConclusion: "screening_effectiveness_not_validated" as const,
    stage2FieldsConsumed: false as const,
    externalWebsiteAccessed: false as const,
    externalAiApiCalled: false as const,
    formalCandidateGenerated: false as const,
    productionDatabaseWritten: false as const,
  };
  return { ...body, resultHash: stableHash(body) };
}
