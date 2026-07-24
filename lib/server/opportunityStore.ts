import type { AccessContext } from "@/lib/server/accessPassword";
import { createLegacyScopedOpportunityStore } from "@/lib/server/legacyScopedOpportunityStore";
import { resolveScopeSubject } from "@/lib/server/opportunityScope";
import type { ScopedOpportunityStore } from "@/lib/server/scopedOpportunityStore";

export function createScopedOpportunityStore(
  context: AccessContext,
): ScopedOpportunityStore {
  return createLegacyScopedOpportunityStore(resolveScopeSubject(context));
}
