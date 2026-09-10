import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
import { markDemoAiProviderCallStarted, requireAuthenticated, reserveDemoAiCalls, settleDemoAiCalls } from "@/lib/server/demoGuard";
import { isRealAiListingEnabled, isRealAiVisitorListingEnabled } from "@/lib/server/realAiListingGate";
import type { AccessContext } from "@/lib/server/accessPassword";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { buildListingInputFromCreativeHandoff } from "@/lib/listingHandoff/listingGenerationInput";
import { mutateTaskResultJson, TaskResultJsonMutationError } from "@/lib/server/taskResultJsonMutation";
import { prisma } from "@/lib/server/db";
import { buildListingV5Context } from "@/lib/listingV5/context";
import { analyzeListingV5Strategy } from "@/lib/listingV5/strategy";
import { generateListingV5Draft, buildListingV5FallbackDraft } from "@/lib/listingV5/generation";
import { repairListingV5Draft } from "@/lib/listingV5/structuredRepair";
import { validateListingV5Draft } from "@/lib/listingV5/validation";
import type { ListingV5Snapshot, ListingV5Strategy } from "@/lib/listingV5/types";

const ACTIVE_V5_JOBS = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function error(status: number, code: string, message: string) { return NextResponse.json({ error: { code, message } }, { status }); }

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
  return { version: snapshot.version, researchRevision: snapshot.researchRevision, handoffRevision: snapshot.handoffRevision, strategy, listing, validation, repairApplied: snapshot.repairApplied === true, provider: snapshot.provider ?? { strategyAttempted: false, writerAttempted: false, repairAttempted: false, fallbackUsed: true }, humanReviewRequired: true, stale };
}

async function buildContext(taskId: string, ctx: AccessContext) {
  const gate = await checkCreativeHandoffGate(taskId, ctx);
  const latestHandoff = gate.currentHandoff?.versions[gate.currentHandoff.versions.length - 1];
  const hasListingConfirmedFact = Boolean(latestHandoff?.confirmedFacts.some((fact) => fact.usageScopes.includes("listing")));
  const degradedGateWithPersistedFacts = gate.reason === "no_confirmed_facts" && hasListingConfirmedFact;
  if ((!gate.allowed && !degradedGateWithPersistedFacts) || !gate.currentHandoff || !gate.candidate) return { gate, context: null };
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
  if (!context) return error(422, gate.reason, "当前研究资料还不能生成 Listing V5。请先完成研究与人工确认。");
  const result = await readResult(id, verified.ctx!);
  return NextResponse.json({ ok: true, data: { context: { researchRevision: context.researchRevision, handoffRevision: context.handoffRevision, contextFingerprint: context.contextFingerprint, factCount: context.confirmedFacts.length, referenceCounts: { voc: context.references.voc.length, keywords: context.references.keywords.length, competitors: context.references.competitors.length, sourcing: context.references.sourcing.length } }, snapshot: safeSnapshot(result?.listingV5, context.researchRevision, context.handoffRevision, context.contextFingerprint) } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return error(400, "invalid_json", "请求格式无效。") }
  if (!isRecord(body)) return error(400, "invalid_json", "请求格式无效。");
  const verified = auth(req, id, body);
  if (verified.response) return verified.response;
  const action = body.action === "analyze_strategy" || body.action === "generate" || body.action === "revalidate" ? body.action : null;
  if (!action) return error(400, "invalid_action", "只支持 analyze_strategy、generate 或 revalidate。");
  const prepared = await buildContext(id, verified.ctx!);
  if (!prepared.context) return error(422, prepared.gate.reason, "当前研究资料还不能生成 Listing V5。请先完成研究与人工确认。");
  const context = prepared.context;
  const current = await readResult(id, verified.ctx!);
  const cached = isRecord(current?.listingV5) ? current.listingV5 : null;
  const forceStrategy = action === "analyze_strategy" && body.forceStrategy === true;
  const cachedStrategy = !forceStrategy && cached && cached.version === "listing-v5.snapshot.v1"
    && cached.researchRevision === context.researchRevision
    && cached.handoffRevision === context.handoffRevision
    && cached.contextFingerprint === context.contextFingerprint
    && isRecord(cached.strategy)
    ? cached.strategy as unknown as ListingV5Strategy
    : null;
  const jobKey = `${id}:${action}:${context.contextFingerprint}`;
  if (ACTIVE_V5_JOBS.has(jobKey)) return error(409, "listing_v5_running", "Listing V5 正在处理中，请等待当前请求完成。");
  ACTIVE_V5_JOBS.add(jobKey);
  const useProvider = isRealAiListingEnabled();
  if (useProvider && verified.ctx!.mode === "demo" && !isRealAiVisitorListingEnabled()) {
    ACTIVE_V5_JOBS.delete(jobKey);
    return error(403, "visitor_listing_generation_disabled", "Listing 真实 AI 暂未对访客开放。");
  }
  if (useProvider && body.confirmRealAi !== true) {
    ACTIVE_V5_JOBS.delete(jobKey);
    return error(400, "real_ai_confirmation_required", "调用真实 AI 前需要再次确认。");
  }
  const plannedCalls = action === "analyze_strategy" ? 1 : cachedStrategy ? 2 : 3;
  const quota = useProvider ? reserveDemoAiCalls(verified.ctx!, plannedCalls) : { ok: true as const, reservation: null };
  if (!quota.ok) {
    ACTIVE_V5_JOBS.delete(jobKey);
    return error(quota.status, quota.code, quota.message);
  }
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
    const strategyResult = cachedStrategy ? { strategy: cachedStrategy, providerAttempted: false, providerSucceeded: false } : await analyzeListingV5Strategy(context, { useProvider, onProviderCallStart });
    let draft = null;
    let validation = null;
    let repairApplied = false;
    let provider = { strategyAttempted: strategyResult.providerAttempted, writerAttempted: false, repairAttempted: false, fallbackUsed: false };
    if (action !== "analyze_strategy") {
      const generated = await generateListingV5Draft(context, strategyResult.strategy, { useProvider, onProviderCallStart });
      draft = generated.draft; provider = { ...provider, writerAttempted: generated.providerAttempted, fallbackUsed: !generated.providerSucceeded };
      validation = validateListingV5Draft(context, strategyResult.strategy, draft);
      if (validation.status === "REPAIRABLE") {
        const repaired = await repairListingV5Draft({ context, strategy: strategyResult.strategy, validation, draft, useProvider, onProviderCallStart });
        provider = { ...provider, repairAttempted: repaired.attempted, fallbackUsed: provider.fallbackUsed || !repaired.succeeded };
        repairApplied = repaired.attempted;
        draft = repaired.draft;
        validation = validateListingV5Draft(context, strategyResult.strategy, draft);
      }
      if (validation.status === "BLOCK") {
        draft = buildListingV5FallbackDraft(context, strategyResult.strategy);
        provider = { ...provider, fallbackUsed: true };
        validation = validateListingV5Draft(context, strategyResult.strategy, draft);
      }
    }
    const snapshot: ListingV5Snapshot = {
      version: "listing-v5.snapshot.v1", taskId: id, researchRevision: context.researchRevision, handoffRevision: context.handoffRevision, contextFingerprint: context.contextFingerprint,
      strategy: strategyResult.strategy, listing: draft, validation: validation ?? { version: "listing-v5.validation.v1", status: "PASS", title: { valid: true, issues: [] }, bullets: [], description: { valid: true, issues: [] }, claims: { allHaveEvidence: true, unsupportedClaims: [], prohibitedClaims: [], competitorOverlap: [] }, quality: { repetitive: false, keywordStuffing: false, mechanicalTemplate: false }, repair: { allowed: false, reason: null } },
      strategyPromptVersion: "listing-v5-strategy.v1", writerPromptVersion: "listing-v5-writer.v1", validatorVersion: "listing-v5.validation.v1", repairApplied, repairPromptVersion: "listing-v5-repair.v1", provider, model: useProvider ? "configured-provider" : "deterministic-safe", generatedAt: new Date().toISOString(), humanReviewRequired: true,
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
