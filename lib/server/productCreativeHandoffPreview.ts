import "server-only";

import { createHash } from "node:crypto";

import type { AccessContext } from "@/lib/server/accessPassword";
import { prisma } from "@/lib/server/db";
import { getSandboxTask } from "@/lib/server/demoSandbox";
import {
  getProductResearchRecord,
  getProductResearchVerification,
  verifyProductResearchHash,
  hasProductResearchRecordNamespace,
} from "@/lib/productResearchRecord";
import {
  projectProductCreativeHandoffCandidate,
} from "@/lib/productCreativeHandoffProjection";
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
    contentFingerprint: safeFingerprint(id),
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
  const isSandbox = taskId.startsWith("demo-") || taskId.startsWith("sandbox-");
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

  const candidate: ProductCreativeHandoffCandidate = {
    sourceResearch: {
      recordSchema: "product-research-record.v1",
      candidateId: (recAny.candidateId as string) || "",
      researchRevision: (recAny.revision as number) || 1,
      researchHash: (verAny.researchHash as string) || "",
      workflowStatus: "completed",
      decisionStatus: "creative_ready",
      candidateSourceFingerprint: (verAny.candidateSourceFingerprint as string) || "",
    },
    productIdentity: {
      displayName: (taskRec.productName as string) || (taskRec.title as string) || "",
      identityConfirmedAt: (taskRec.createdAt as string) || new Date().toISOString(),
    },
    confirmedFacts: [],
    stableSourceFacts: [],
    aiCreativeReferences: [],
    issues: [],
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

  const storageVersion = {
    resultJsonHash: fullHash(resultJsonStr || ""),
    updatedAt: updatedAt || new Date().toISOString(),
  };

  if (handoffContractInvalid) {
    return { allowed: false, reason: "legacy_not_supported", candidate: undefined, currentHandoff: null, storageVersion, handoffContractInvalid: true, requestLedger, ledgerInvalid };
  }

  return { allowed: true, reason: "eligible", candidate, currentHandoff, storageVersion, requestLedger, ledgerInvalid };
}

// ─── Preview ──────────────────────────────────────────────

export async function generateCreativeHandoffPreview(
  taskId: string,
  context: AccessContext,
): Promise<{ preview: CreativeHandoffPreview | null; gate: CreativeHandoffGateResult }> {
  const gate = await checkCreativeHandoffGate(taskId, context);
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
    visualReferenceCandidates: gate.candidate.visualReferences.map((v) => ({
      selectionId: selection("visual", v.assetFingerprint),
      sourceTier: v.sourceTier,
      approvedForReference: v.humanApprovedForReference === true,
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
  if (!gate.allowed) return { detail: null, gate };

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
