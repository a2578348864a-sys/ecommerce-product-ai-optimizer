/**
 * Candidate sourceMeta 读取 helper（Owner prisma / Visitor sandbox 双路径）。
 * 供 Creative Handoff 链读取候选来源元数据（图片快照 candidate_fallback 用）。
 */
import "server-only";

import { prisma } from "@/lib/server/db";
import type { AccessContext } from "@/lib/server/accessPassword";
import { getSandboxCandidate, isSandboxTaskId } from "@/lib/server/demoSandbox";

export async function loadCandidateSourceMeta(
  context: AccessContext,
  candidateId: string | null,
): Promise<string | undefined> {
  if (!candidateId) return undefined;
  if (context.mode === "demo") {
    const demoAccessId = (context as unknown as { demoAccessId?: string }).demoAccessId;
    if (!demoAccessId) return undefined;
    if (!isSandboxTaskId(candidateId) && !candidateId.startsWith("sandbox_")) return undefined;
    const candidate = getSandboxCandidate(demoAccessId, candidateId);
    return typeof candidate?.sourceMetaJson === "string" ? candidate.sourceMetaJson : undefined;
  }
  const candidate = await prisma.opportunityCandidate.findUnique({
    where: { id: candidateId },
    select: { sourceMetaJson: true },
  });
  return typeof candidate?.sourceMetaJson === "string" ? candidate.sourceMetaJson : undefined;
}
