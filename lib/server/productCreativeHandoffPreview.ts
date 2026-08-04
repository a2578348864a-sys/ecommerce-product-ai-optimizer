import "server-only";

import type { AccessContext } from "@/lib/server/accessPassword";
import { prisma } from "@/lib/server/db";
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
import { evaluateHandoffStatus } from "@/lib/productCreativeHandoffStatus";
import type {
  ProductCreativeHandoffCandidate,
  ProductCreativeHandoffV1,
  ProductCreativeHandoffConfirmedFact,
} from "@/lib/productCreativeHandoff";

// ─── Types ───────────────────────────────────────────────

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

export type CreativeHandoffPreview = {
  eligibility: CreativeHandoffEligibility;
  researchDecisionSummary?: {
    decisionStatus: string;
    workflowStatus: string;
    researchRevision: number;
    candidateId: string;
  };
  candidateFactOptions?: {
    factId: string;
    field: string;
    label: string;
    valueSummary: string;
  }[];
  stableSourceFacts?: {
    factId: string;
    field: string;
    label: string;
    stabilityRule: string;
  }[];
  aiReferences?: {
    referenceId: string;
    field: string;
    summary: string;
    allowedUse: string;
  }[];
  issues?: {
    issueId: string;
    field: string;
    kind: string;
    summary: string;
    risk: string;
  }[];
  prohibitedClaims?: {
    claimId: string;
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
    assetFingerprint: string;
    sourceTier: string;
    approvedForReference: boolean;
  }[];
  blockingCodes?: string[];
  expectedResearchRevision?: number;
  expectedCurrentHandoffRevision?: number;
  storageVersion?: { resultJsonHash: string; updatedAt: string };
};

export type CreativeHandoffDetail = {
  handoffId?: string;
  currentRevision?: number;
  controlState?: string;
  effectiveStatus: string;
  staleReasonCode?: string;
  canCreateNewRevision: boolean;
  humanReviewRequired: boolean;
  sourceResearchRevision?: number;
  confirmedFacts?: {
    field: string;
    label: string;
    usageScopes: string[];
  }[];
  prohibitedClaims?: {
    category: string;
    summary: string;
    appliesTo: string[];
  }[];
  versions?: {
    revision: number;
    createdAt: string;
    confirmedFactFields: string[];
  }[];
  createdAt?: string;
  storageVersion?: { resultJsonHash: string; updatedAt: string };
};

export type CreativeHandoffGateResult = {
  allowed: boolean;
  reason: CreativeHandoffEligibility;
  researchRecord?: Record<string, unknown>;
  candidate?: ProductCreativeHandoffCandidate;
  currentHandoff?: ProductCreativeHandoffV1 | null;
};

// ─── Internal helpers ────────────────────────────────────

function hashShort(value: string): string {
  // Safe 16-char fingerprint for DTO — NOT for identity verification
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) - h) + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0").slice(0, 16);
}

function parseTaskResultJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* invalid JSON */ }
  return null;
}

// ─── Gate check ──────────────────────────────────────────

export async function checkCreativeHandoffGate(
  taskId: string,
  context: AccessContext,
): Promise<CreativeHandoffGateResult> {
  const task = await prisma.viralAnalysisRecord.findUnique({ where: { id: taskId } }) as Record<string, unknown> | null;
  if (!task) {
    return { allowed: false, reason: "legacy_not_supported" };
  }

  // Verify ownership
  const taskUserId = task.userId as string | undefined;
  const taskDemoAccessId = task.demoAccessId as string | undefined;
  const ctxAny = context as unknown as Record<string, unknown>;
  const isOwner = context.mode === "owner" && taskUserId === (ctxAny.ownerRef as string);
  const isVisitor = context.mode === "demo" && taskDemoAccessId === (ctxAny.demoAccessId as string);
  if (!isOwner && !isVisitor) {
    return { allowed: false, reason: "legacy_not_supported" };
  }

  const resultJson = parseTaskResultJson(task.resultJson);
  if (!resultJson) {
    return { allowed: false, reason: "legacy_not_supported" };
  }

  // Check product-research-record.v1
  if (!hasProductResearchRecordNamespace(resultJson)) {
    return { allowed: false, reason: "legacy_not_supported" };
  }

  const record = getProductResearchRecord(resultJson);
  const verification = getProductResearchVerification(resultJson);
  if (!record || !verification) {
    return { allowed: false, reason: "legacy_not_supported" };
  }

  // Verify research hash
  if (!verifyProductResearchHash(record, verification)) {
    return { allowed: false, reason: "research_hash_invalid" };
  }

  // Check decision status
  if (record.latestDecision?.status !== "creative_ready") {
    return { allowed: false, reason: "decision_not_creative_ready" };
  }

  // Check research mode
  const researchMode = (task as Record<string, unknown>).researchMode as string | undefined;
  if (researchMode && researchMode !== "market_research_only") {
    return { allowed: false, reason: "research_mode_invalid" };
  }

  // Build candidate for projection
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
      candidateSourceFingerprint: (verAny.candidateSourceFingerprint as string) || (recAny.candidateId as string) || "",
    },
    productIdentity: {
      displayName: (task.productName as string) || (task.title as string) || "",
      identityConfirmedAt: (task.createdAt as string) || new Date().toISOString(),
    },
    confirmedFacts: [],
    stableSourceFacts: [],
    aiCreativeReferences: [],
    issues: [],
    prohibitedClaims: [{ claimId: "00000000-0000-4000-8000-000000000001", category: "absolute_claim" as const, summary: "Do not make absolute claims.", appliesTo: ["both" as const], source: "system_rule" as const }],
    creativePreferences: { evidenceTier: "creative_preference" as const },
    visualReferences: [],
    humanReviewRequired: true,
  };

  // Load current handoff if exists
  const currentHandoffRaw = resultJson.creativeHandoff;
  let currentHandoff: ProductCreativeHandoffV1 | null = null;
  if (typeof currentHandoffRaw === "object" && currentHandoffRaw !== null) {
    currentHandoff = parseProductCreativeHandoff(currentHandoffRaw);
  }

  return {
    allowed: true,
    reason: "eligible",
    researchRecord: record as Record<string, unknown>,
    candidate,
    currentHandoff,
  };
}

// ─── Preview generation ──────────────────────────────────

export async function generateCreativeHandoffPreview(
  taskId: string,
  context: AccessContext,
): Promise<{ preview: CreativeHandoffPreview | null; gate: CreativeHandoffGateResult }> {
  const gate = await checkCreativeHandoffGate(taskId, context);

  if (!gate.allowed || !gate.candidate) {
    return {
      preview: null,
      gate,
    };
  }

  // Use PR2-0 projection
  const projection = projectProductCreativeHandoffCandidate({
    sourceResearch: gate.candidate.sourceResearch,
    productIdentity: gate.candidate.productIdentity,
    evidence: [],
    prohibitedClaims: gate.candidate.prohibitedClaims,
    creativePreferences: gate.candidate.creativePreferences,
    visualReferences: gate.candidate.visualReferences,
  });

  const resultJsonHash = hashShort(JSON.stringify(gate.researchRecord || {}));

  const preview: CreativeHandoffPreview = {
    eligibility: "eligible",
    researchDecisionSummary: {
      decisionStatus: "creative_ready",
      workflowStatus: "completed",
      researchRevision: gate.candidate.sourceResearch.researchRevision,
      candidateId: gate.candidate.sourceResearch.candidateId,
    },
    candidateFactOptions: gate.candidate.confirmedFacts.map((f: ProductCreativeHandoffConfirmedFact) => ({
      factId: f.factId,
      field: f.field,
      label: f.label,
      valueSummary: typeof f.value === "string" ? f.value.slice(0, 200) : String(f.value).slice(0, 200),
    })),
    stableSourceFacts: gate.candidate.stableSourceFacts.map((f) => ({
      factId: f.factId,
      field: f.field,
      label: f.label,
      stabilityRule: f.stabilityRule,
    })),
    aiReferences: gate.candidate.aiCreativeReferences.map((r) => ({
      referenceId: r.referenceId,
      field: r.field,
      summary: r.summary.slice(0, 200),
      allowedUse: r.allowedUse,
    })),
    issues: gate.candidate.issues.map((i) => ({
      issueId: i.issueId,
      field: i.field,
      kind: i.kind,
      summary: i.summary.slice(0, 200),
      risk: i.risk,
    })),
    prohibitedClaims: gate.candidate.prohibitedClaims.map((c) => ({
      claimId: c.claimId,
      category: c.category,
      summary: c.summary.slice(0, 200),
      appliesTo: [...c.appliesTo],
    })),
    creativePreferences: gate.candidate.creativePreferences.evidenceTier ? {
      tone: (gate.candidate.creativePreferences as Record<string, unknown>).tone as string | undefined,
    } : undefined,
    visualReferenceCandidates: gate.candidate.visualReferences.map((v) => ({
      assetFingerprint: v.assetFingerprint,
      sourceTier: v.sourceTier,
      approvedForReference: v.humanApprovedForReference === true,
    })),
    blockingCodes: projection.blockingCodes,
    expectedResearchRevision: gate.candidate.sourceResearch.researchRevision,
    expectedCurrentHandoffRevision: gate.currentHandoff?.currentRevision ?? 0,
    storageVersion: { resultJsonHash, updatedAt: new Date().toISOString() },
  };

  return { preview, gate };
}

// ─── Detail generation ───────────────────────────────────

export async function getCreativeHandoffDetail(
  taskId: string,
  context: AccessContext,
): Promise<{ detail: CreativeHandoffDetail | null; gate: CreativeHandoffGateResult }> {
  const gate = await checkCreativeHandoffGate(taskId, context);

  if (!gate.allowed) {
    return { detail: null, gate };
  }

  const handoff = gate.currentHandoff;
  if (!handoff) {
    return {
      detail: {
        effectiveStatus: "no_handoff",
        canCreateNewRevision: true,
        humanReviewRequired: true,
      },
      gate,
    };
  }

  // Calculate effective status using PR2-0 pure function
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
    const statusResult = evaluateHandoffStatus({ handoff, currentResearch });
    effectiveStatus = statusResult.status;
    staleReasonCode = statusResult.reasonCode;
  } catch { /* use defaults */ }

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
    storageVersion: {
      resultJsonHash: hashShort(JSON.stringify(gate.researchRecord || {})),
      updatedAt: new Date().toISOString(),
    },
  };

  return { detail, gate };
}
