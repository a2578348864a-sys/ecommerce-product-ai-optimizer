import type { AccessContext } from "@/lib/server/accessPassword";
import {
  buildConfirmedSnapshot,
  type BrowserEvidenceStoredPreview,
} from "@/lib/server/browserEvidenceCollect";
import {
  buildFactCandidateView,
  factCategoryOf,
  type AmazonPreviewResolutionV1,
  type ConfirmedFactCandidate,
  type FactCandidate,
} from "@/lib/factCandidates";

export type AmazonPreviewCandidate = FactCandidate;

export type AmazonPreviewClassification = {
  newFacts: AmazonPreviewCandidate[];
  matchingConfirmedFacts: Array<{ candidate: AmazonPreviewCandidate; confirmed: ConfirmedFactCandidate; amazonSourceConfirmed: boolean }>;
  conflicts: Array<{ candidate: AmazonPreviewCandidate; confirmed: ConfirmedFactCandidate }>;
};

/**
 * Rebuild the deterministic candidate view for a pending Amazon preview.
 * The preview is never persisted or mutated here; this is a read-only
 * identity check shared by the confirmation route and the orchestrator.
 */
export function getPendingAmazonPreviewCandidates(input: {
  pending: BrowserEvidenceStoredPreview;
  taskAsin: string;
  context: AccessContext;
}): AmazonPreviewCandidate[] | null {
  try {
    const snapshot = buildConfirmedSnapshot({
      preview: input.pending.preview,
      taskAsin: input.taskAsin,
      capturedAt: input.pending.capturedAt,
      context: input.context,
    });
    const view = buildFactCandidateView({
      browserEvidence: {
        schema: "browser-evidence.v1",
        version: 1,
        candidateId: null,
        targetAsin: input.taskAsin,
        snapshots: [snapshot],
        updatedAt: input.pending.capturedAt,
      },
    });
    // buildFactCandidateView 按 canonical field 合并同一 Preview 内的来源。
    // 这里必须把被合并进 alternateSources 的 Amazon 来源重新展开，否则
    // title-derived candidate 会吞掉 Product Information 的来源身份，导致
    // 新来源无法被确认或写入 resolution。
    const expanded: AmazonPreviewCandidate[] = [];
    const seen = new Set<string>();
    const push = (candidate: AmazonPreviewCandidate) => {
      if (candidate.sourceKind !== "amazon_browser_evidence" && candidate.sourceKind !== "amazon_product_info") return;
      const key = [candidate.field, candidate.sourceKind, candidate.sourceRef, String(candidate.value).trim()].join("\u0000");
      if (seen.has(key)) return;
      seen.add(key);
      expanded.push({ ...candidate, ...(candidate.alternateSources ? { alternateSources: undefined } : {}) });
    };
    for (const candidate of view.candidates) {
      push(candidate);
      for (const source of candidate.alternateSources ?? []) {
        if (source.sourceKind !== "amazon_browser_evidence" && source.sourceKind !== "amazon_product_info") continue;
        push({
          ...candidate,
          candidateId: `${source.sourceKind}:${candidate.field}`,
          sourceKind: source.sourceKind as AmazonPreviewCandidate["sourceKind"],
          sourceRef: source.sourceRef,
          value: source.value,
          alternateSources: undefined,
        });
      }
    }
    return expanded;
  } catch {
    return null;
  }
}

export function sameValue(left: string | number, right: string | number): boolean {
  const lStr = String(left).trim();
  const rStr = String(right).trim();
  if (lStr.toLowerCase() === rStr.toLowerCase()) return true;
  const lNum = Number(lStr);
  const rNum = Number(rStr);
  if (!Number.isNaN(lNum) && !Number.isNaN(rNum) && lNum === rNum) return true;
  return false;
}

/**
 * A preview candidate is covered only when the exact candidate was confirmed,
 * or when it was merged into a confirmed canonical field and its Amazon
 * provenance/value was retained as an alternate source. A zero pending count
 * alone is deliberately insufficient.
 */
export function confirmedFactCoversAmazonPreviewCandidate(
  confirmed: ConfirmedFactCandidate,
  previewCandidate: AmazonPreviewCandidate,
): boolean {
  if (confirmed.field !== previewCandidate.field) {
    return false;
  }
  if (confirmed.candidateId === previewCandidate.candidateId) {
    return confirmed.sourceKind === previewCandidate.sourceKind
      && confirmed.sourceRef === previewCandidate.sourceRef
      && sameValue(confirmed.value, previewCandidate.value);
  }
  if (
    sameValue(confirmed.value, previewCandidate.value)
    && (confirmed.sourceKind === previewCandidate.sourceKind || confirmed.sourceRef === previewCandidate.sourceRef)
  ) {
    return true;
  }
  if (confirmed.alternateSources?.some((source) => (
    source.sourceKind === previewCandidate.sourceKind
    && source.sourceRef === previewCandidate.sourceRef
    && (sameValue(source.value, previewCandidate.value) || factCategoryOf(previewCandidate.field) === "market_observation")
  ))) {
    return true;
  }
  if (
    (confirmed.sourceKind === previewCandidate.sourceKind || confirmed.sourceRef === previewCandidate.sourceRef)
    && factCategoryOf(previewCandidate.field) === "market_observation"
  ) {
    return true;
  }
  return false;
}

export function isPendingAmazonPreviewCovered(input: {
  pending: BrowserEvidenceStoredPreview;
  taskAsin: string;
  context: AccessContext;
  confirmed: ConfirmedFactCandidate[];
}): boolean {
  const candidates = getPendingAmazonPreviewCandidates(input);
  if (!candidates || candidates.length === 0) return false;
  return candidates.every((candidate) => input.confirmed.some((fact) => (
    confirmedFactCoversAmazonPreviewCandidate(fact, candidate)
  )));
}

export function classifyAmazonPreviewAgainstConfirmedFacts(input: {
  pending: BrowserEvidenceStoredPreview;
  taskAsin: string;
  context: AccessContext;
  confirmed: ConfirmedFactCandidate[];
}): AmazonPreviewClassification | null {
  const candidates = getPendingAmazonPreviewCandidates(input);
  if (!candidates) return null;
  const result: AmazonPreviewClassification = { newFacts: [], matchingConfirmedFacts: [], conflicts: [] };
  for (const candidate of candidates) {
    const matching = input.confirmed.filter((fact) => (
      fact.field === candidate.field && sameValue(fact.value, candidate.value)
    ));
    if (matching.length > 0) {
      const fact = matching[0]!;
      result.matchingConfirmedFacts.push({
        candidate,
        confirmed: fact,
        amazonSourceConfirmed: confirmedFactCoversAmazonPreviewCandidate(fact, candidate),
      });
      continue;
    }
    const conflict = input.confirmed.find((fact) => fact.field === candidate.field);
    if (conflict) {
      if (factCategoryOf(candidate.field) === "market_observation") {
        result.matchingConfirmedFacts.push({
          candidate,
          confirmed: conflict,
          amazonSourceConfirmed: confirmedFactCoversAmazonPreviewCandidate(conflict, candidate),
        });
      } else {
        result.conflicts.push({ candidate, confirmed: conflict });
      }
    } else {
      result.newFacts.push(candidate);
    }
  }
  return result;
}

export function toAmazonPreviewResolutionRefs(
  candidates: AmazonPreviewCandidate[],
): AmazonPreviewResolutionV1["candidateRefs"] {
  return candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    field: candidate.field,
    sourceKind: candidate.sourceKind,
    sourceRef: candidate.sourceRef,
  }));
}
