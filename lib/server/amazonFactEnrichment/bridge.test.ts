import { describe, expect, it, beforeEach } from "vitest";
import { bindAmazonPreviewSelectionIds, getAmazonFactEnrichmentPreview, putAmazonFactEnrichmentPreview, resetAmazonFactEnrichmentStoreForTests, resolveAmazonFactEnrichmentSelections } from "./previewStore";
import { mapSellerBlocksToCandidates } from "./mapping";
import type { AmazonFactEnrichmentPreviewV1 } from "./contract";
import { browserEvidenceSubjectKey } from "../browserEvidenceCollect";

const context = { mode: "owner", token: "test-token" } as const;
const base = (): AmazonFactEnrichmentPreviewV1 => ({
  schema: "amazon-fact-enrichment.v1", taskId: "task-1", asin: "B0CKQNP26P",
  collectedAt: "2026-09-07T00:00:00.000Z", expiresAt: Date.now() + 60_000,
  naturalLanguageStatus: "not_needed", sourceBlocks: [],
  candidates: mapSellerBlocksToCandidates({ taskId: "task-1", asin: "B0CKQNP26P", structured: { construction: "Metal", operation: "Self-Adhesive" }, blocks: [] }),
});

describe("Amazon enrichment provenance bridge", () => {
  beforeEach(() => resetAmazonFactEnrichmentStoreForTests());
  it("binds opaque selection ids and resolves only the bound preview", () => {
    const evidenceId = "00000000-0000-4000-8000-000000000001";
    const preview = bindAmazonPreviewSelectionIds(base(), { subjectKey: browserEvidenceSubjectKey(context), evidenceId });
    putAmazonFactEnrichmentPreview({ evidenceId, subjectKey: browserEvidenceSubjectKey(context), preview });
    const selected = resolveAmazonFactEnrichmentSelections({ context, taskId: "task-1", authoritativeAsin: "B0CKQNP26P", evidenceId, selectionIds: [preview.candidates[0].id] });
    expect(selected[0].id).toBe(preview.candidates[0].id);
    expect(() => getAmazonFactEnrichmentPreview({ evidenceId, subjectKey: "other", taskId: "task-1", asin: "B0CKQNP26P" })).toThrow("Amazon 商品事实候选与当前任务不匹配");
  });
  it("rejects duplicate canonical fields and expired previews", () => {
    const evidenceId = "00000000-0000-4000-8000-000000000002";
    const preview = bindAmazonPreviewSelectionIds(base(), { subjectKey: browserEvidenceSubjectKey(context), evidenceId });
    const duplicate = { ...preview, candidates: [...preview.candidates, { ...preview.candidates[0], id: preview.candidates[0].id + "-other", value: "Steel" }] };
    putAmazonFactEnrichmentPreview({ evidenceId, subjectKey: browserEvidenceSubjectKey(context), preview: duplicate });
    expect(() => resolveAmazonFactEnrichmentSelections({ context, taskId: "task-1", authoritativeAsin: "B0CKQNP26P", evidenceId, selectionIds: [duplicate.candidates[0].id, duplicate.candidates[2].id] })).toThrow("同一商品字段只能确认一个值");
    const expiredId = "00000000-0000-4000-8000-000000000003";
    putAmazonFactEnrichmentPreview({ evidenceId: expiredId, subjectKey: browserEvidenceSubjectKey(context), preview: { ...base(), expiresAt: Date.now() - 1 } });
    expect(() => getAmazonFactEnrichmentPreview({ evidenceId: expiredId, subjectKey: browserEvidenceSubjectKey(context), taskId: "task-1", asin: "B0CKQNP26P" })).toThrow("Amazon 商品事实候选已过期");
  });
});




