import {
  getLegacyAuthoritativeCandidate,
  listLegacyCandidates,
} from "@/lib/server/legacyCandidateRead";
import type { ScopeSubject } from "@/lib/server/opportunityScope";
import type {
  ScopedCandidateListQuery,
  ScopedCandidateListResult,
  ScopedOpportunityStore,
} from "@/lib/server/scopedOpportunityStore";

export function createLegacyScopedOpportunityStore(
  subject: ScopeSubject,
): ScopedOpportunityStore {
  const candidates = Object.freeze({
    async list(query: ScopedCandidateListQuery): Promise<ScopedCandidateListResult> {
      return listLegacyCandidates(subject, query);
    },

    async getAuthoritative(candidateId: string) {
      return getLegacyAuthoritativeCandidate(subject, candidateId);
    },
  });

  return Object.freeze({ candidates });
}
