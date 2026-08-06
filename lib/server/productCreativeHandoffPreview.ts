import "server-only";

import { createHash } from "node:crypto";

function hash256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

import type { AccessContext } from "@/lib/server/accessPassword";
import { prisma } from "@/lib/server/db";
import { getSandboxTask, isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  getProductResearchRecord,
  getProductResearchVerification,
  verifyProductResearchHash,
  hasProductResearchRecordNamespace,
} from "@/lib/productResearchRecord";
import {
  projectProductCreativeHandoffCandidate,
  ProductCreativeHandoffProjectionError,
  type ProductCreativeHandoffProjectionEvidence,
} from "@/lib/productCreativeHandoffProjection";
import { buildProductCreativeHandoffProjectionEvidence, ProjectionEvidenceAdapterError } from "@/lib/productCreativeHandoffProjectionEvidence";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { parseCandidateResearchContext } from "@/lib/candidateResearchContext";
import { adaptResearchContextForHandoff } from "@/lib/server/researchContextAdapter";
import { extractVisualReferenceCandidates } from "@/lib/server/visualReferenceCandidates";
import { extractAgentOutputSnapshotFromTask } from "@/lib/agentOutputSnapshot";
import {
  parseProductCreativeHandoff,
} from "@/lib/productCreativeHandoff";
import { parseRequestLedger, type CreativeHandoffRequestLedgerV1 } from "@/lib/creativeHandoffRequestLedger";
import { evaluateHandoffStatus } from "@/lib/productCreativeHandoffStatus";
import type {
  ProductCreativeHandoffCandidate,
  ProductCreativeHandoffV1,
  ProductCreativeHandoffConfirmedFact,
} from "@/lib/productCreativeHandoff";

// ─── DTO types ────────────────────────────────────────────

export type CreativeHandoffEligibility =
  | "eligible"
  | "no_confirmed_facts"
  | "legacy_not_supported"
  | "decision_not_creative_ready"
  | "workflow_incomplete"
  | "research_hash_invalid"
  | "verification_invalid"
  | "candidate_identity_mismatch"
  | "blocking_issue_present"
  | "research_mode_invalid";

/** Safe browser preview — no candidateId, no internal hashes, no actor refs */
export type CreativeHandoffPreview = {
  eligibility: CreativeHandoffEligibility;
  researchDecisionSummary?: {
    decisionStatus: string;
    workflowStatus: string;
    researchRevision: number;
    /** Safe short research fingerprint — not the full hash */
    researchFingerprint: string;
  };
  candidateFactOptions?: {
    selectionId: string;
    field: string;
    label: string;
    valueSummary: string;
  }[];
  /** Fix.4: 可人工确认候选（仅服务端稳定来源事实，AI/unknown/conflict 永不进入） */
  confirmableFactCandidates?: {
    selectionId: string;
    canonicalField: string;
    displayValue: string;
    sourceKindSummary: string;
    capturedAt: string;
    allowedUsageScopes: string[];
    humanConfirmationRequired: true;
    provenanceSummary: string;
  }[];
  stableSourceFacts?: {
    selectionId: string;
    field: string;
    label: string;
    stabilityRule: string;
  }[];
  aiReferences?: {
    selectionId: string;
    field: string;
    summary: string;
    allowedUse: string;
  }[];
  issues?: {
    selectionId: string;
    field: string;
    kind: string;
    summary: string;
    risk: string;
  }[];
  prohibitedClaims?: {
    selectionId: string;
    category: string;
    summary: string;
    appliesTo: string[];
  }[];
  creativePreferences?: {
    targetMarket?: string;
    language?: string;
    tone?: string;
    imageStyle?: string;
  };
  visualReferenceCandidates?: {
    selectionId: string;
    sourceTier: string;
    approvedForReference: boolean;
    summary?: string;
    contentHash?: string;
    /** V2 Visual Preview: 安全缩略图地址（同源 API；仅当候选人已绑定本任务时非空） */
    thumbnailUrl?: string;
  }[];
  blockingCodes?: string[];
  expectedResearchRevision?: number;
  expectedCurrentHandoffRevision?: number;
  storageVersion?: { resultJsonHash: string; updatedAt: string };
};

/** Safe browser detail */
export type CreativeHandoffDetail = {
  handoffId?: string;
  currentRevision?: number;
  controlState?: string;
  effectiveStatus: string;
  staleReasonCode?: string;
  canCreateNewRevision: boolean;
  humanReviewRequired: boolean;
  sourceResearchRevision?: number;
  confirmedFacts?: { field: string; label: string; usageScopes: string[] }[];
  prohibitedClaims?: { category: string; summary: string; appliesTo: string[] }[];
  versions?: { revision: number; createdAt: string; confirmedFactFields: string[] }[];
  createdAt?: string;
  storageVersion?: { resultJsonHash: string; updatedAt: string };
};

export type CreativeHandoffGateResult = {
  allowed: boolean;
  reason: CreativeHandoffEligibility;
  candidate?: ProductCreativeHandoffCandidate;
  currentHandoff?: ProductCreativeHandoffV1 | null;
  storageVersion?: { resultJsonHash: string; updatedAt: string };
  /** true 当 resultJson 中存在 creativeHandoff 但严格 Parser 失败 — 必须 fail-closed */
  handoffContractInvalid?: boolean;
  /** 当前存储的 Request Ledger（严格解析失败时 null 且 ledgerInvalid=true） */
  requestLedger?: CreativeHandoffRequestLedgerV1 | null;
  ledgerInvalid?: boolean;
  /** 无人工确认事实时展示的证据层（来源/AI/issues，不可创建） */
  evidenceLayers?: ProductCreativeHandoffProjectionEvidence[];
  /** PR2-2: Listing Handoff Binding 原始值（只读，供 Listing 状态计算） */
  listingHandoffBindingRaw?: unknown;
  /** PR2-2: 当前存储的 Listing 草稿原始值（只读，供 Listing 状态/摘要计算） */
  listingDraftRaw?: unknown;
  /** PR2-3: Image Handoff Binding 原始值（只读，供 Image 状态计算） */
  imageHandoffBindingRaw?: unknown;
  /** PR2-3: 当前存储的 Image Draft 摘要原始值（只读） */
  imageDraftRaw?: unknown;
  /** V2 Final Integration: 生产视觉参考候选（从 candidateAnalysisContext.productImage 解析，安全摘要） */
  visualReferenceCandidates?: Array<{
    selectionId: string;
    sourceKind: string;
    summary: string;
    contentHash: string;
    approvable: true;
  }>;
  /** Final Capability: 批准参考的原始图片（dataUrl base64；仅服务端使用，供真实参考图 Provider 输入；Browser DTO 绝不包含） */
  approvedReferenceImageDataUrl?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────

function safeFingerprint(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(16).padStart(8, "0").slice(0, 8);
}

/** SHA-256 hex — 浏览器不可还原完整 resultJson */
function fullHash(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * 服务端确定性 selectionId — 域分隔绑定 subject kind + taskId + researchRevision + 类别 + 规范化内容。
 * 不包含原始 candidateId；跨 Task / 跨主体 / Revision 变化 / 内容变化后均失效；
 * 服务端从最新 Preview 重新计算与查找，不作为授权令牌。
 */
function makeSelectionId(
  subjectKind: "owner" | "visitor",
  taskId: string,
  researchRevision: number,
  prefix: string,
  id: string,
): string {
  const canonical = JSON.stringify({
    schema: "creative-handoff-selection-id:v1",
    subjectKind,
    taskId,
    researchRevision,
    category: prefix,
    // Fix.5: confirm 类 selectionId 必须用原始稳定 factId（与 Persistence encodeConfirmSelectionId 一致）；
    // 其他展示类（stable/ai/issue 等）保持 safeFingerprint 展示语义。
    contentFingerprint: prefix === "confirm" ? id : safeFingerprint(id),
  });
  return `${prefix}:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24)}`;
}

function parseResultJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const p = JSON.parse(raw);
    return (typeof p === "object" && p !== null && !Array.isArray(p)) ? p as Record<string, unknown> : null;
  } catch { return null; }
}

// ─── Gate (dual storage path) ─────────────────────────────

export async function checkCreativeHandoffGate(
  taskId: string,
  context: AccessContext,
): Promise<CreativeHandoffGateResult> {
  let task: Record<string, unknown> | null = null;
  let resultJsonStr: string | null = null;
  let updatedAt: string | null = null;

  // ── P1-4 fix: Dual storage path ──
  const isSandbox = isSandboxTaskId(taskId) || taskId.startsWith("demo-") || taskId.startsWith("sandbox-");
  if (isSandbox) {
    const ctxAny = context as unknown as Record<string, unknown>;
    const demoAccessId = ctxAny.demoAccessId as string;
    if (!demoAccessId) return { allowed: false, reason: "legacy_not_supported" };
    const sandbox = getSandboxTask(demoAccessId, taskId);
    if (!sandbox) return { allowed: false, reason: "legacy_not_supported" };
    const sb = sandbox as unknown as Record<string, unknown>;
    task = sb;
    resultJsonStr = sb.resultJson as string;
    updatedAt = sb.updatedAt as string;
  } else {
    const db = await prisma.viralAnalysisRecord.findUnique({ where: { id: taskId } });
    if (!db) return { allowed: false, reason: "legacy_not_supported" };
    task = db as unknown as Record<string, unknown>;
    resultJsonStr = (db as Record<string, unknown>).resultJson as string;
    updatedAt = (db as Record<string, unknown>).updatedAt as unknown as string;
  }

  const ctxAny = context as unknown as Record<string, unknown>;

  // Ownership check
  const taskUserId = task.userId as string | undefined;
  const taskDemoAccessId = task.demoAccessId as string | undefined;
  if (context.mode === "owner" && taskUserId !== (ctxAny.ownerRef as string)) {
    return { allowed: false, reason: "legacy_not_supported" };
  }
  if (context.mode === "demo" && taskDemoAccessId !== (ctxAny.demoAccessId as string)) {
    return { allowed: false, reason: "legacy_not_supported" };
  }

  const resultJson = parseResultJson(resultJsonStr || "");
  if (!resultJson) return { allowed: false, reason: "legacy_not_supported" };

  if (!hasProductResearchRecordNamespace(resultJson)) {
    return { allowed: false, reason: "legacy_not_supported" };
  }

  const record = getProductResearchRecord(resultJson);
  const verification = getProductResearchVerification(resultJson);
  if (!record || !verification) return { allowed: false, reason: "legacy_not_supported" };

  if (!verifyProductResearchHash(record, verification)) {
    return { allowed: false, reason: "research_hash_invalid" };
  }

  if (record.latestDecision?.status !== "creative_ready") {
    return { allowed: false, reason: "decision_not_creative_ready" };
  }

  const taskRec = task as Record<string, unknown>;
  const researchMode = taskRec.researchMode as string | undefined;
  if (researchMode && researchMode !== "market_research_only") {
    return { allowed: false, reason: "research_mode_invalid" };
  }

  const recAny = record as unknown as Record<string, unknown>;
  const verAny = verification as unknown as Record<string, unknown>;

  // ── Fix.3: 真实投影链 — 从权威 Task 构造 ProjectionEvidence → projectProductCreativeHandoffCandidate ──
  // 同一商品实体门禁 + 五层证据边界均由 Adapter / 投影函数保证。
  let candidate: ProductCreativeHandoffCandidate | null = null;
  let projectionBlockingCodes: string[] = [];
  let projectionChecks: { checkId: string; passed: boolean; blocksHandoff: boolean; summary: string }[] = [];
  let noConfirmedFacts = false;
  // V2 BLOCKER 修复：真实 save-task 写入 CandidateAnalysisContextV1，经 Research Context
  // Adapter 确定性转换为 Handoff 可消费格式；已兼容格式原样通过。适配失败按 fail-closed 处理。
  const contextRaw = resultJson.candidateAnalysisContext;
  const adaptedContext = contextRaw !== undefined
    ? adaptResearchContextForHandoff(resultJson)
    : null;
  const researchContext = adaptedContext?.ok === true ? adaptedContext.context : null;
  const agentOutput = extractAgentOutputSnapshotFromTask(resultJson);
  if (researchContext) {
    const projectionInput = buildProductCreativeHandoffProjectionEvidence({
      researchRecord: record,
      context: researchContext,
      agentOutput,
      researchRevision: record.revision,
      researchHash: record.researchHash,
    });
    projectionChecks = projectionInput.deterministicChecks;
    try {
      const projectionResult = projectProductCreativeHandoffCandidate({
        sourceResearch: {
          recordSchema: "product-research-record.v1",
          candidateId: record.candidateId,
          researchRevision: record.revision,
          researchHash: record.researchHash,
          workflowStatus: "completed",
          decisionStatus: "creative_ready",
          candidateSourceFingerprint: researchContext.contextHash.slice(0, 16),
        },
        productIdentity: {
          displayName: (taskRec.productName as string) || (taskRec.title as string) || "",
          identityConfirmedAt: (taskRec.createdAt instanceof Date ? taskRec.createdAt.toISOString() : (taskRec.createdAt as string)) || new Date().toISOString(),
        },
        evidence: projectionInput.evidence,
        prohibitedClaims: [{
          claimId: "00000000-0000-4000-8000-000000000001",
          category: "absolute_claim" as const,
          summary: "Do not make absolute claims.",
          appliesTo: ["both" as const],
          source: "system_rule" as const,
        }],
        creativePreferences: { evidenceTier: "creative_preference" as const },
        visualReferences: [],
      });
      candidate = projectionResult.candidate;
      projectionBlockingCodes = projectionResult.blockingCodes;
    } catch (error) {
      if (error instanceof ProductCreativeHandoffProjectionError
        && error.code === "invalid_projected_candidate") {
        // 无人工确认事实（PR2-0 强制 confirmedFacts ≥1，当前系统无 user_confirmation 生产点）
        // Preview 仍可显示来源/AI/issues 层；Create 将返回 no_facts_selected。
        noConfirmedFacts = true;
      } else {
        throw error;
      }
    }
  }

  if (noConfirmedFacts) {
    // 研究合法但无人工确认事实（PR2-0 强制 confirmedFacts ≥1，当前系统无 user_confirmation 生产点）
    // Preview 仍显示来源/AI/issues 层（指令第十一节）；Create 将返回 no_facts_selected。
    // 把投影前的证据层附加到 Gate（供 Preview 展示），但 allowed=false（不可创建）。
    const contextRaw2 = resultJson.candidateAnalysisContext;
    const adaptedContext2 = contextRaw2 !== undefined
      ? adaptResearchContextForHandoff(resultJson)
      : null;
    const researchContext2 = adaptedContext2?.ok === true ? adaptedContext2.context : null;
    const agentOutput2 = extractAgentOutputSnapshotFromTask(resultJson);
    let evidenceLayers: ProductCreativeHandoffProjectionEvidence[] = [];
    if (researchContext2) {
      try {
        evidenceLayers = buildProductCreativeHandoffProjectionEvidence({
          researchRecord: record,
          context: researchContext2,
          agentOutput: agentOutput2,
          researchRevision: record.revision,
          researchHash: record.researchHash,
        }).evidence;
      } catch { /* 投影失败时不展示 */ }
    }
    // Ledger fail-closed 状态（与主路径一致）
    let ledgerInvalidHere = false;
    const ledgerRawHere = resultJson.creativeHandoffRequestLedger;
    if (ledgerRawHere !== undefined && !parseRequestLedger(ledgerRawHere)) {
      ledgerInvalidHere = true;
    }
    // currentHandoff 状态（供 Detail 显示 revision/controlState）
    let currentHandoffHere: ProductCreativeHandoffV1 | null = null;
    const handoffRawHere = resultJson.creativeHandoff;
    if (handoffRawHere !== undefined) {
      currentHandoffHere = parseProductCreativeHandoff(handoffRawHere);
    }
    // Fix.4: 从证据层构造候选（含 stable facts，confirmedFacts 留空）
    // 供 Persistence 锁内生成 confirmable 候选；Preview 展示来源层。
    const candidateHere: ProductCreativeHandoffCandidate = {
      sourceResearch: {
        recordSchema: "product-research-record.v1",
        candidateId: record.candidateId,
        researchRevision: record.revision,
        researchHash: record.researchHash,
        workflowStatus: "completed",
        decisionStatus: "creative_ready",
        candidateSourceFingerprint: (researchContext2?.contextHash ?? "0".repeat(64)),
      },
      productIdentity: {
        displayName: (taskRec.productName as string) || (taskRec.title as string) || "",
        identityConfirmedAt: (taskRec.createdAt instanceof Date ? taskRec.createdAt.toISOString() : (taskRec.createdAt as string)) || new Date().toISOString(),
      },
      confirmedFacts: [],
      stableSourceFacts: evidenceLayers
        .filter((e): e is Extract<typeof e, { evidenceTier: "source_snapshot" }> => e.evidenceTier === "source_snapshot")
        .map((e) => e.fact),
      aiCreativeReferences: evidenceLayers
        .filter((e): e is Extract<typeof e, { evidenceTier: "ai_hypothesis" }> => e.evidenceTier === "ai_hypothesis")
        .map((e) => e.reference),
      issues: evidenceLayers
        .filter((e): e is Extract<typeof e, { evidenceTier: "unknown_or_conflict" }> => e.evidenceTier === "unknown_or_conflict")
        .map((e) => e.issue),
      prohibitedClaims: [{
        claimId: "00000000-0000-4000-8000-000000000001",
        category: "absolute_claim" as const,
        summary: "Do not make absolute claims.",
        appliesTo: ["both" as const],
        source: "system_rule" as const,
      }],
      creativePreferences: { evidenceTier: "creative_preference" as const },
      visualReferences: [],
      humanReviewRequired: true,
    };
    return {
      allowed: false,
      reason: "no_confirmed_facts",
      storageVersion: {
        resultJsonHash: fullHash(resultJsonStr || ""),
        updatedAt: updatedAt || new Date().toISOString(),
      },
      handoffContractInvalid: false,
      evidenceLayers,
      ledgerInvalid: ledgerInvalidHere,
      currentHandoff: currentHandoffHere,
      candidate: candidateHere,
      listingHandoffBindingRaw: resultJson.listingHandoffBinding,
      listingDraftRaw: resultJson.aiListingPackSnapshot,
      imageHandoffBindingRaw: resultJson.imageHandoffBinding,
      imageDraftRaw: resultJson.aiImageDraftSnapshot,
      // V2 Final Integration: 降级分支也暴露生产视觉候选（从 researchContext2.productImage 解析）
      visualReferenceCandidates: researchContext2
        ? extractVisualReferenceCandidates(
            researchContext2,
            context.mode === "owner" ? "owner" : "visitor",
            taskId,
            record.revision,
          )
        : [],
      // Final Capability: 降级分支同样提供批准参考图（供真实参考图 Provider 输入）
      approvedReferenceImageDataUrl: (() => {
        const ref = currentHandoffHere?.versions?.[currentHandoffHere.versions.length - 1]?.visualReferences?.[0];
        if (ref && researchContext2?.productImage
          && ref.assetFingerprint === hash256(`visual-reference:${researchContext2.productImage.contentHash}`)) {
          return researchContext2.productImage.dataUrl;
        }
        return null;
      })(),
    };
  }

  if (!candidate && projectionBlockingCodes.length === 0) {
    // 无 candidateAnalysisContext 或投影失败 → 按 legacy_not_supported 处理（fail-closed）
    return { allowed: false, reason: "legacy_not_supported", storageVersion: undefined, handoffContractInvalid: false };
  }

  // blocking issue 门禁
  if (!candidate || projectionBlockingCodes.length > 0) {
    return { allowed: false, reason: "blocking_issue_present", storageVersion: undefined };
  }

  const currentHandoffRaw = resultJson.creativeHandoff;
  let currentHandoff: ProductCreativeHandoffV1 | null = null;
  let handoffContractInvalid = false;
  if (currentHandoffRaw !== undefined) {
    if (typeof currentHandoffRaw !== "object" || currentHandoffRaw === null) {
      handoffContractInvalid = true;
    } else {
      currentHandoff = parseProductCreativeHandoff(currentHandoffRaw);
      if (!currentHandoff) handoffContractInvalid = true;
    }
  }

  // Ledger 只读解析（fail-closed：解析失败 → ledgerInvalid）
  let requestLedger: CreativeHandoffRequestLedgerV1 | null = null;
  let ledgerInvalid = false;
  const ledgerRaw = resultJson.creativeHandoffRequestLedger;
  if (ledgerRaw !== undefined) {
    const parsedLedger = parseRequestLedger(ledgerRaw);
    if (parsedLedger) requestLedger = parsedLedger;
    else ledgerInvalid = true;
  }

  const listingHandoffBindingRaw = resultJson.listingHandoffBinding;
  const listingDraftRaw = resultJson.aiListingPackSnapshot;

  const storageVersion = {
    resultJsonHash: fullHash(resultJsonStr || ""),
    updatedAt: updatedAt || new Date().toISOString(),
  };

  if (handoffContractInvalid) {
    return { allowed: false, reason: "legacy_not_supported", candidate: undefined, currentHandoff: null, storageVersion, handoffContractInvalid: true, requestLedger, ledgerInvalid };
  }

  // V2 Final Integration: 生产视觉参考候选（candidateAnalysisContext.productImage → 安全候选）
  const visualCandidates = extractVisualReferenceCandidates(
    researchContext,
    context.mode === "owner" ? "owner" : "visitor",
    taskId,
    record.revision,
  );

  // Final Capability: 批准参考的原始图片（仅当 Handoff 有批准视觉参考且 contentHash 匹配当前候选时）
  // 从 researchContext.productImage.dataUrl 直接取得；供真实参考图 Provider（images.edit）输入。
  // 此字段只进服务端 input（阶段B），Browser DTO 与 mock 路径均不包含。
  let approvedReferenceImageDataUrl: string | null = null;
  // 从当前 Handoff 的批准参考读取（投影 candidate 的 visualReferences 恒空；必须读 currentHandoff 版本）
  const approvedVisualRef = currentHandoff?.versions?.[currentHandoff.versions.length - 1]?.visualReferences?.[0]
    ?? candidate?.visualReferences?.[0];
  if (approvedVisualRef && researchContext?.productImage
    && approvedVisualRef.assetFingerprint === hash256(`visual-reference:${researchContext.productImage.contentHash}`)) {
    approvedReferenceImageDataUrl = researchContext.productImage.dataUrl;
  }

  return { allowed: true, reason: "eligible", candidate, currentHandoff, storageVersion, requestLedger, ledgerInvalid, listingHandoffBindingRaw, listingDraftRaw, imageHandoffBindingRaw: resultJson.imageHandoffBinding, imageDraftRaw: resultJson.aiImageDraftSnapshot, visualReferenceCandidates: visualCandidates, approvedReferenceImageDataUrl };
}

// ─── Preview ──────────────────────────────────────────────

export async function generateCreativeHandoffPreview(
  taskId: string,
  context: AccessContext,
): Promise<{ preview: CreativeHandoffPreview | null; gate: CreativeHandoffGateResult }> {
  const gate = await checkCreativeHandoffGate(taskId, context);

  // 无人工确认事实：返回来源层信息（stable/AI/issues）+ confirmable 候选，不可创建
  if (!gate.allowed && gate.reason === "no_confirmed_facts" && gate.evidenceLayers) {
    const layers = gate.evidenceLayers;
    const degradedRevision = gate.candidate?.sourceResearch.researchRevision ?? 1;
    const degradedSelection = (prefix: string, id: string) =>
      makeSelectionId(context.mode === "owner" ? "owner" : "visitor", taskId, degradedRevision, prefix, id);
    // Fix.5: 降级分支复用与正常 eligible 分支完全相同的候选构造（同一函数、同一 selectionId 作用域）
    const degradedConfirmables = gate.candidate
      ? buildConfirmableCandidates(gate.candidate.stableSourceFacts).map((c) => ({
          selectionId: degradedSelection("confirm", c.selectionKey),
          canonicalField: c.field,
          displayValue: typeof c.value === "string" ? c.value.slice(0, 200) : String(c.value).slice(0, 200),
          sourceKindSummary: c.sourceKind,
          capturedAt: c.capturedAt,
          allowedUsageScopes: c.allowedUsageScopes,
          humanConfirmationRequired: true as const,
          provenanceSummary: `来源快照 (${c.sourceKind}) 捕获于 ${c.capturedAt.slice(0, 10)}，需人工确认后方可作事实使用。`,
        }))
      : [];
    const preview: CreativeHandoffPreview = {
      eligibility: "eligible",
      researchDecisionSummary: {
        decisionStatus: "creative_ready",
        workflowStatus: "completed",
        researchRevision: degradedRevision,
        researchFingerprint: "",
      },
      candidateFactOptions: [],
      confirmableFactCandidates: degradedConfirmables,
      stableSourceFacts: layers
        .filter((e): e is Extract<typeof e, { evidenceTier: "source_snapshot" }> => e.evidenceTier === "source_snapshot")
        .map((e) => ({
          selectionId: makeSelectionId(context.mode === "owner" ? "owner" : "visitor", taskId, degradedRevision, "stable", e.fact.factId),
          field: e.fact.field,
          label: e.fact.label,
          stabilityRule: e.fact.stabilityRule,
        })),
      aiReferences: layers
        .filter((e): e is Extract<typeof e, { evidenceTier: "ai_hypothesis" }> => e.evidenceTier === "ai_hypothesis")
        .map((e) => ({
          selectionId: makeSelectionId(context.mode === "owner" ? "owner" : "visitor", taskId, degradedRevision, "ai", e.reference.referenceId),
          field: e.reference.field,
          summary: e.reference.summary.slice(0, 200),
          allowedUse: e.reference.allowedUse,
        })),
      issues: layers
        .filter((e): e is Extract<typeof e, { evidenceTier: "unknown_or_conflict" }> => e.evidenceTier === "unknown_or_conflict")
        .map((e) => ({
          selectionId: makeSelectionId(context.mode === "owner" ? "owner" : "visitor", taskId, degradedRevision, "issue", e.issue.issueId),
          field: e.issue.field,
          kind: e.issue.kind,
          summary: e.issue.summary.slice(0, 200),
          risk: e.issue.risk,
        })),
      expectedResearchRevision: degradedRevision,
      expectedCurrentHandoffRevision: gate.currentHandoff?.currentRevision ?? 0,
      storageVersion: gate.storageVersion,
      // V2 Final Integration: 降级分支也展示生产视觉候选（用户可批准；批准后 Create 仍可执行）
      visualReferenceCandidates: (gate.visualReferenceCandidates ?? []).map((v) => ({
        selectionId: v.selectionId,
        sourceTier: v.sourceKind,
        approvedForReference: v.approvable === true,
        summary: v.summary,
        contentHash: v.contentHash.slice(0, 8),
        // V2 Visual Preview: 安全缩略图地址（同源 API，selectionId 即绑定凭据）
        thumbnailUrl: `/api/tasks/${encodeURIComponent(taskId)}/visual-reference-preview?ref=${encodeURIComponent(v.selectionId)}`,
      })),
    };
    return { preview, gate };
  }

  if (!gate.allowed || !gate.candidate) return { preview: null, gate };

  const subjectKind = context.mode === "owner" ? "owner" : "visitor";
  const researchRevision = gate.candidate.sourceResearch.researchRevision;
  const selection = (prefix: string, id: string) => makeSelectionId(subjectKind, taskId, researchRevision, prefix, id);

  const preview: CreativeHandoffPreview = {
    eligibility: "eligible",
    researchDecisionSummary: {
      decisionStatus: "creative_ready",
      workflowStatus: "completed",
      researchRevision,
      // P1-2 fix: Safe fingerprint, NOT candidateId
      researchFingerprint: safeFingerprint(gate.candidate.sourceResearch.candidateId),
    },
    candidateFactOptions: gate.candidate.confirmedFacts.map((f: ProductCreativeHandoffConfirmedFact) => ({
      selectionId: selection("fact", f.factId),
      field: f.field,
      label: f.label,
      valueSummary: typeof f.value === "string" ? f.value.slice(0, 200) : String(f.value).slice(0, 200),
    })),
    // Fix.4: 可人工确认候选（仅 stable 层 human_confirmation_required_for_claim）
    confirmableFactCandidates: buildConfirmableCandidates(gate.candidate.stableSourceFacts).map((c) => ({
      selectionId: selection("confirm", c.selectionKey),
      canonicalField: c.field,
      displayValue: typeof c.value === "string" ? c.value.slice(0, 200) : String(c.value).slice(0, 200),
      sourceKindSummary: c.sourceKind,
      capturedAt: c.capturedAt,
      allowedUsageScopes: c.allowedUsageScopes,
      humanConfirmationRequired: true,
      provenanceSummary: `来源快照 (${c.sourceKind}) 捕获于 ${c.capturedAt.slice(0, 10)}，需人工确认后方可作事实使用。`,
    })),
    stableSourceFacts: gate.candidate.stableSourceFacts.map((f) => ({
      selectionId: selection("stable", f.factId),
      field: f.field,
      label: f.label,
      stabilityRule: f.stabilityRule,
    })),
    aiReferences: gate.candidate.aiCreativeReferences.map((r) => ({
      selectionId: selection("ai", r.referenceId),
      field: r.field,
      summary: r.summary.slice(0, 200),
      allowedUse: r.allowedUse,
    })),
    issues: gate.candidate.issues.map((i) => ({
      selectionId: selection("issue", i.issueId),
      field: i.field,
      kind: i.kind,
      summary: i.summary.slice(0, 200),
      risk: i.risk,
    })),
    prohibitedClaims: gate.candidate.prohibitedClaims.map((c) => ({
      selectionId: selection("claim", c.claimId),
      category: c.category,
      summary: c.summary.slice(0, 200),
      appliesTo: [...c.appliesTo],
    })),
    creativePreferences: { tone: (gate.candidate.creativePreferences as Record<string, unknown>).tone as string | undefined },
    visualReferenceCandidates: (gate.visualReferenceCandidates ?? []).map((v) => ({
      selectionId: v.selectionId,
      sourceTier: v.sourceKind,
      approvedForReference: v.approvable === true,
      summary: v.summary,
      contentHash: v.contentHash.slice(0, 8),
      // V2 Visual Preview: 安全缩略图地址（同源 API，selectionId 即绑定凭据）
      thumbnailUrl: `/api/tasks/${encodeURIComponent(taskId)}/visual-reference-preview?ref=${encodeURIComponent(v.selectionId)}`,
    })),
    expectedResearchRevision: gate.candidate.sourceResearch.researchRevision,
    expectedCurrentHandoffRevision: gate.currentHandoff?.currentRevision ?? 0,
    storageVersion: gate.storageVersion,
  };

  return { preview, gate };
}

// ─── Detail ───────────────────────────────────────────────

export async function getCreativeHandoffDetail(
  taskId: string,
  context: AccessContext,
): Promise<{ detail: CreativeHandoffDetail | null; gate: CreativeHandoffGateResult }> {
  const gate = await checkCreativeHandoffGate(taskId, context);
  // Fix.5: no_confirmed_facts 是合法研究状态 — 已存在的 Handoff 仍需可查看/可撤回
  if (!gate.allowed && gate.reason !== "no_confirmed_facts") return { detail: null, gate };

  const handoff = gate.currentHandoff;
  if (!handoff) {
    return { detail: { effectiveStatus: "no_handoff", canCreateNewRevision: true, humanReviewRequired: true }, gate };
  }

  const currentResearch = {
    candidateId: gate.candidate?.sourceResearch.candidateId || "",
    researchRevision: gate.candidate?.sourceResearch.researchRevision || 1,
    researchHash: gate.candidate?.sourceResearch.researchHash || "",
    candidateSourceFingerprint: gate.candidate?.sourceResearch.candidateSourceFingerprint || "",
    verificationValid: true,
    workflowStatus: "completed" as const,
    decisionStatus: "creative_ready" as const,
  };

  let effectiveStatus = "active";
  let staleReasonCode: string | undefined;
  try {
    const sr = evaluateHandoffStatus({ handoff, currentResearch });
    effectiveStatus = sr.status;
    staleReasonCode = sr.reasonCode;
  } catch { /* keep defaults */ }

  const detail: CreativeHandoffDetail = {
    handoffId: handoff.handoffId,
    currentRevision: handoff.currentRevision,
    controlState: handoff.controlState,
    effectiveStatus,
    staleReasonCode,
    canCreateNewRevision: handoff.controlState === "active" && handoff.currentRevision < 10,
    humanReviewRequired: true,
    sourceResearchRevision: gate.candidate?.sourceResearch.researchRevision,
    confirmedFacts: handoff.versions[handoff.versions.length - 1]?.confirmedFacts?.map((f) => ({
      field: f.field,
      label: f.label,
      usageScopes: [...f.usageScopes],
    })) || [],
    prohibitedClaims: handoff.versions[handoff.versions.length - 1]?.prohibitedClaims?.map((c) => ({
      category: c.category,
      summary: c.summary.slice(0, 200),
      appliesTo: [...c.appliesTo],
    })) || [],
    versions: handoff.versions.map((v) => ({
      revision: v.revision,
      createdAt: v.createdAt,
      confirmedFactFields: v.confirmedFacts.map((f) => f.field),
    })),
    createdAt: handoff.createdAt,
    storageVersion: gate.storageVersion,
  };
  return { detail, gate };
}
