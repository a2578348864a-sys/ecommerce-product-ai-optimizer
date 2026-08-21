/**
 * V4 P1 — Domain adapter（P1_CONTRACT §3）。
 *
 * load_context 只读复用现有候选/任务/Evidence（OpportunityCandidate 及其
 * analysisJson/rawInput），输出候选上下文快照；禁止写 V3.1 业务记录。
 * - validate_identity：站点/实体是否明确（P1 fake 在候选存在时确认）。
 * - resume 门禁用 revalidateIdentity / revalidateBudget：恢复前重校验。
 */
import "server-only";

import { sha256, stableStringify } from "@/lib/v4/journal";

export type CandidateRow = {
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
  analysisJson: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type DomainDb = {
  opportunityCandidate: {
    findUnique(args: { where: { id: string } }): Promise<CandidateRow | null>;
  };
};

export type CandidateSnapshot = {
  id: string;
  name: string;
  source: string;
  link: string | null;
  score: number;
  keyword: string;
  riskLevel: string;
  status: string;
};

export type EvidenceItem = {
  sourceType: string;
  sourceName: string;
  summary: string;
  generatedAt: string;
};

export type CandidateContext = {
  candidateId: string;
  candidate: CandidateSnapshot;
  evidence: EvidenceItem[];
  contextHash: string;
};

export type IdentityStatus = "confirmed" | "ambiguous" | "missing";

export class CandidateNotFoundError extends Error {
  readonly code = "CANDIDATE_NOT_FOUND";
  readonly candidateId: string;
  constructor(candidateId: string) {
    super(`Candidate ${candidateId} not found`);
    this.name = "CandidateNotFoundError";
    this.candidateId = candidateId;
  }
}

export class DomainAdapter {
  private readonly db: DomainDb;
  constructor(db: DomainDb) {
    this.db = db;
  }

  /** load_context：只读候选 + 已有 Evidence，输出上下文快照。 */
  async loadContext(input: { candidateId: string }): Promise<CandidateContext> {
    const row = await this.db.opportunityCandidate.findUnique({
      where: { id: input.candidateId },
    });
    if (!row) throw new CandidateNotFoundError(input.candidateId);

    const candidate: CandidateSnapshot = {
      id: row.id,
      name: row.name,
      source: row.source,
      link: row.link,
      score: row.score,
      keyword: row.keyword,
      riskLevel: row.riskLevel,
      status: row.status,
    };
    const evidence = this.readEvidence(row);
    const contextHash = sha256(
      stableStringify({ candidate, evidence }),
    );
    return { candidateId: row.id, candidate, evidence, contextHash };
  }

  /** validate_identity：站点/实体是否明确。P1 候选存在即确认（fake）。 */
  async validateIdentity(input: { candidate: CandidateSnapshot }): Promise<{
    ok: boolean;
    status: IdentityStatus;
    reason?: string;
  }> {
    const c = input.candidate;
    if (!c.name || !c.source) {
      return { ok: false, status: "ambiguous", reason: "candidate name/source missing" };
    }
    return { ok: true, status: "confirmed" };
  }

  /** resume 门禁：恢复前重校验候选身份（fail-closed）。 */
  async revalidateIdentity(input: { candidate: CandidateSnapshot }): Promise<{
    ok: boolean;
    status: IdentityStatus;
    reason?: string;
  }> {
    return this.validateIdentity(input);
  }

  /** resume 门禁：恢复前重校验预算（fail-closed）。 */
  async revalidateBudget(ctx: {
    budget: {
      usedBrowserSteps: number;
      usedLlmTokens: number;
      usedImageCalls: number;
      usedCost: number;
      maxBrowserSteps: number;
      maxLlmTokens: number;
      maxImageCalls: number;
      maxCost: number;
    };
  }): Promise<{ ok: boolean; reason?: string }> {
    const b = ctx.budget;
    const over =
      b.usedBrowserSteps > b.maxBrowserSteps ||
      b.usedLlmTokens > b.maxLlmTokens ||
      b.usedImageCalls > b.maxImageCalls ||
      b.usedCost > b.maxCost;
    return over
      ? { ok: false, reason: "budget exhausted on resume" }
      : { ok: true };
  }

  private readEvidence(row: CandidateRow): EvidenceItem[] {
    const items: EvidenceItem[] = [];
    const parsed = tryParseJson(row.analysisJson);
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      const summary = extractText(rec.summary) ?? extractText(rec.oneLineSummary) ?? "";
      if (summary) {
        items.push({
          sourceType: "candidate_analysis",
          sourceName: row.source,
          summary,
          generatedAt: iso(row.updatedAt),
        });
      }
    }
    if (row.rawInput && row.rawInput.trim().length > 0) {
      items.push({
        sourceType: "raw_input",
        sourceName: row.source,
        summary: row.rawInput.slice(0, 500),
        generatedAt: iso(row.createdAt),
      });
    }
    return items;
  }
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractText(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}