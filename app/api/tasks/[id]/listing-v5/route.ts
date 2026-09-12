import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
import { markDemoAiProviderCallStarted, requireAuthenticated, reserveDemoAiCalls, settleDemoAiCalls } from "@/lib/server/demoGuard";
import { isRealAiListingEnabled, isRealAiVisitorListingEnabled } from "@/lib/server/realAiListingGate";
import type { AccessContext } from "@/lib/server/accessPassword";
import { checkCreativeHandoffGate, type CreativeHandoffGateResult } from "@/lib/server/productCreativeHandoffPreview";
import { buildListingInputFromCreativeHandoff } from "@/lib/listingHandoff/listingGenerationInput";
import { mutateTaskResultJson, TaskResultJsonMutationError } from "@/lib/server/taskResultJsonMutation";
import { prisma } from "@/lib/server/db";
import { buildListingV5Context } from "@/lib/listingV5/context";
import { buildListingV5ConversionBlueprint } from "@/lib/listingV5/conversionBlueprint";
import { buildApprovedBenefitsForPrompt } from "@/lib/listingV5/benefitExpression";
import { evaluateListingV5Quality } from "@/lib/listingV5/qualityEvaluation";
import { recoverListingV5Draft } from "@/lib/listingV5/conversionRecovery";
import { rewriteListingV5Draft } from "@/lib/listingV5/conversionRewrite";
import { analyzeListingV5Strategy } from "@/lib/listingV5/strategy";
import { generateListingV5Draft, buildListingV5FallbackDraft } from "@/lib/listingV5/generation";
import { repairListingV5Draft } from "@/lib/listingV5/structuredRepair";
import { validateListingV5Draft } from "@/lib/listingV5/validation";
import {
  buildListingV5ExecutionTrace,
  buildStageTrace,
  isListingV5TraceEnabled,
  idleStageTrace,
  LISTING_V5_FALLBACK_REASONS,
  LISTING_V5_STAGE_FAILURE_REASONS,
  LISTING_V5_VALIDATION_STATUSES,
  type ListingV5ExecutionTrace,
  type ListingV5FallbackReason,
  type ListingV5StageFailureReason,
  type ListingV5StageTrace,
  type ListingV5ValidationStatus,
} from "@/lib/listingV5/trace";
import type { ListingV5Snapshot, ListingV5Strategy, ListingV5ValidationResult, ListingV5WriterDraft } from "@/lib/listingV5/types";
import {
  LISTING_V5_REPAIR_PROMPT_VERSION,
  LISTING_V5_STRATEGY_PROMPT_VERSION,
  LISTING_V5_VALIDATION_VERSION,
  LISTING_V5_WRITER_PROMPT_VERSION,
} from "@/lib/listingV5/types";

const ACTIVE_V5_JOBS = new Set<string>();

/**
 * Fail-closed placeholder for "there is no validation result for this listing".
 * It must never claim PASS: returning a verified status for a listing nobody
 * validated is exactly the fake-PASS failure mode this pipeline forbids, so an
 * unvalidated snapshot reports BLOCK and says why.
 */
const NOT_VALIDATED_PLACEHOLDER: ListingV5ValidationResult = {
  version: LISTING_V5_VALIDATION_VERSION,
  status: "BLOCK",
  title: { valid: false, issues: ["validation_not_run"] },
  bullets: [],
  description: { valid: false, issues: ["validation_not_run"] },
  claims: { allHaveEvidence: false, unsupportedClaims: [], prohibitedClaims: [], competitorOverlap: [] },
  quality: { repetitive: false, keywordStuffing: false, mechanicalTemplate: false },
  repair: { allowed: false, reason: "validation_not_run", targets: [] },
};

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function error(status: number, code: string, message: string) { return NextResponse.json({ error: { code, message } }, { status }); }

/**
 * Turn a gate refusal into a response the client can act on.
 *
 * The gate reports "task missing / not owned" and genuine business refusals with the
 * same `legacy_not_supported` reason. Letting that reach the client for a task that
 * simply does not exist told users their own task was an unsupported legacy record,
 * so an inaccessible task answers 404 task_not_found instead — the same code and
 * message the sibling routes already use (see the creative-handoff micro-gate).
 */
function gateRefusal(gate: CreativeHandoffGateResult) {
  if (gate.taskAccessible === false) return error(404, "task_not_found", "任务不存在。");
  if (gate.reason === "creative_confirmation_required") {
    return error(422, gate.reason, "还差一步：确认创作资料。研究中已有可用于 Listing 的商品事实，请先确认创作资料后再生成文案。");
  }
  return error(422, gate.reason, "当前研究资料还不能生成 Listing V5。请先完成研究与人工确认。");
}

function auth(req: NextRequest, taskId: string, body: Record<string, unknown>): { ctx: AccessContext | null; response: NextResponse | null } {
  const result = requireAuthenticated(req, body);
  if (!result.ok) return { ctx: null, response: error(result.status, result.code === "not_found" ? "task_not_found" : result.code, result.message) };
  if (isSandboxTaskId(taskId) && result.context.mode !== "demo") return { ctx: null, response: error(404, "task_not_found", "任务不存在。") };
  return { ctx: result.context, response: null };
}

async function readResult(taskId: string, ctx: AccessContext): Promise<Record<string, unknown> | null> {
  if (ctx.mode === "demo") {
    const task = getSandboxTask(ctx.demoAccessId, taskId);
    if (!task) return null;
    try { const value = JSON.parse(task.resultJson); return isRecord(value) ? value : null; } catch { return null; }
  }
  const task = await prisma.viralAnalysisRecord.findUnique({ where: { id: taskId }, select: { resultJson: true } });
  if (!task || typeof task.resultJson !== "string") return null;
  try { const value = JSON.parse(task.resultJson); return isRecord(value) ? value : null; } catch { return null; }
}

const STAGE_FAILURE_REASONS = new Set<string>(LISTING_V5_STAGE_FAILURE_REASONS);
const FALLBACK_REASONS = new Set<string>(LISTING_V5_FALLBACK_REASONS);
const VALIDATION_STATUSES = new Set<string>(LISTING_V5_VALIDATION_STATUSES);

function boundedText(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function boundedNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The trace is persisted inside the snapshot, so it is re-validated field by
 * field before it leaves the API - same posture as safeSnapshot.
 */
function safeStageTrace(value: unknown): ListingV5StageTrace {
  if (!isRecord(value)) return idleStageTrace();
  return {
    attempted: value.attempted === true,
    success: value.success === true,
    failureReason: (STAGE_FAILURE_REASONS.has(String(value.failureReason))
      ? String(value.failureReason)
      : "none") as ListingV5StageFailureReason,
    providerErrorCode: boundedText(value.providerErrorCode, 64),
    providerHttpStatusClass: boundedText(value.providerHttpStatusClass, 32),
    model: boundedText(value.model, 128),
    jsonParseStage: boundedText(value.jsonParseStage, 32),
    finishReason: boundedText(value.finishReason, 64),
    completionTokens: boundedNumber(value.completionTokens),
    reasoningTokens: boundedNumber(value.reasoningTokens),
    responseCharLength: boundedNumber(value.responseCharLength),
    elapsedMs: boundedNumber(value.elapsedMs),
  };
}

function safeTrace(value: unknown): ListingV5ExecutionTrace | null {
  if (!isRecord(value) || value.version !== "listing-v5.execution-trace.v1") return null;
  const stages = isRecord(value.stages) ? value.stages : {};
  return {
    version: "listing-v5.execution-trace.v1",
    strategyAttempted: value.strategyAttempted === true,
    strategySuccess: value.strategySuccess === true,
    strategyFailureReason: (STAGE_FAILURE_REASONS.has(String(value.strategyFailureReason))
      ? String(value.strategyFailureReason)
      : "none") as ListingV5StageFailureReason,
    writerAttempted: value.writerAttempted === true,
    writerSuccess: value.writerSuccess === true,
    writerFailureReason: (STAGE_FAILURE_REASONS.has(String(value.writerFailureReason))
      ? String(value.writerFailureReason)
      : "none") as ListingV5StageFailureReason,
    repairAttempted: value.repairAttempted === true,
    repairSuccess: value.repairSuccess === true,
    repairFailureReason: (STAGE_FAILURE_REASONS.has(String(value.repairFailureReason))
      ? String(value.repairFailureReason)
      : "none") as ListingV5StageFailureReason,
    validationStatus: (VALIDATION_STATUSES.has(String(value.validationStatus))
      ? String(value.validationStatus)
      : "NOT_RUN") as ListingV5ValidationStatus,
    finalValidationStatus: (VALIDATION_STATUSES.has(String(value.finalValidationStatus))
      ? String(value.finalValidationStatus)
      : "NOT_RUN") as ListingV5ValidationStatus,
    validationBlockReasons: Array.isArray(value.validationBlockReasons)
      ? value.validationBlockReasons.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 120)).slice(0, 12)
      : [],
    recoveryAttempted: value.recoveryAttempted === true,
    recoveryReason: typeof value.recoveryReason === "string" ? value.recoveryReason.slice(0, 120) : null,
    recoveryValidationStatus: VALIDATION_STATUSES.has(String(value.recoveryValidationStatus)) ? (String(value.recoveryValidationStatus) as ListingV5ValidationStatus) : null,
    rewriteAttempted: value.rewriteAttempted === true,
    rewriteReason: typeof value.rewriteReason === "string" ? value.rewriteReason.slice(0, 120) : null,
    rewriteValidationStatus: VALIDATION_STATUSES.has(String(value.rewriteValidationStatus)) ? (String(value.rewriteValidationStatus) as ListingV5ValidationStatus) : null,
    fallbackUsed: value.fallbackUsed === true,
    fallbackReason: (FALLBACK_REASONS.has(String(value.fallbackReason))
      ? String(value.fallbackReason)
      : "none") as ListingV5FallbackReason,
    stages: {
      strategy: safeStageTrace(stages.strategy),
      writer: safeStageTrace(stages.writer),
      repair: safeStageTrace(stages.repair),
      rewrite: safeStageTrace(stages.rewrite),
      recovery: safeStageTrace(stages.recovery),
    },
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt.slice(0, 40) : "",
  };
}

function safeSnapshot(snapshot: unknown, currentRevision: number, currentHandoffRevision?: number, currentFingerprint?: string) {
  if (!isRecord(snapshot) || snapshot.version !== "listing-v5.snapshot.v1") return null;
  const stale = snapshot.researchRevision !== currentRevision
    || (typeof currentHandoffRevision === "number" && snapshot.handoffRevision !== currentHandoffRevision)
    || (typeof currentFingerprint === "string" && snapshot.contextFingerprint !== currentFingerprint);
  const strategy = isRecord(snapshot.strategy) ? {
    targetAudience: Array.isArray(snapshot.strategy.targetAudience) ? snapshot.strategy.targetAudience.slice(0, 5) : [],
    purchaseMotivations: Array.isArray(snapshot.strategy.purchaseMotivations) ? snapshot.strategy.purchaseMotivations.slice(0, 5) : [],
    painPoints: Array.isArray(snapshot.strategy.painPoints) ? snapshot.strategy.painPoints.slice(0, 5) : [],
    useCases: Array.isArray(snapshot.strategy.useCases) ? snapshot.strategy.useCases.slice(0, 6) : [],
    primaryAngle: typeof snapshot.strategy.primaryAngle === "string" ? snapshot.strategy.primaryAngle : "",
    secondaryAngles: Array.isArray(snapshot.strategy.secondaryAngles) ? snapshot.strategy.secondaryAngles.slice(0, 4) : [],
    tone: Array.isArray(snapshot.strategy.tone) ? snapshot.strategy.tone.slice(0, 3) : [],
    avoidClaims: Array.isArray(snapshot.strategy.avoidClaims) ? snapshot.strategy.avoidClaims.slice(0, 8) : [],
    // Evidence Binding projection: bounded, additive, and read-only. It reports
    // which strategy conclusions cite a real research reference. It carries no
    // Validator authority and never carries listing copy.
    evidenceBindings: isRecord(snapshot.strategy.evidenceBindings) ? {
      version: String(snapshot.strategy.evidenceBindings.version ?? ""),
      source: String(snapshot.strategy.evidenceBindings.source ?? ""),
      total: Number(snapshot.strategy.evidenceBindings.total ?? 0) || 0,
      bound: Number(snapshot.strategy.evidenceBindings.bound ?? 0) || 0,
      suggestions: Number(snapshot.strategy.evidenceBindings.suggestions ?? 0) || 0,
      conclusions: Array.isArray(snapshot.strategy.evidenceBindings.conclusions)
        ? snapshot.strategy.evidenceBindings.conclusions.filter(isRecord).slice(0, 12).map((item) => ({
          field: String(item.field ?? ""),
          text: String(item.text ?? "").slice(0, 160),
          status: String(item.status ?? ""),
          evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.filter((value): value is string => typeof value === "string").slice(0, 4) : [],
          unresolvedEvidenceIds: Array.isArray(item.unresolvedEvidenceIds) ? item.unresolvedEvidenceIds.filter((value): value is string => typeof value === "string").slice(0, 4) : [],
        }))
        : [],
    } : undefined,
  } : null;
  const listing = isRecord(snapshot.listing) ? {
    title: isRecord(snapshot.listing.title) ? { text: String(snapshot.listing.title.text ?? "") } : null,
    bullets: Array.isArray(snapshot.listing.bullets) ? snapshot.listing.bullets.filter(isRecord).map((item) => ({ text: String(item.text ?? ""), strategyRole: String(item.strategyRole ?? "") })) : [],
    description: isRecord(snapshot.listing.description) ? { text: String(snapshot.listing.description.text ?? "") } : null,
    backendSearchTerms: Array.isArray(snapshot.listing.backendSearchTerms) ? snapshot.listing.backendSearchTerms.filter((term): term is string => typeof term === "string").slice(0, 12) : [],
  } : null;
  const validation = isRecord(snapshot.validation) ? {
    status: String(snapshot.validation.status ?? "BLOCK"),
    titleIssues: isRecord(snapshot.validation.title) && Array.isArray(snapshot.validation.title.issues) ? snapshot.validation.title.issues.slice(0, 6) : [],
    bulletIssueCount: Array.isArray(snapshot.validation.bullets) ? snapshot.validation.bullets.filter((item) => isRecord(item) && item.valid !== true).length : 0,
    descriptionIssues: isRecord(snapshot.validation.description) && Array.isArray(snapshot.validation.description.issues) ? snapshot.validation.description.issues.slice(0, 6) : [],
    unsupportedClaimCount: isRecord(snapshot.validation.claims) && Array.isArray(snapshot.validation.claims.unsupportedClaims) ? snapshot.validation.claims.unsupportedClaims.length : 0,
    prohibitedClaimCount: isRecord(snapshot.validation.claims) && Array.isArray(snapshot.validation.claims.prohibitedClaims) ? snapshot.validation.claims.prohibitedClaims.length : 0,
    competitorOverlapCount: isRecord(snapshot.validation.claims) && Array.isArray(snapshot.validation.claims.competitorOverlap) ? snapshot.validation.claims.competitorOverlap.length : 0,
    quality: isRecord(snapshot.validation.quality) ? snapshot.validation.quality : { repetitive: false, keywordStuffing: false, mechanicalTemplate: false },
  } : null;
  // Conversion intelligence layer projection: bounded, reference-only, and
  // additive. It never carries Validator authority and never carries facts.
  const conversionBlueprint = isRecord(snapshot.conversionBlueprint) ? {
    version: String(snapshot.conversionBlueprint.version ?? ""),
    referenceOnly: true,
    targetBuyer: String(snapshot.conversionBlueprint.targetBuyer ?? ""),
    primaryPurchaseReason: String(snapshot.conversionBlueprint.primaryPurchaseReason ?? ""),
    positioningAngle: String(snapshot.conversionBlueprint.positioningAngle ?? ""),
    bulletPlan: Array.isArray(snapshot.conversionBlueprint.bulletPlan)
      ? snapshot.conversionBlueprint.bulletPlan.filter(isRecord).slice(0, 5).map((item) => ({
        role: String(item.role ?? ""),
        shopperQuestion: String(item.shopperQuestion ?? ""),
        shopperValue: String(item.shopperValue ?? ""),
        hasEvidenceId: typeof item.evidenceId === "string" && item.evidenceId.length > 0,
      }))
      : [],
    buyerIntent: isRecord(snapshot.conversionBlueprint.buyerIntent) ? {
      primary: String(snapshot.conversionBlueprint.buyerIntent.primary ?? ""),
      secondary: Array.isArray(snapshot.conversionBlueprint.buyerIntent.secondary) ? snapshot.conversionBlueprint.buyerIntent.secondary.filter((item): item is string => typeof item === "string").slice(0, 5) : [],
      stage: String(snapshot.conversionBlueprint.buyerIntent.stage ?? ""),
    } : null,
    painPoints: Array.isArray(snapshot.conversionBlueprint.painPoints)
      ? snapshot.conversionBlueprint.painPoints.filter(isRecord).slice(0, 6).map((item) => ({
        pain: String(item.pain ?? ""),
        source: String(item.source ?? ""),
        factBacked: item.factBacked === true,
        proofFactCount: Array.isArray(item.proofFactIds) ? item.proofFactIds.length : 0,
      }))
      : [],
    competitorGaps: Array.isArray(snapshot.conversionBlueprint.competitorGaps)
      ? snapshot.conversionBlueprint.competitorGaps.filter(isRecord).slice(0, 4).map((item) => ({
        dimension: String(item.dimension ?? ""),
        ourFactCount: Array.isArray(item.ourFactIds) ? item.ourFactIds.length : 0,
      }))
      : [],
    conversionAngle: isRecord(snapshot.conversionBlueprint.conversionAngle) ? {
      angle: String(snapshot.conversionBlueprint.conversionAngle.angle ?? ""),
      whyItConverts: String(snapshot.conversionBlueprint.conversionAngle.whyItConverts ?? ""),
    } : null,
    proofPointCount: Array.isArray(snapshot.conversionBlueprint.proofPoints) ? snapshot.conversionBlueprint.proofPoints.length : 0,
    benefitOrder: Array.isArray(snapshot.conversionBlueprint.benefitOrder)
      ? snapshot.conversionBlueprint.benefitOrder.filter(isRecord).slice(0, 5).map((item) => ({
        role: String(item.role ?? ""),
        shopperValue: String(item.shopperValue ?? ""),
        hasPrimaryFact: typeof item.primaryFactId === "string" && item.primaryFactId.length > 0,
      }))
      : [],
    disallowedTemptations: Array.isArray(snapshot.conversionBlueprint.disallowedTemptations) ? snapshot.conversionBlueprint.disallowedTemptations.filter((item): item is string => typeof item === "string").slice(0, 24) : [],
    // V5.1 conversion strategy: bounded, read-only, fact-ids only (never reference text).
    purchaseTriggers: Array.isArray(snapshot.conversionBlueprint.purchaseTriggers)
      ? snapshot.conversionBlueprint.purchaseTriggers.filter(isRecord).slice(0, 6).map((item) => ({
        trigger: String(item.trigger ?? ""),
        factBacked: item.factBacked === true,
        factIdCount: Array.isArray(item.factIds) ? item.factIds.length : 0,
      }))
      : [],
    objectionHandling: Array.isArray(snapshot.conversionBlueprint.objectionHandling)
      ? snapshot.conversionBlueprint.objectionHandling.filter(isRecord).slice(0, 6).map((item) => ({
        objection: String(item.objection ?? ""),
        resolution: String(item.resolution ?? ""),
        factIdCount: Array.isArray(item.factIds) ? item.factIds.length : 0,
      }))
      : [],
    benefitPriority: Array.isArray(snapshot.conversionBlueprint.benefitPriority)
      ? snapshot.conversionBlueprint.benefitPriority.filter(isRecord).slice(0, 8).map((item) => ({
        benefit: String(item.benefit ?? ""),
        priority: typeof item.priority === "number" ? item.priority : 0,
        factIdCount: Array.isArray(item.factIds) ? item.factIds.length : 0,
      }))
      : [],
    decisionSequence: Array.isArray(snapshot.conversionBlueprint.decisionSequence) ? snapshot.conversionBlueprint.decisionSequence.filter((item): item is string => typeof item === "string").slice(0, 6) : [],
  } : null;
  const qualityEvaluation = isRecord(snapshot.qualityEvaluation) ? {
    version: String(snapshot.qualityEvaluation.version ?? ""),
    total: typeof snapshot.qualityEvaluation.total === "number" ? snapshot.qualityEvaluation.total : 0,
    max: 100,
    grade: String(snapshot.qualityEvaluation.grade ?? "D"),
    deterministicFallback: snapshot.qualityEvaluation.deterministicFallback === true,
    hardFlags: Array.isArray(snapshot.qualityEvaluation.hardFlags)
      ? snapshot.qualityEvaluation.hardFlags.filter((flag): flag is string => typeof flag === "string").slice(0, 8)
      : [],
    notes: Array.isArray(snapshot.qualityEvaluation.notes) ? snapshot.qualityEvaluation.notes.filter((item): item is string => typeof item === "string").slice(0, 4) : [],
    dimensions: Array.isArray(snapshot.qualityEvaluation.dimensions)
      ? snapshot.qualityEvaluation.dimensions.filter(isRecord).slice(0, 5).map((item) => ({
        id: String(item.id ?? ""),
        label: String(item.label ?? ""),
        score: typeof item.score === "number" ? item.score : 0,
        max: typeof item.max === "number" ? item.max : 0,
        evidence: Array.isArray(item.evidence) ? item.evidence.filter((line): line is string => typeof line === "string").slice(0, 4) : [],
      }))
      : [],
  } : null;
  return { version: snapshot.version, researchRevision: snapshot.researchRevision, handoffRevision: snapshot.handoffRevision, strategy, listing, validation, conversionBlueprint, qualityEvaluation, repairApplied: snapshot.repairApplied === true, provider: isRecord(snapshot.provider) ? { strategyAttempted: snapshot.provider.strategyAttempted === true, writerAttempted: snapshot.provider.writerAttempted === true, repairAttempted: snapshot.provider.repairAttempted === true, recoveryAttempted: snapshot.provider.recoveryAttempted === true, rewriteAttempted: snapshot.provider.rewriteAttempted === true, fallbackUsed: snapshot.provider.fallbackUsed === true } : { strategyAttempted: false, writerAttempted: false, repairAttempted: false, recoveryAttempted: false, rewriteAttempted: false, fallbackUsed: true }, humanReviewRequired: true, trace: isListingV5TraceEnabled() ? safeTrace(snapshot.trace) : undefined, stale };
}

async function buildContext(taskId: string, ctx: AccessContext) {
  const gate = await checkCreativeHandoffGate(taskId, ctx);
  if (!gate.allowed || !gate.currentHandoff || !gate.candidate) return { gate, context: null };
  const latestHandoff = gate.currentHandoff.versions[gate.currentHandoff.versions.length - 1];
  const researchRevision = gate.candidate.sourceResearch.researchRevision;
  const built = buildListingInputFromCreativeHandoff(gate.currentHandoff, researchRevision, { creativeContext: gate.creativeContext ?? null });
  if (!built.ok) return { gate, context: null };
  const latest = latestHandoff;
  const productIdentity = typeof latest?.productIdentity?.displayName === "string"
    ? latest.productIdentity.displayName
    : String((gate.candidate as unknown as { productName?: string }).productName ?? "");
  const confirmedFacts = (latest?.confirmedFacts ?? []).filter((fact) => fact.usageScopes.includes("listing")).map((fact) => ({ factId: fact.factId, field: fact.field, label: fact.label, value: fact.value, sourceRefs: ["human_confirmation"] }));
  return { gate, context: buildListingV5Context({ taskId, researchRevision, handoffRevision: gate.currentHandoff.currentRevision, productIdentity, generationInput: built.input, creativeContext: gate.creativeContext ?? null, confirmedFacts, manualDirection: latest?.creativePreferences?.additionalRequirements ?? null }) };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const verified = auth(req, id, {});
  if (verified.response) return verified.response;
  const { gate, context } = await buildContext(id, verified.ctx!);
  if (!context) return gateRefusal(gate);
  const result = await readResult(id, verified.ctx!);
  // `realAiEnabled` is server-authoritative so the client can disable (and
  // explain) the real-AI confirmation instead of letting the user tick a box
  // that cannot change anything.
  return NextResponse.json({ ok: true, data: { realAiEnabled: isRealAiListingEnabled(), context: { researchRevision: context.researchRevision, handoffRevision: context.handoffRevision, contextFingerprint: context.contextFingerprint, factCount: context.confirmedFacts.length, referenceCounts: { voc: context.references.voc.length, keywords: context.references.keywords.length, competitors: context.references.competitors.length, sourcing: context.references.sourcing.length } }, snapshot: safeSnapshot(result?.listingV5, context.researchRevision, context.handoffRevision, context.contextFingerprint) } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return error(400, "invalid_json", "请求格式无效。") }
  if (!isRecord(body)) return error(400, "invalid_json", "请求格式无效。");
  const verified = auth(req, id, body);
  if (verified.response) return verified.response;
  // Only two public actions exist. A "revalidate" action used to be accepted
  // here but ran the full writer path again, which is not what re-validating an
  // existing listing means; it was removed rather than left half-implemented.
  const action = body.action === "analyze_strategy" || body.action === "generate" ? body.action : null;
  if (!action) return error(400, "invalid_action", "只支持 analyze_strategy 或 generate。");
  const prepared = await buildContext(id, verified.ctx!);
  if (!prepared.context) return gateRefusal(prepared.gate);
  const context = prepared.context;
  const current = await readResult(id, verified.ctx!);
  const cached = isRecord(current?.listingV5) ? current.listingV5 : null;
  const forceStrategy = action === "analyze_strategy" && body.forceStrategy === true;
  const cachedStrategy = !forceStrategy && cached && cached.version === "listing-v5.snapshot.v1"
    && cached.strategyPromptVersion === LISTING_V5_STRATEGY_PROMPT_VERSION
    && cached.researchRevision === context.researchRevision
    && cached.handoffRevision === context.handoffRevision
    && cached.contextFingerprint === context.contextFingerprint
    && isRecord(cached.strategy)
    ? cached.strategy as unknown as ListingV5Strategy
    : null;
  // One write lock per task + context. Keying by action would let
  // analyze_strategy and generate run concurrently and race on the same
  // listingV5 snapshot.
  const jobKey = `${id}:${context.contextFingerprint}`;
  // The lock is taken only after every pre-flight step that can fail or throw
  // has passed: a rejected request must never leave the key behind, which would
  // wedge this task+context with 409 until the process restarts. The check and
  // the add stay in one synchronous block, so they remain atomic.
  if (ACTIVE_V5_JOBS.has(jobKey)) return error(409, "listing_v5_running", "Listing V5 正在处理中，请等待当前请求完成。");
  const useProvider = isRealAiListingEnabled();
  if (useProvider && verified.ctx!.mode === "demo" && !isRealAiVisitorListingEnabled()) {
    return error(403, "visitor_listing_generation_disabled", "Listing 真实 AI 暂未对访客开放。");
  }
  if (useProvider && body.confirmRealAi !== true) {
    return error(400, "real_ai_confirmation_required", "调用真实 AI 前需要再次确认。");
  }
  // Worst-case provider calls for the V5.2 chain: strategy (only when there is no
  // cached strategy) + writer + at most one bounded repair + at most one bounded
  // Conversion Rewrite + the last-resort Safe Recovery slot. The reservation is
  // what the quota guard enforces, so it has to cover the longest path the chain
  // can actually take.
  const plannedCalls = action === "analyze_strategy" ? 1 : cachedStrategy ? 4 : 5;
  let quota: { ok: true; reservation: null } | { ok: false; status: number; code: string; message: string };
  try {
    quota = useProvider ? (reserveDemoAiCalls(verified.ctx!, plannedCalls) as typeof quota) : { ok: true as const, reservation: null };
  } catch {
    // The reservation is the last step before the lock is taken, so a failure
    // here must fail the request cleanly instead of escaping as an unhandled
    // error (and it can never strand the job key).
    return error(500, "listing_v5_failed", "Listing V5 暂时无法完成，请稍后重试。");
  }
  if (!quota.ok) return error(quota.status, quota.code, quota.message);
  ACTIVE_V5_JOBS.add(jobKey);
  let providerCallsStarted = 0;
  let quotaSettled = false;
  const onProviderCallStart = () => {
    providerCallsStarted += 1;
    const marked = markDemoAiProviderCallStarted(verified.ctx!, quota.reservation, providerCallsStarted);
    if (!marked.ok) throw new Error(marked.code);
  };
  const settleQuota = () => {
    if (!useProvider || quotaSettled) return { ok: true as const };
    const settled = settleDemoAiCalls(verified.ctx!, quota.reservation, providerCallsStarted);
    if (settled.ok) quotaSettled = true;
    return settled;
  };
  try {
    const strategyResult = cachedStrategy
      ? { strategy: cachedStrategy, providerAttempted: false, providerSucceeded: false, trace: buildStageTrace({ attempted: false, success: false, failureReason: "stage_not_run" }) }
      : await analyzeListingV5Strategy(context, { useProvider, onProviderCallStart });
    // Keep the formal route on the same approved-benefit contract as the
    // Writer. The projection is derived from this generation's Confirmed Facts
    // and v2 Blueprint; it never adds facts and only gives the unchanged
    // Validator the semantic benefit vocabulary already admitted to the prompt.
    const approvedBenefits = buildApprovedBenefitsForPrompt(
      context.confirmedFacts,
      buildListingV5ConversionBlueprint(context, strategyResult.strategy),
    );
    let draft: ListingV5WriterDraft | null = null;
    let validation: ListingV5ValidationResult | null = null;
    let firstValidation: ListingV5ValidationResult | null = null;
    let repairApplied = false;
    let fallbackReason: ListingV5FallbackReason = "none";
    let writerTrace: ListingV5StageTrace = idleStageTrace();
    let repairTrace: ListingV5StageTrace = idleStageTrace();
    let provider = { strategyAttempted: strategyResult.providerAttempted, writerAttempted: false, repairAttempted: false, fallbackUsed: false, recoveryAttempted: false, rewriteAttempted: false };
    let recoveryTrace: ListingV5StageTrace = idleStageTrace();
    let recoveryReason: string | null = null;
    let recoveryValidation: ListingV5ValidationResult | null = null;
    let rewriteTrace: ListingV5StageTrace = idleStageTrace();
    let rewriteReason: string | null = null;
    let rewriteValidation: ListingV5ValidationResult | null = null;
    // The chain spends at most one AI repair per generation (V5.2 chain contract
    // `Repair <= 1`), whether the writer draft or the rewritten draft triggered it.
    let repairUsed = false;
    const runRepair = async (current: ListingV5ValidationResult, currentDraft: ListingV5WriterDraft): Promise<ListingV5ValidationResult> => {
      const repaired = await repairListingV5Draft({ context, strategy: strategyResult.strategy, validation: current, draft: currentDraft, useProvider, onProviderCallStart });
      repairTrace = repaired.trace ?? idleStageTrace();
      provider = { ...provider, repairAttempted: repaired.attempted };
      repairApplied = repairApplied || (repaired.succeeded && repaired.appliedPaths.length > 0);
      draft = repaired.draft;
      return validateListingV5Draft(context, strategyResult.strategy, repaired.draft, approvedBenefits);
    };
    if (action !== "analyze_strategy") {
      const generated = await generateListingV5Draft(context, strategyResult.strategy, { useProvider, onProviderCallStart });
      // The writer stage returning a fallback draft is the only writer-side fallback.
      fallbackReason = generated.providerSucceeded ? "none" : "writer_stage_failed";
      writerTrace = generated.trace ?? idleStageTrace();
      draft = generated.draft; provider = { ...provider, writerAttempted: generated.providerAttempted, fallbackUsed: !generated.providerSucceeded };
      validation = validateListingV5Draft(context, strategyResult.strategy, draft, approvedBenefits);
      firstValidation = validation;
      // Step 1 - the writer draft was REPAIRABLE, so spend the single bounded AI
      // repair pass. Repair returns its draft for re-validation even when it
      // failed or only partly applied, so the AI draft stays in place here and
      // this step is NOT a fallback by itself.
      if (validation.status === "REPAIRABLE") {
        repairUsed = true;
        validation = await runRepair(validation, draft);
      }
      // Step 2 - V5.2 Conversion Rewrite (at most once). The draft is still not
      // PASS, so one bounded AI pass rebuilds the whole listing from the same
      // Confirmed Facts. The Validator, the repair semantics and the fact
      // authority are untouched, the rewritten draft must pass the same
      // validation below, and deterministic code never rewrites marketing copy to
      // force a PASS. A writer-stage fallback draft is not a rewrite target: that
      // already is the deterministic path and it stays on it.
      if (validation.status !== "PASS" && useProvider && fallbackReason !== "writer_stage_failed") {
        const rewritten = await rewriteListingV5Draft(
          { context, strategy: strategyResult.strategy, blueprint: buildListingV5ConversionBlueprint(context, strategyResult.strategy), failedListing: draft, validation },
          { useProvider, onProviderCallStart },
        );
        rewriteTrace = rewritten?.trace ?? idleStageTrace();
        provider = { ...provider, rewriteAttempted: rewritten?.attempted === true };
        rewriteReason = rewritten?.attempted && !rewritten?.succeeded ? (rewritten.trace?.failureReason ?? "none") : null;
        if (rewritten?.succeeded && rewritten.draft) {
          draft = rewritten.draft;
          validation = validateListingV5Draft(context, strategyResult.strategy, draft, approvedBenefits);
          rewriteValidation = validation;
          // A rewrite normally lands on REPAIRABLE rather than PASS (the V5.2
          // spike measured BLOCK(5) -> REPAIRABLE(4) and BLOCK(6) -> REPAIRABLE(3)),
          // so the remaining repair budget is spent here - still at most one repair
          // for the whole generation.
          if (validation.status === "REPAIRABLE" && !repairUsed) {
            repairUsed = true;
            validation = await runRepair(validation, draft);
          }
        }
      }
      // Step 3 - V5.1 Safe Recovery, demoted to the last resort: every targeted
      // pass failed, so one bounded AI pass re-organises the sales expression of
      // the same Confirmed Facts before the pipeline falls back to the
      // deterministic template. Facts, Validator and repair semantics are
      // untouched, and the recovered draft must pass the same validation below.
      if (validation.status !== "PASS" && useProvider) {
        const recovered = await recoverListingV5Draft(
          { context, strategy: strategyResult.strategy, blueprint: buildListingV5ConversionBlueprint(context, strategyResult.strategy), failedDraft: draft, validation },
          { useProvider, onProviderCallStart },
        );
        recoveryTrace = recovered?.trace ?? idleStageTrace();
        recoveryReason = recovered?.attempted ? null : (recovered?.trace?.failureReason ?? "none");
        provider = { ...provider, recoveryAttempted: recovered?.attempted === true };
        if (recovered?.succeeded && recovered.draft) {
          draft = recovered.draft;
          validation = validateListingV5Draft(context, strategyResult.strategy, draft, approvedBenefits);
          recoveryValidation = validation;
        }
      }
      if (validation.status !== "PASS") {
        draft = buildListingV5FallbackDraft(context, strategyResult.strategy);
        provider = { ...provider, fallbackUsed: true };
        fallbackReason = "validation_blocked";
        validation = validateListingV5Draft(context, strategyResult.strategy, draft, approvedBenefits);
      }
    }
    // `analyze_strategy` refreshes the strategy only: it must not discard a
    // listing the user already generated, and it must never publish a
    // validation result that does not belong to the listing in the snapshot.
    const strategyOnly = action === "analyze_strategy";
    // A cached listing may only be carried forward when it belongs to the same
    // frozen context and was validated by the current Validator version.
    // Otherwise the draft is kept (the user's copy must not disappear) but its
    // validation is replaced by a fail-closed "not run" result: a stale PASS must
    // never be republished under a new fingerprint.
    // The context fingerprint already hashes the Validator version, so a matching
    // fingerprint proves both; a snapshot written before the explicit version
    // field existed is therefore acceptable through the fingerprint match alone.
    const carriedListing = strategyOnly && isRecord(cached?.listing) ? (cached.listing as unknown as ListingV5WriterDraft) : null;
    const carriedListingIsCurrent = carriedListing !== null
      && cached?.contextFingerprint === context.contextFingerprint
      && (cached?.validatorVersion === undefined || cached?.validatorVersion === LISTING_V5_VALIDATION_VERSION);
    const carriedValidation = carriedListingIsCurrent && isRecord(cached?.validation)
      ? (cached.validation as unknown as ListingV5ValidationResult)
      : null;
    const carriedProvider = strategyOnly && carriedListing && carriedListingIsCurrent && isRecord(cached?.provider) ? (cached.provider as typeof provider) : null;
    const carriedRepairApplied = strategyOnly && carriedListing && carriedListingIsCurrent ? cached?.repairApplied === true : null;
    const finalValidation = validation ?? carriedValidation;
    const snapshotListing = draft ?? carriedListing;
    const snapshotProvider = carriedProvider ?? provider;
    // Conversion intelligence layer (Phase 2/3/4): deterministic, provider-free,
    // and strictly additive. The Validator result above is never modified here.
    const conversionBlueprint = snapshotListing ? buildListingV5ConversionBlueprint(context, strategyResult.strategy) : null;
    const qualityEvaluation = snapshotListing && finalValidation
      ? evaluateListingV5Quality({
        context,
        strategy: strategyResult.strategy,
        blueprint: conversionBlueprint!,
        draft: snapshotListing,
        validation: finalValidation,
        deterministicFallback: snapshotProvider.fallbackUsed,
      })
      : null;
    const trace = buildListingV5ExecutionTrace({
      strategy: strategyResult.trace ?? idleStageTrace(),
      writer: writerTrace,
      repair: repairTrace,
      validation: firstValidation ?? finalValidation,
      finalValidation,
      recovery: recoveryTrace,
      recoveryValidation,
      recoveryReason,
      rewrite: rewriteTrace,
      rewriteValidation,
      rewriteReason,
      fallbackUsed: fallbackReason !== "none",
      fallbackReason,
    });
    const snapshot: ListingV5Snapshot = {
      version: "listing-v5.snapshot.v1", taskId: id, researchRevision: context.researchRevision, handoffRevision: context.handoffRevision, contextFingerprint: context.contextFingerprint,
      strategy: strategyResult.strategy, listing: snapshotListing, validation: finalValidation ?? NOT_VALIDATED_PLACEHOLDER,
      conversionBlueprint, qualityEvaluation,
      strategyPromptVersion: LISTING_V5_STRATEGY_PROMPT_VERSION, writerPromptVersion: LISTING_V5_WRITER_PROMPT_VERSION, validatorVersion: LISTING_V5_VALIDATION_VERSION, repairApplied: carriedRepairApplied ?? repairApplied, repairPromptVersion: LISTING_V5_REPAIR_PROMPT_VERSION, provider: snapshotProvider,       model: useProvider ? "configured-provider" : "deterministic-safe", generatedAt: new Date().toISOString(), humanReviewRequired: true,
      ...(isListingV5TraceEnabled() ? { trace } : {}),
    };
    const fresh = await buildContext(id, verified.ctx!);
    if (!fresh.context || fresh.context.contextFingerprint !== context.contextFingerprint) {
      if (useProvider) {
        const settled = settleQuota();
        if (!settled.ok) {
          ACTIVE_V5_JOBS.delete(jobKey);
          return error(settled.status, settled.code, settled.message);
        }
      }
      ACTIVE_V5_JOBS.delete(jobKey);
      return error(409, "listing_v5_stale_context", "研究资料在生成期间发生变化，请刷新后重新生成。");
    }
    if (useProvider) {
      const settled = settleQuota();
      if (!settled.ok) {
        ACTIVE_V5_JOBS.delete(jobKey);
        return error(settled.status, settled.code, settled.message);
      }
    }
    const expected = isRecord(body.expectedStorageVersion) && typeof body.expectedStorageVersion.resultJsonHash === "string" && typeof body.expectedStorageVersion.updatedAt === "string" ? body.expectedStorageVersion as { resultJsonHash: string; updatedAt: string } : undefined;
    const saved = await mutateTaskResultJson({ context: verified.ctx!, taskId: id, writer: "listing-v5", expectedStorageVersion: expected, mutate: (existing) => ({ result: { ...existing, listingV5: snapshot }, value: { saved: true } }) });
    const hash = createHash("sha256").update(saved.resultJson, "utf8").digest("hex");
    ACTIVE_V5_JOBS.delete(jobKey);
    return NextResponse.json({ ok: true, data: { snapshot: safeSnapshot(snapshot, context.researchRevision, context.handoffRevision, context.contextFingerprint), storageVersion: { resultJsonHash: hash, updatedAt: saved.updatedAt } } });
  } catch (err) {
    if (useProvider && !quotaSettled) {
      const settled = settleQuota();
      if (!settled.ok) {
        ACTIVE_V5_JOBS.delete(jobKey);
        return error(settled.status, settled.code, settled.message);
      }
    }
    ACTIVE_V5_JOBS.delete(jobKey);
    if (err instanceof TaskResultJsonMutationError) return error(err.status, err.code, err.message);
    return error(500, "listing_v5_failed", "Listing V5 暂时无法完成，请稍后重试。");
  }
}
