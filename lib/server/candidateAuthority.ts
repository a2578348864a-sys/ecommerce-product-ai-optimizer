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
  convertedTaskId: string | null;
  originProductBatchItemId: string | null;
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
      convertedTaskId: candidate.convertedTaskId ?? null,
      originProductBatchItemId: candidate.originProductBatchItemId ?? null,
    };
  }

  if (isSandboxCandidateId(candidateId)) return null;
  const candidate = await prisma.opportunityCandidate.findUnique({
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
      convertedTaskId: true,
    },
  });
  if (!candidate) return null;
  let originProductBatchItemId = (
    candidate as typeof candidate & { originProductBatchItemId?: string | null }
  ).originProductBatchItemId;
  if (originProductBatchItemId === undefined
    && typeof (prisma as unknown as { $queryRaw?: unknown }).$queryRaw === "function") {
    const rows = await prisma.$queryRaw<Array<{ originProductBatchItemId: string | null }>>`
      SELECT "originProductBatchItemId"
      FROM "OpportunityCandidate"
      WHERE "id" = ${candidateId}
      LIMIT 1
    `;
    originProductBatchItemId = rows[0]?.originProductBatchItemId ?? null;
  }
  return {
    ...candidate,
    originProductBatchItemId: originProductBatchItemId ?? null,
  };
}
