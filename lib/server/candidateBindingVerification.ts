import "server-only";

import { prisma } from "@/lib/server/db";
import type { AccessContext } from "@/lib/server/accessPassword";
import { getSandboxCandidate, isSandboxTaskId } from "@/lib/server/demoSandbox";

type JsonRecord = Record<string, unknown>;

export type CandidateBindingVerification = {
  status: "verified" | "invalid" | "unverified";
  candidateId: string | null;
  taskId: string;
  asin: string | null;
  reason: string;
};

type CandidateBindingRecord = {
  id: string;
  convertedTaskId?: string | null;
  sourceMetaJson?: string | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedAsin(value: unknown): string | null {
  const candidate = nonEmptyString(value)?.toUpperCase() ?? "";
  return /^[A-Z0-9]{10}$/.test(candidate) ? candidate : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function candidateIdFromResult(result: JsonRecord): string | null {
  const candidateToTask = isRecord(result.candidateToTask) ? result.candidateToTask : null;
  const researchRecord = isRecord(result.researchRecord) ? result.researchRecord : null;
  const candidateId = nonEmptyString(candidateToTask?.candidateId);
  const recordCandidateId = nonEmptyString(researchRecord?.candidateId);
  if (!candidateId || !recordCandidateId || candidateId !== recordCandidateId) return null;
  return candidateId;
}

function taskAsinFromResult(result: JsonRecord): string | null {
  const context = isRecord(result.candidateAnalysisContext) ? result.candidateAnalysisContext : null;
  const facts = context && isRecord(context.facts) ? context.facts : null;
  return normalizedAsin(facts?.asin);
}

function candidateAsin(candidate: CandidateBindingRecord): string | null {
  const source = parseJson(candidate.sourceMetaJson);
  if (!isRecord(source)) return null;
  const identity = isRecord(source.identity) ? source.identity : null;
  return normalizedAsin(source.asin) ?? normalizedAsin(identity?.asin);
}

function evidenceAsins(result: JsonRecord): string[] {
  const evidence = isRecord(result.reviewEvidence) ? result.reviewEvidence : null;
  const dataset = evidence && isRecord(evidence.dataset) ? evidence.dataset : null;
  const reviews = dataset && Array.isArray(dataset.reviews) ? dataset.reviews : [];
  return reviews
    .map((review) => normalizedAsin(isRecord(review) ? review.productAsin : null))
    .filter((asin): asin is string => Boolean(asin));
}

/**
 * Pure Candidate → Task identity check. It only derives a verdict; it never
 * writes a binding flag or repairs an incomplete relation.
 */
export function verifyCandidateBinding(input: {
  taskId: string;
  result: unknown;
  candidate: CandidateBindingRecord | null;
}): CandidateBindingVerification {
  const result = isRecord(input.result) ? input.result : null;
  if (!result) return { status: "unverified", candidateId: null, taskId: input.taskId, asin: null, reason: "result_invalid" };

  const candidateToTask = isRecord(result.candidateToTask) ? result.candidateToTask : null;
  const researchRecord = isRecord(result.researchRecord) ? result.researchRecord : null;
  const candidateId = nonEmptyString(candidateToTask?.candidateId);
  const recordCandidateId = nonEmptyString(researchRecord?.candidateId);
  if (!candidateId || !recordCandidateId) {
    return { status: "unverified", candidateId: candidateId ?? recordCandidateId, taskId: input.taskId, asin: taskAsinFromResult(result), reason: "candidate_id_missing" };
  }
  if (candidateId !== recordCandidateId) {
    return { status: "invalid", candidateId, taskId: input.taskId, asin: taskAsinFromResult(result), reason: "candidate_id_conflict" };
  }
  if (!input.candidate) {
    return { status: "invalid", candidateId, taskId: input.taskId, asin: taskAsinFromResult(result), reason: "candidate_missing" };
  }
  if (input.candidate.id !== candidateId) {
    return { status: "invalid", candidateId, taskId: input.taskId, asin: taskAsinFromResult(result), reason: "candidate_record_mismatch" };
  }
  if (input.candidate.convertedTaskId !== input.taskId) {
    return { status: "invalid", candidateId, taskId: input.taskId, asin: taskAsinFromResult(result), reason: "candidate_task_mismatch" };
  }

  const asin = taskAsinFromResult(result);
  const sourceAsin = candidateAsin(input.candidate);
  if (!asin || !sourceAsin) {
    return { status: "unverified", candidateId, taskId: input.taskId, asin: asin ?? sourceAsin, reason: "asin_missing" };
  }
  if (asin !== sourceAsin) {
    return { status: "invalid", candidateId, taskId: input.taskId, asin, reason: "asin_conflict" };
  }

  const persistedEvidenceAsins = evidenceAsins(result);
  if (persistedEvidenceAsins.some((evidenceAsin) => evidenceAsin !== asin)) {
    return { status: "invalid", candidateId, taskId: input.taskId, asin, reason: "evidence_asin_conflict" };
  }
  return { status: "verified", candidateId, taskId: input.taskId, asin, reason: "candidate_task_asin_match" };
}

/** Load the authoritative candidate relation for an owner or sandbox task. */
export async function readCandidateBindingVerification(
  context: AccessContext,
  taskId: string,
  result: unknown,
): Promise<CandidateBindingVerification | undefined> {
  const candidateId = isRecord(result) && isRecord(result.candidateToTask)
    ? nonEmptyString(result.candidateToTask.candidateId)
    : null;
  // Older handoff fixtures/tasks do not carry the candidateToTask namespace at
  // all. Keep that compatibility projection absent; once the namespace exists,
  // every malformed or missing relation remains fail-closed below.
  if (!candidateId) return undefined;

  if (context.mode === "demo") {
    const demoAccessId = (context as unknown as { demoAccessId?: string }).demoAccessId;
    const candidate = demoAccessId && (isSandboxTaskId(taskId) || taskId.startsWith("demo-") || taskId.startsWith("sandbox-"))
      ? getSandboxCandidate(demoAccessId, candidateId)
      : null;
    return verifyCandidateBinding({ taskId, result, candidate });
  }

  const candidate = await prisma.opportunityCandidate.findUnique({
    where: { id: candidateId },
    select: { id: true, convertedTaskId: true, sourceMetaJson: true },
  });
  return verifyCandidateBinding({ taskId, result, candidate });
}
