import { isLocalDraftCandidateId } from "@/lib/opportunityCandidatePool";
import { prisma } from "@/lib/server/db";
import {
  getSandboxCandidate,
  isSandboxCandidateId,
  listSandboxCandidates,
  sandboxCandidateToListItem,
} from "@/lib/server/demoSandbox";
import {
  isValidCandidateStatus,
  listCandidates,
} from "@/lib/server/opportunityCandidateService";
import type { ScopeSubject } from "@/lib/server/opportunityScope";
import type {
  AuthoritativeCandidate,
  ScopedCandidateListQuery,
  ScopedCandidateListResult,
} from "@/lib/server/scopedOpportunityStore";

const AUTHORITATIVE_CANDIDATE_SELECT = {
  id: true,
  name: true,
  rawInput: true,
  link: true,
  score: true,
  source: true,
  keyword: true,
  riskLevel: true,
  riskLabel: true,
  summaryLabel: true,
  status: true,
  sourceMetaJson: true,
  analysisJson: true,
} as const;

function toAuthoritativeSandboxCandidate(
  candidate: NonNullable<ReturnType<typeof getSandboxCandidate>>,
): AuthoritativeCandidate {
  return {
    id: candidate.id,
    name: candidate.name,
    rawInput: candidate.rawInput,
    link: candidate.link,
    score: candidate.score,
    source: candidate.source,
    keyword: candidate.keyword,
    riskLevel: candidate.riskLevel,
    riskLabel: candidate.riskLabel,
    summaryLabel: candidate.summaryLabel,
    status: candidate.status,
    sourceMetaJson: candidate.sourceMetaJson,
    analysisJson: candidate.analysisJson,
  };
}

export async function listLegacyCandidates(
  subject: ScopeSubject,
  query: ScopedCandidateListQuery,
): Promise<ScopedCandidateListResult> {
  if (subject.kind === "owner") {
    return listCandidates(query);
  }

  const normalizedQuery = query.q?.toLowerCase();
  const normalizedLimit = Math.min(Math.max(1, query.limit ?? 50), 100);
  const normalizedOffset = Math.max(0, query.offset ?? 0);
  const sandboxItems = listSandboxCandidates(subject.subjectId)
    .filter((candidate) => !isValidCandidateStatus(query.status) || candidate.status === query.status)
    .filter((candidate) => !normalizedQuery || candidate.name.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => query.sort === "score" ? b.score - a.score : 0);
  const items = sandboxItems
    .slice(normalizedOffset, normalizedOffset + normalizedLimit)
    .map(sandboxCandidateToListItem);
  const nextOffset = normalizedOffset + items.length;

  return {
    items,
    total: sandboxItems.length,
    hasMore: nextOffset < sandboxItems.length,
    nextOffset: nextOffset < sandboxItems.length ? nextOffset : null,
  };
}

export async function getLegacyAuthoritativeCandidate(
  subject: ScopeSubject,
  candidateId: string,
): Promise<AuthoritativeCandidate | null> {
  if (isLocalDraftCandidateId(candidateId)) return null;

  if (subject.kind === "visitor") {
    if (!isSandboxCandidateId(candidateId)) return null;
    const candidate = getSandboxCandidate(subject.subjectId, candidateId);
    return candidate ? toAuthoritativeSandboxCandidate(candidate) : null;
  }

  if (isSandboxCandidateId(candidateId)) return null;
  return prisma.opportunityCandidate.findUnique({
    where: { id: candidateId },
    select: AUTHORITATIVE_CANDIDATE_SELECT,
  });
}
