import type { AccessContext } from "@/lib/server/accessPassword";
import { getLegacyAuthoritativeCandidate } from "@/lib/server/legacyCandidateRead";
import { resolveScopeSubject } from "@/lib/server/opportunityScope";
import type { AuthoritativeCandidate } from "@/lib/server/scopedOpportunityStore";

export type { AuthoritativeCandidate } from "@/lib/server/scopedOpportunityStore";

export async function getAuthoritativeCandidate(
  context: AccessContext,
  candidateId: string,
): Promise<AuthoritativeCandidate | null> {
  return getLegacyAuthoritativeCandidate(resolveScopeSubject(context), candidateId);
}
