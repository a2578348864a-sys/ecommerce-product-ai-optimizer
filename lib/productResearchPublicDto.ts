import {
  PRODUCT_RESEARCH_RECORD_SCHEMA,
  parseProductResearchRecord,
  type ProductResearchDecisionEvent,
  type ProductResearchRecordV1,
} from "@/lib/productResearchRecord";
import { getProductResearchDecisionLabel } from "@/lib/productResearchDecisionContract";
import { deriveAgentNextStepPanelState } from "@/components/agentNextStepPanelModel";
import { deriveProductResearchPresentation } from "@/lib/productResearchPresentation";
import { derivePipelineStatus } from "@/lib/productPipeline";
import { deriveTaskOperationSummary } from "@/lib/taskOperationSummary";
import { deriveTaskWorkflowSummary, getTaskSourceMeta } from "@/lib/taskWorkflowSummary";
import { hasAiListingPack } from "@/lib/tasks/listingSnapshotUi";
import type { DecisionStatus } from "@/lib/tasks/decisionStatus";

export const PRODUCT_RESEARCH_HASH_FINGERPRINT_LENGTH = 12;

type JsonRecord = Record<string, unknown>;
type BrowserProjectionScope = "list" | "detail";
export type TaskListProjectionContext = {
  readonly id?: string;
  readonly type?: string | null;
  readonly title?: string | null;
  readonly materialText?: string | null;
  readonly oneLineSummary?: string | null;
  readonly level?: string | null;
  readonly decisionStatus?: DecisionStatus | null;
};
type ProjectionSpec =
  | { readonly kind: "scalar" }
  | { readonly kind: "array"; readonly item: ProjectionSpec }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, ProjectionSpec>> };

const scalar = { kind: "scalar" } as const satisfies ProjectionSpec;
const arrayOf = (item: ProjectionSpec): ProjectionSpec => ({ kind: "array", item });
const objectOf = (fields: Readonly<Record<string, ProjectionSpec>>): ProjectionSpec => ({ kind: "object", fields });
const stringList = arrayOf(scalar);

const evidenceSnapshotSpec = objectOf({
  sourceType: scalar,
  sourceName: scalar,
  sourceUrl: scalar,
  qualityScore: scalar,
  confidence: scalar,
  riskFlags: stringList,
  decision: scalar,
  decisionReason: scalar,
});

const sourceMetaSpec = objectOf({
  source: scalar,
  opportunityTitle: scalar,
  opportunitySource: scalar,
  keyword: scalar,
  importedAt: scalar,
  opportunityScore: scalar,
  candidateType: scalar,
  sourceUrl: scalar,
  from: scalar,
  entry: scalar,
  sourceTitle: scalar,
  originalName: scalar,
  analyzedName: scalar,
  evidenceSnapshot: evidenceSnapshotSpec,
});

const reviewStateSpec = objectOf({
  sourcingReviewed: scalar,
  riskReviewed: scalar,
  summaryReviewed: scalar,
  listingReviewed: scalar,
  reviewedCount: scalar,
  totalReviewSteps: scalar,
  allReviewed: scalar,
  confirmed: scalar,
  confirmedAt: scalar,
});

const finalReportSpec = objectOf({
  verdict: scalar,
  finalVerdict: scalar,
  decision: scalar,
  decisionReason: scalar,
  reason: scalar,
  recommendation: scalar,
  summary: scalar,
  riskLevel: scalar,
  beginnerFit: scalar,
  canTestSmallBatch: scalar,
  confidence: scalar,
  nextSteps: stringList,
});

const agentOutputSnapshotSpec = objectOf({
  version: scalar,
  generatedAt: scalar,
  candidateEvidence: evidenceSnapshotSpec,
  sourcingSnapshot: objectOf({
    supplierConclusion: scalar,
    sourceSignals: stringList,
    priceSignals: stringList,
    availabilitySignals: stringList,
    assumptions: stringList,
    missingInfo: stringList,
    confidence: scalar,
  }),
  riskSnapshot: objectOf({
    riskLevel: scalar,
    riskFlags: stringList,
    complianceConcerns: stringList,
    ipConcerns: stringList,
    logisticsConcerns: stringList,
    safetyConcerns: stringList,
    riskReason: scalar,
    needsManualReview: scalar,
  }),
  summarySnapshot: objectOf({
    decision: scalar,
    decisionReason: scalar,
    targetUser: scalar,
    sellingPoints: stringList,
    concerns: stringList,
    confidence: scalar,
  }),
  listingSnapshot: objectOf({
    titleDraft: scalar,
    bulletDrafts: stringList,
    keywordHints: stringList,
    descriptionDraft: scalar,
    imageIdeas: stringList,
    complianceNotes: stringList,
    missingInputs: stringList,
  }),
  nextActionSnapshot: objectOf({
    primaryAction: scalar,
    actionLabel: scalar,
    checklist: stringList,
    blockingIssues: stringList,
    suggestedOwnerStep: scalar,
  }),
  humanReviewSnapshot: objectOf({
    required: scalar,
    reasons: stringList,
    reviewFocus: stringList,
    defaultStatus: scalar,
  }),
  rawReportSummary: scalar,
  fallbackUsed: scalar,
  warnings: stringList,
});

const listingKeywordSpec = objectOf({ keyword: scalar, intent: scalar });
const listingRiskTermSpec = objectOf({ term: scalar, reason: scalar, saferAlternative: scalar });
const listingPackSpec = objectOf({
  titleDrafts: stringList,
  bulletPoints: stringList,
  coreKeywords: arrayOf(listingKeywordSpec),
  longTailKeywords: arrayOf(listingKeywordSpec),
  scenarioKeywords: arrayOf(listingKeywordSpec),
  audienceKeywords: arrayOf(listingKeywordSpec),
  featureKeywords: arrayOf(listingKeywordSpec),
  sellingPoints: stringList,
  targetAudience: stringList,
  imageRequirements: stringList,
  priceSuggestion: scalar,
  riskTerms: arrayOf(listingRiskTermSpec),
  prePublishChecklist: stringList,
  disclaimer: scalar,
  source: scalar,
  generatedAt: scalar,
});

/**
 * 创作交接最小安全投影（detail 作用域）。
 * 仅暴露用于"进度摘要"与"步骤高亮"的存在性信号，白名单字段：
 *   - currentRevision / controlState：判断 Handoff 已创建、生效中/已撤回
 *   - createdAt：展示"已创建"时间（浏览器不接触任何 Hash / 指纹 / 内部元数据）
 * 不投影 versions / confirmedFacts / sourceRef / actor 指纹 / 视觉参考等任何创作内容。
 */
const creativeHandoffSpec = objectOf({
  currentRevision: scalar,
  controlState: scalar,
  createdAt: scalar,
});

const aiListingPackSpec = objectOf({
  source: scalar,
  version: scalar,
  generatedAt: scalar,
  model: scalar,
  humanReviewRequired: scalar,
  titles: stringList,
  bullets: stringList,
  description: scalar,
  keywords: stringList,
  sellingPoints: stringList,
  riskNotes: stringList,
  complianceWarnings: stringList,
  blockedClaims: stringList,
  reviewChecklist: stringList,
  savedAt: scalar,
  savedBy: scalar,
  snapshotType: scalar,
});

const imageGenerationBasisSpec = objectOf({
  productName: scalar,
  listingTitle: scalar,
  sellingPoints: stringList,
  riskWarnings: stringList,
  missingFacts: stringList,
  imageMaterialNeeds: stringList,
});

const aiImageDraftSpec = objectOf({
  version: scalar,
  snapshotType: scalar,
  provider: scalar,
  humanReviewRequired: scalar,
  disclaimer: scalar,
  updatedAt: scalar,
  items: arrayOf(objectOf({
    id: scalar,
    imageType: scalar,
    model: scalar,
    createdAt: scalar,
    mimeType: scalar,
    requestedFormat: scalar,
    actualFormat: scalar,
    width: scalar,
    height: scalar,
    fileSizeBytes: scalar,
    reviewStatus: scalar,
    source: scalar,
    safetyWarnings: stringList,
    promptSummary: scalar,
    generationBasis: imageGenerationBasisSpec,
  })),
});

const productLifecycleSpec = objectOf({
  status: scalar,
  statusLabel: scalar,
  reasonCode: scalar,
  reasonText: scalar,
  updatedAt: scalar,
  updatedBy: scalar,
  source: scalar,
  history: arrayOf(objectOf({
    from: scalar,
    to: scalar,
    reasonCode: scalar,
    reasonText: scalar,
    at: scalar,
    by: scalar,
  })),
});

const profitSnapshotSpec = objectOf({
  source: scalar,
  createdAt: scalar,
  currency: scalar,
  note: scalar,
  decision: scalar,
  estimatedPurchasePrice: scalar,
  estimatedSellingPrice: scalar,
  estimatedProfit: scalar,
  estimatedMargin: scalar,
  estimatedMarginRate: scalar,
  grossProfit: scalar,
  grossMargin: scalar,
  purchaseCost: scalar,
  salePrice: scalar,
  platformFeeAmount: scalar,
  platformFeeRate: scalar,
  platformFeeRatePercent: scalar,
  commissionAmount: scalar,
  commissionRate: scalar,
  feeRate: scalar,
  purchase: objectOf({ value: scalar, source: scalar, note: scalar }),
  sale: objectOf({ value: scalar, source: scalar, note: scalar }),
  target: objectOf({ value: scalar, source: scalar, note: scalar }),
});

const riskReviewSnapshotSpec = objectOf({
  version: scalar,
  productName: scalar,
  source: scalar,
  createdAt: scalar,
  note: scalar,
  summary: scalar,
  overallStatus: scalar,
  overallPrecheckLevel: scalar,
  overallLevel: scalar,
  precheckLevel: scalar,
  precheckReason: scalar,
  recommendedActions: stringList,
  blacklistMatches: stringList,
  complianceWarnings: stringList,
  items: arrayOf(objectOf({
    key: scalar,
    label: scalar,
    description: scalar,
    status: scalar,
    precheckLevel: scalar,
    precheckReason: scalar,
    evidenceHint: scalar,
    example: scalar,
    checkAction: scalar,
    note: scalar,
  })),
});

const evidenceItemSpec = objectOf({
  id: scalar,
  field: scalar,
  label: scalar,
  kind: scalar,
  value: scalar,
  summary: scalar,
  sourceType: scalar,
  sourceLabel: scalar,
  sourceUrl: scalar,
  capturedAt: scalar,
  status: scalar,
  confidence: scalar,
  assumptions: stringList,
  dependencies: stringList,
  verificationNote: scalar,
  missingPriority: scalar,
});

const humanDecisionSpec = objectOf({
  status: scalar,
  statusLabel: scalar,
  reason: scalar,
  nextAction: scalar,
  decidedAt: scalar,
  confirmedItems: stringList,
  unconfirmedItems: stringList,
  source: scalar,
});

const decisionEvidenceSpec = objectOf({
  version: scalar,
  generatedAt: scalar,
  items: arrayOf(evidenceItemSpec),
  missingData: arrayOf(evidenceItemSpec),
  conflicts: arrayOf(evidenceItemSpec),
  humanDecision: humanDecisionSpec,
  historicalFallback: scalar,
  warnings: stringList,
});

const agentRunStepSpec = objectOf({ key: scalar, label: scalar, status: scalar, summary: scalar });
const agentRunSnapshotSpec = objectOf({
  version: scalar,
  source: scalar,
  productName: scalar,
  createdAt: scalar,
  runMode: scalar,
  steps: arrayOf(agentRunStepSpec),
  finalVerdict: scalar,
  riskLevel: scalar,
  beginnerFit: scalar,
  canTestSmallBatch: scalar,
  nextSteps: stringList,
  manualConfirmed: scalar,
  manualConfirmedAt: scalar,
  profitSnapshot: profitSnapshotSpec,
  riskReviewSnapshot: riskReviewSnapshotSpec,
});

const listingPrepSnapshotSpec = objectOf({
  keywordPool: objectOf({
    coreWords: stringList,
    longTailWords: stringList,
    sceneWords: stringList,
    crowdWords: stringList,
    attributeWords: stringList,
    riskWordReminder: scalar,
  }),
  titleStructure: objectOf({
    formula: scalar,
    recommendedTitle: scalar,
    breakdown: stringList,
  }),
  bulletDrafts: stringList,
  searchTerms: objectOf({ draft: scalar, reminders: stringList }),
  imageMaterialNeeds: stringList,
  manualSupplementChecklist: stringList,
  complianceExpressionReminders: stringList,
});

const productSpec = objectOf({
  name: scalar,
  productName: scalar,
  title: scalar,
  category: scalar,
  brand: scalar,
  asin: scalar,
  image: scalar,
  imageUrl: scalar,
  productUrl: scalar,
  price: scalar,
  currency: scalar,
  marketplace: scalar,
  rating: scalar,
  reviewCount: scalar,
  sellingPoints: stringList,
  painPoints: stringList,
  risks: stringList,
});

const listingSpec = objectOf({
  title: scalar,
  description: scalar,
  keywords: stringList,
  bulletPoints: stringList,
  bullets: stringList,
  complianceNotes: stringList,
  imageIdeas: stringList,
});

const LIST_FIELDS: Readonly<Record<string, ProjectionSpec>> = {
  productName: scalar,
  status: scalar,
};

const DETAIL_FIELDS: Readonly<Record<string, ProjectionSpec>> = {
  ...LIST_FIELDS,
  score: scalar,
  level: scalar,
  oneLineSummary: scalar,
  finalReport: finalReportSpec,
  reviewState: reviewStateSpec,
  agentOutputSnapshot: agentOutputSnapshotSpec,
  listingPackSnapshot: listingPackSpec,
  aiListingPackSnapshot: aiListingPackSpec,
  aiImageDraftSnapshot: aiImageDraftSpec,
  creativeHandoff: creativeHandoffSpec,
  sourceMeta: sourceMetaSpec,
  sellingPoints: stringList,
  painPoints: stringList,
  hooks: stringList,
  risks: stringList,
  summary: scalar,
  steps: arrayOf(objectOf({
    key: scalar,
    name: scalar,
    label: scalar,
    status: scalar,
    summary: scalar,
    warning: scalar,
    error: scalar,
  })),
  costGuard: objectOf({
    maxCalls: scalar,
    callsUsed: scalar,
    maxCostUsd: scalar,
    estimatedCostUsd: scalar,
    currency: scalar,
    blocked: scalar,
  }),
  batchMeta: objectOf({ batchIndex: scalar, batchTotal: scalar, batchName: scalar }),
  productLifecycle: productLifecycleSpec,
  profitSnapshot: profitSnapshotSpec,
  riskReviewSnapshot: riskReviewSnapshotSpec,
  decisionEvidence: decisionEvidenceSpec,
  humanDecision: humanDecisionSpec,
  agentRunSnapshot: agentRunSnapshotSpec,
  listingPrepSnapshot: listingPrepSnapshotSpec,
  listing: listingSpec,
  product: productSpec,
  normalizedProduct: productSpec,
  normalized: productSpec,
  category: scalar,
  titleSuggestions: stringList,
  videoOpenings: stringList,
  commentTriggers: stringList,
  conversionSuggestions: stringList,
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function researchHashFingerprint(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return null;
  return value.slice(0, PRODUCT_RESEARCH_HASH_FINGERPRINT_LENGTH);
}

function projectBySpec(value: unknown, spec: ProjectionSpec, depth = 0): unknown {
  if (depth > 12) return undefined;
  if (spec.kind === "scalar") {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return undefined;
  }
  if (spec.kind === "array") {
    if (!Array.isArray(value)) return undefined;
    const output: unknown[] = [];
    for (const item of value.slice(0, 200)) {
      const projected = projectBySpec(item, spec.item, depth + 1);
      if (projected !== undefined) output.push(projected);
    }
    return output;
  }
  if (!isRecord(value)) return undefined;
  const output: JsonRecord = {};
  for (const [key, fieldSpec] of Object.entries(spec.fields)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const projected = projectBySpec(value[key], fieldSpec, depth + 1);
    if (projected !== undefined) output[key] = projected;
  }
  return output;
}

function projectDecisionEvent(event: ProductResearchDecisionEvent) {
  return {
    revision: event.revision,
    status: event.status,
    reason: event.reason,
    nextAction: event.nextAction,
    decidedAt: event.decidedAt,
    actorMode: event.actor.mode,
    researchHashFingerprint: researchHashFingerprint(event.researchHash),
  };
}

function projectResearchSummary(record: ProductResearchRecordV1) {
  const latest = record.latestDecision;
  return {
    schema: PRODUCT_RESEARCH_RECORD_SCHEMA,
    revision: record.revision,
    status: latest.status,
    label: getProductResearchDecisionLabel(latest.status),
    reasonSummary: latest.reason.slice(0, 240),
    nextActionSummary: latest.nextAction?.slice(0, 240) ?? null,
    decidedAt: latest.decidedAt,
    actorMode: latest.actor.mode,
    researchHashFingerprint: researchHashFingerprint(record.researchHash),
    legacy: false as const,
  };
}

function boundedStrings(value: unknown, limit = 5) {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.normalize("NFC").trim().slice(0, 240))
      .slice(0, limit)
    : [];
}

function projectLegacyListSummary(value: JsonRecord, context: TaskListProjectionContext) {
  const decisionStatus = context.decisionStatus ?? "pending";
  const summaryInput = {
    type: context.type,
    title: context.title,
    materialText: context.materialText,
    oneLineSummary: context.oneLineSummary,
    level: context.level,
    decisionStatus,
    result: value,
  };
  const workflow = deriveTaskWorkflowSummary(summaryInput);
  const operation = deriveTaskOperationSummary(summaryInput);
  const agent = deriveAgentNextStepPanelState({
    taskType: context.type ?? undefined,
    decisionStatus,
    result: value,
  });
  const presentation = deriveProductResearchPresentation({
    id: context.id ?? "",
    title: workflow.productName,
    type: context.type,
    decisionStatus,
    result: value,
  });

  return {
    workflow: {
      ...workflow,
      verdictLabel: workflow.verdictLabel.slice(0, 240),
      primaryNextAction: workflow.primaryNextAction.slice(0, 240),
      nextActions: boundedStrings(workflow.nextActions),
      reason: workflow.reason.slice(0, 240),
      missingFields: boundedStrings(workflow.missingFields),
    },
    operation: {
      stage: operation.stage,
      stageLabel: operation.stageLabel,
      decision: operation.decision,
      decisionLabel: operation.decisionLabel,
      riskLevel: operation.riskLevel,
      riskLabel: operation.riskLabel,
      primaryAction: operation.primaryAction,
      actionLabel: operation.actionLabel.slice(0, 240),
      blockingIssues: boundedStrings(operation.blockingIssues),
      evidenceSummary: operation.evidenceSummary.slice(0, 240),
      listingReadiness: operation.listingReadiness,
      listingReadinessLabel: operation.listingReadinessLabel,
      ...(operation.sourceQualityScore !== undefined
        ? { sourceQualityScore: operation.sourceQualityScore }
        : {}),
      ...(operation.confidence ? { confidence: operation.confidence } : {}),
      fallbackUsed: operation.fallbackUsed,
    },
    agent,
    presentation: {
      stage: presentation.stage,
      artifacts: presentation.artifacts,
      researchConclusions: boundedStrings(presentation.researchConclusions),
      actions: presentation.actions,
    },
    pipelineStatus: derivePipelineStatus(summaryInput),
    hasListingPack: hasAiListingPack(value),
    hasCandidateSource: getTaskSourceMeta(value) !== null,
    details: {
      sellingPoints: boundedStrings(value.sellingPoints),
      painPoints: boundedStrings(value.painPoints),
      hooks: boundedStrings(value.hooks),
      risks: boundedStrings(value.risks),
    },
  };
}

export function toResearchHashFingerprint(value: unknown): string | null {
  return researchHashFingerprint(value);
}

export function projectTaskResultForBrowser(
  value: unknown,
  scope: BrowserProjectionScope,
  context: TaskListProjectionContext = {},
): JsonRecord {
  if (!isRecord(value)) return {};
  const output: JsonRecord = {};
  const fields = scope === "list" ? LIST_FIELDS : DETAIL_FIELDS;
  for (const [key, spec] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const projected = projectBySpec(value[key], spec);
    if (projected !== undefined) output[key] = projected;
  }
  const record = parseProductResearchRecord(value.researchRecord);
  if (record) output.productResearchSummary = projectResearchSummary(record);
  if (scope === "list") output.legacyListSummary = projectLegacyListSummary(value, context);
  return output;
}

export function projectProductResearchDecisionStateForBrowser(value: unknown): unknown {
  if (!isRecord(value)) return null;
  const taskId = typeof value.taskId === "string" ? value.taskId : "";
  const legacy = value.legacy === true;
  const readOnly = value.readOnly === true;
  const record = parseProductResearchRecord(value.record);
  return {
    taskId,
    legacy,
    readOnly,
    record: record ? {
      schema: PRODUCT_RESEARCH_RECORD_SCHEMA,
      revision: record.revision,
      researchHashFingerprint: researchHashFingerprint(record.researchHash),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      latestDecision: projectDecisionEvent(record.latestDecision),
      decisionEvents: record.decisionEvents.map(projectDecisionEvent),
    } : null,
  };
}
