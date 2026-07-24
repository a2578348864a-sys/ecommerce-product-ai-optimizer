import type { sandboxCandidateToListItem } from "@/lib/server/demoSandbox";
import type { listCandidates } from "@/lib/server/opportunityCandidateService";

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

export interface ScopedOpportunityStore {
  readonly candidates: ScopedCandidateReadStore;
}
