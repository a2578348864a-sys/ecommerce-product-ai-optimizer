import type { AccessContext } from "@/lib/server/accessPassword";
import { prisma } from "@/lib/server/db";
import { getSandboxCandidate, isSandboxCandidateId } from "@/lib/server/demoSandbox";
import { isLocalDraftCandidateId } from "@/lib/opportunityCandidatePool";

export type AuthoritativeCandidate = {
  id: string;
  name: string;
  rawInput: string;
  link: string | null;
  score: number;
  source: string;
  keyword: string;
  riskLevel: string;
  riskLabel: string;
  summaryLabel: string;
  status: string;
  sourceMetaJson: string;
  analysisJson: string;
};

export async function getAuthoritativeCandidate(
  context: AccessContext,
  candidateId: string,
): Promise<AuthoritativeCandidate | null> {
  if (isLocalDraftCandidateId(candidateId)) return null;

  if (context.mode === "demo") {
    if (!isSandboxCandidateId(candidateId)) return null;
    const candidate = getSandboxCandidate(context.demoAccessId, candidateId);
    if (!candidate) return null;
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

  if (isSandboxCandidateId(candidateId)) return null;
  return prisma.opportunityCandidate.findUnique({
    where: { id: candidateId },
    select: {
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
    },
  });
}
