import type { sandboxCandidateToListItem } from "@/lib/server/demoSandbox";
import type { listCandidates } from "@/lib/server/opportunityCandidateService";
import type { LegacyCandidateWriteResult } from "@/lib/server/legacyCandidateWriteTypes";
import type { CandidateSaveItem } from "@/lib/server/candidateSourceSave";

// ── Read types (existing, unchanged) ──────────────

export type ScopedCandidateListQuery = Readonly<Parameters<typeof listCandidates>[0]>;

type OwnerCandidateListResult = Awaited<ReturnType<typeof listCandidates>>;

export type ScopedCandidateListItem =
  | OwnerCandidateListResult["items"][number]
  | ReturnType<typeof sandboxCandidateToListItem>;

export type ScopedCandidateListResult =
  & Omit<OwnerCandidateListResult, "items">
  & { items: ScopedCandidateListItem[] };

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

export interface ScopedCandidateReadStore {
  list(query: ScopedCandidateListQuery): Promise<ScopedCandidateListResult>;
  getAuthoritative(candidateId: string): Promise<AuthoritativeCandidate | null>;
}

// ── Write types (A2-2A) ───────────────────────────

export interface ScopedCandidateWriteStore {
  /** Save legacy (unverified) candidates via the A2-1 target write service. */
  saveLegacyCandidates(inputs: readonly CandidateSaveItem[]): Promise<LegacyCandidateWriteResult>;
  /** Import local drafts via the same A2-1 service. */
  importLocalCandidates(inputs: readonly CandidateSaveItem[]): Promise<LegacyCandidateWriteResult>;
}

export interface ScopedOpportunityStore {
  readonly candidates: ScopedCandidateReadStore & Partial<ScopedCandidateWriteStore>;
}
