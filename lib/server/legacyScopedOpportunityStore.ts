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
import { prisma } from "@/lib/server/db";
import {
  loadDemoSandboxStore,
  saveDemoSandboxStore,
  type SandboxCandidate,
} from "@/lib/server/demoSandbox";
import { executeLegacyCandidateWrite } from "@/lib/server/legacyCandidateWrite";
import type { CandidateSaveItem } from "@/lib/server/candidateSourceSave";
import type { LegacyCandidateWriteResult } from "@/lib/server/legacyCandidateWriteTypes";
import {
  createOwnerLegacyWriteBackend,
  createVisitorLegacyWriteBackend,
} from "@/lib/server/legacyCandidateWriteBackends";

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

    async saveLegacyCandidates(inputs: readonly CandidateSaveItem[]): Promise<LegacyCandidateWriteResult> {
      if (subject.kind === "visitor") {
        return saveLegacyVisitorCandidates(subject.subjectId, inputs);
      }
      return saveLegacyOwnerCandidates(inputs);
    },

    async importLocalCandidates(inputs: readonly CandidateSaveItem[]): Promise<LegacyCandidateWriteResult> {
      if (subject.kind === "visitor") {
        return saveLegacyVisitorCandidates(subject.subjectId, inputs);
      }
      return saveLegacyOwnerCandidates(inputs);
    },
  });

  return Object.freeze({ candidates });
}

// ── Owner write path ──────────────────────────────

async function saveLegacyOwnerCandidates(
  inputs: readonly CandidateSaveItem[],
): Promise<LegacyCandidateWriteResult> {
  return prisma.$transaction(async (tx) => {
    const backend = createOwnerLegacyWriteBackend(tx);
    return executeLegacyCandidateWrite(inputs, backend);
  });
}

// ── Visitor write path ────────────────────────────

function saveLegacyVisitorCandidates(
  demoAccessId: string,
  inputs: readonly CandidateSaveItem[],
): Promise<LegacyCandidateWriteResult> {
  const store = loadDemoSandboxStore();
  const snapshot: SandboxCandidate[] = [...store.candidates];

  const backend = createVisitorLegacyWriteBackend(demoAccessId, snapshot, (updated) => {
    saveDemoSandboxStore({ ...store, candidates: updated });
  });

  return executeLegacyCandidateWrite(inputs, backend);
}
