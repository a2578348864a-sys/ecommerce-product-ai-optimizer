import { createHash } from "node:crypto";
import type { AccessContext } from "@/lib/server/accessPassword";
import { browserEvidenceSubjectKey } from "@/lib/server/browserEvidenceCollect";
import type { AmazonFactCandidateV1, AmazonFactEnrichmentPreviewV1 } from "./contract";

const MAX_ENTRIES = 64;

export type AmazonFactEnrichmentResult = { preview: AmazonFactEnrichmentPreviewV1; evidenceId: string };

type Entry = {
  id: string;
  subjectKey: string;
  preview: AmazonFactEnrichmentPreviewV1;
};

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<AmazonFactEnrichmentResult>>();

function prune(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, entry] of entries) {
    if (entry.preview.expiresAt <= cutoff) entries.delete(id);
  }
}

function selectionId(subjectKey: string, taskId: string, asin: string, evidenceId: string, candidateId: string): string {
  const digest = createHash("sha256")
    .update(`amazon-confirm:v1:${subjectKey}:${taskId}:${asin}:${evidenceId}:${candidateId}`, "utf8")
    .digest("hex");
  return `amazon-confirm:${digest.slice(0, 40)}`;
}

export function bindAmazonPreviewSelectionIds(
  preview: AmazonFactEnrichmentPreviewV1,
  input: { subjectKey: string; evidenceId: string },
): AmazonFactEnrichmentPreviewV1 {
  return {
    ...preview,
    candidates: preview.candidates.map((candidate) => ({
      ...candidate,
      id: selectionId(input.subjectKey, preview.taskId, preview.asin, input.evidenceId, candidate.id),
    })),
  };
}

export function putAmazonFactEnrichmentPreview(input: {
  evidenceId: string;
  subjectKey: string;
  preview: AmazonFactEnrichmentPreviewV1;
}): void {
  prune();
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (typeof oldest === "string") entries.delete(oldest);
  }
  entries.set(input.evidenceId, { id: input.evidenceId, subjectKey: input.subjectKey, preview: input.preview });
}

export function findAmazonFactEnrichmentPreview(input: {
  subjectKey: string;
  taskId: string;
  asin: string;
}): AmazonFactEnrichmentResult | undefined {
  prune();
  for (const entry of entries.values()) {
    if (entry.subjectKey === input.subjectKey && entry.preview.taskId === input.taskId && entry.preview.asin === input.asin && entry.preview.expiresAt > Date.now()) {
      return { preview: entry.preview, evidenceId: entry.id };
    }
  }
  return undefined;
}

export function getAmazonFactEnrichmentPreview(input: {
  evidenceId: string;
  subjectKey: string;
  taskId: string;
  asin: string;
}): AmazonFactEnrichmentPreviewV1 {
  const entry = entries.get(input.evidenceId);
  if (!entry) throw new AmazonFactEnrichmentPreviewError("amazon_enrichment_preview_missing", "Amazon 商品事实候选不存在，请重新自动查找。", 409);
  if (entry.preview.expiresAt <= Date.now()) {
    throw new AmazonFactEnrichmentPreviewError("amazon_enrichment_preview_expired", "Amazon 商品事实候选已过期，请重新自动查找。", 409);
  }
  if (entry.subjectKey !== input.subjectKey || entry.preview.taskId !== input.taskId) {
    throw new AmazonFactEnrichmentPreviewError("amazon_enrichment_selection_invalid", "Amazon 商品事实候选与当前任务不匹配。", 400);
  }
  if (entry.preview.asin !== input.asin) {
    throw new AmazonFactEnrichmentPreviewError("amazon_enrichment_asin_mismatch", "Amazon 商品事实候选与当前 ASIN 不匹配。", 422);
  }
  return entry.preview;
}

export function resolveAmazonFactEnrichmentSelections(input: {
  context: AccessContext;
  taskId: string;
  authoritativeAsin: string;
  evidenceId: string;
  selectionIds: string[];
}): AmazonFactCandidateV1[] {
  const preview = getAmazonFactEnrichmentPreview({
    evidenceId: input.evidenceId,
    subjectKey: browserEvidenceSubjectKey(input.context),
    taskId: input.taskId,
    asin: input.authoritativeAsin,
  });
  const byId = new Map(preview.candidates.map((candidate) => [candidate.id, candidate]));
  const selected = input.selectionIds.map((id) => byId.get(id));
  if (selected.some((candidate) => !candidate)) {
    throw new AmazonFactEnrichmentPreviewError("amazon_enrichment_selection_invalid", "Amazon 商品事实候选选择无效。", 400);
  }
  const candidates = selected as AmazonFactCandidateV1[];
  if (candidates.some((candidate) => candidate.sources.length < 1)) {
    throw new AmazonFactEnrichmentPreviewError("amazon_enrichment_selection_invalid", "Amazon 商品事实候选缺少可追溯来源。", 409);
  }
  if (candidates.some((candidate) => candidate.conflict)) {
    throw new AmazonFactEnrichmentPreviewError("amazon_enrichment_selection_invalid", "冲突候选不能直接确认。", 409);
  }
  const fields = new Set<string>();
  for (const candidate of candidates) {
    if (fields.has(candidate.field)) {
      throw new AmazonFactEnrichmentPreviewError("amazon_enrichment_duplicate_field_selection", "同一商品字段只能确认一个值。", 409);
    }
    fields.add(candidate.field);
  }
  return candidates;
}

export function amazonFactEnrichmentKey(context: AccessContext, taskId: string, asin: string): string {
  return `${browserEvidenceSubjectKey(context)}:${taskId}:${asin}`;
}

export function getAmazonFactEnrichmentInFlight(key: string): Promise<AmazonFactEnrichmentResult> | undefined {
  return inFlight.get(key);
}

export function setAmazonFactEnrichmentInFlight(key: string, operation: Promise<AmazonFactEnrichmentResult>): void {
  inFlight.set(key, operation);
}

export function clearAmazonFactEnrichmentInFlight(key: string): void {
  inFlight.delete(key);
}

export function resetAmazonFactEnrichmentStoreForTests(): void {
  entries.clear();
  inFlight.clear();
}

export class AmazonFactEnrichmentPreviewError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "AmazonFactEnrichmentPreviewError";
  }
}


