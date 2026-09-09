import { describe, expect, it } from "vitest";
import { buildDemoBrowserCollectPreview } from "@/lib/server/demoAcquisitionSamples";
import type { AccessContext } from "@/lib/server/accessPassword";
import {
  confirmedFactCoversAmazonPreviewCandidate,
  classifyAmazonPreviewAgainstConfirmedFacts,
  getPendingAmazonPreviewCandidates,
  isPendingAmazonPreviewCovered,
} from "./amazonPreviewClosure";

const context: AccessContext = { mode: "owner", token: "test-owner-token" };

function pending() {
  const preview = buildDemoBrowserCollectPreview("B0SAMPLE01");
  return {
    evidenceId: "bev_preview_closure_test",
    preview,
    capturedAt: new Date().toISOString(),
    expiresAt: Date.now() + 60_000,
    subjectKey: "owner:v1",
    taskId: "task-closure",
    asin: "B0SAMPLE01",
  };
}

describe("amazonPreviewClosure", () => {
  it("canonical field confirmed with retained Amazon alternate provenance covers preview", () => {
    const stored = pending();
    const candidates = getPendingAmazonPreviewCandidates({
      pending: stored,
      taskAsin: stored.asin,
      context,
    }) ?? [];
    const candidate = candidates.find((item) => item.sourceKind === "amazon_browser_evidence");
    expect(candidate).toBeTruthy();
    const mergedConfirmed = {
      ...candidate!,
      candidateId: `product_title:${candidate!.field}`,
      sourceKind: "product_title" as const,
      sourceRef: "product_title.derived",
      alternateSources: [{
        sourceKind: candidate!.sourceKind,
        sourceRef: candidate!.sourceRef,
        value: candidate!.value,
      }],
      confirmedAt: new Date().toISOString(),
      confirmedBy: "owner:v1",
    };
    expect(confirmedFactCoversAmazonPreviewCandidate(mergedConfirmed, candidate!)).toBe(true);
    expect(isPendingAmazonPreviewCovered({
      pending: stored,
      taskAsin: stored.asin,
      context,
      confirmed: [
        mergedConfirmed,
        ...candidates.filter((item) => item !== candidate).map((item) => ({
          ...item,
          confirmedAt: new Date().toISOString(),
          confirmedBy: "owner:v1",
        })),
      ],
    })).toBe(true);
  });

  it("同字段值冲突且无 Amazon provenance 时不会覆盖 preview", () => {
    const stored = pending();
    const candidate = getPendingAmazonPreviewCandidates({
      pending: stored,
      taskAsin: stored.asin,
      context,
    })?.find((item) => item.sourceKind === "amazon_browser_evidence");
    expect(candidate).toBeTruthy();
    const confirmed = {
      ...candidate!,
      candidateId: `product_title:${candidate!.field}`,
      sourceKind: "product_title" as const,
      sourceRef: "product_title.derived",
      value: typeof candidate!.value === "number" ? candidate!.value + 1 : `${candidate!.value}-changed`,
      confirmedAt: new Date().toISOString(),
      confirmedBy: "owner:v1",
    };
    expect(confirmedFactCoversAmazonPreviewCandidate(confirmed, candidate!)).toBe(false);
  });

  it("Preview 内同一字段被标题与 Product Information 合并时仍保留两个 Amazon 来源", () => {
    const stored = pending();
    stored.preview.extraction.fields.title.value = "Stainless Steel Toaster";
    stored.preview.extraction.fields.price.value = null;
    stored.preview.extraction.fields.bsr.value = null;
    stored.preview.extraction.fields.rating.value = null;
    stored.preview.extraction.fields.reviews.value = null;
    stored.preview.productInfo = {
      schemaVersion: "amazon-product-info-extraction.v1",
      entityBound: true,
      bindingReason: null,
      rows: [{ label: "Material", value: "Stainless Steel", sourceSection: "productOverview_feature_div" }],
      canonicalFacts: { material: "Stainless Steel" },
      capturedAt: new Date().toISOString(),
      collectorVersion: "test",
    };
    const candidates = getPendingAmazonPreviewCandidates({ pending: stored, taskAsin: stored.asin, context }) ?? [];
    const materialSources = candidates.filter((candidate) => candidate.field === "material");
    expect(materialSources.some((candidate) => candidate.sourceKind === "amazon_product_info")).toBe(true);
    expect(materialSources.length).toBeGreaterThanOrEqual(1);
  });

  it("同 canonical product_fact 但不同值分类为 conflict，不可作为来源闭环", () => {
    const stored = pending();
    stored.preview.productInfo = {
      schemaVersion: "amazon-product-info-extraction.v1",
      entityBound: true,
      bindingReason: null,
      rows: [{ label: "Material", value: "Stainless Steel", sourceSection: "productOverview_feature_div" }],
      canonicalFacts: { material: "Stainless Steel" },
      capturedAt: new Date().toISOString(),
      collectorVersion: "test",
    };
    const candidate = getPendingAmazonPreviewCandidates({ pending: stored, taskAsin: stored.asin, context })?.find((item) => item.field === "material");
    expect(candidate).toBeTruthy();
    const classification = classifyAmazonPreviewAgainstConfirmedFacts({
      pending: stored,
      taskAsin: stored.asin,
      context,
      confirmed: [{
        ...candidate!,
        value: "Wood",
        confirmedAt: new Date().toISOString(),
        confirmedBy: "owner:v1",
      }],
    });
    expect(classification?.conflicts.some((item) => item.candidate.field === "material")).toBe(true);
  });

  it("市场观察字段数值变动归入 matchingConfirmedFacts 补充来源，不作为阻断冲突", () => {
    const stored = pending();
    const candidate = getPendingAmazonPreviewCandidates({ pending: stored, taskAsin: stored.asin, context })?.find((item) => item.field === "reviews");
    expect(candidate).toBeTruthy();
    const classification = classifyAmazonPreviewAgainstConfirmedFacts({
      pending: stored,
      taskAsin: stored.asin,
      context,
      confirmed: [{
        ...candidate!,
        value: typeof candidate!.value === "number" ? candidate!.value - 50 : 100,
        confirmedAt: new Date().toISOString(),
        confirmedBy: "owner:v1",
      }],
    });
    expect(classification?.conflicts.some((item) => item.candidate.field === "reviews")).toBe(false);
    expect(classification?.matchingConfirmedFacts.some((item) => item.candidate.field === "reviews")).toBe(true);
  });
});
