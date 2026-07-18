import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  generateStage15ShadowEvaluationWorkbench,
  renderStage15ShadowEvaluationWorkbench,
} from "./generate-stage15-shadow-evaluation-workbench";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function material(role: "calibration" | "validation" = "calibration") {
  const prefix = role === "calibration" ? "C" : "V";
  const packetBody = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-packet.v1" as const,
    batchLabel: `Batch ${prefix}`,
    status: "pending_human_evaluation" as const,
    proofLevel: "real_public_category_page_evidence" as const,
    blindBoundary: {
      hidesProductIdentity: true,
      hidesStage1RankAndScore: true,
      hidesStage15Status: true,
      hidesShadowPolicyAndPrediction: true,
    },
    items: Array.from({ length: 20 }, (_, index) => ({
      schemaVersion: "stage15-shadow-combined-human-evaluation-item.v1" as const,
      evaluationItemId: `${prefix}-${String(index + 1).padStart(2, "0")}`,
      presentationAid: { purpose: "用途理解辅助", status: "presentation_aid_not_source_fact" as const },
      sourceEvidence: {
        title: `商品 ${index + 1}`,
        imageUrl: `https://images.example.test/${index + 1}.jpg`,
        imageStatus: "external_reference_not_cached" as const,
        price: 10 + index,
        currency: "USD" as const,
        rating: 4.5,
        reviewCount: 100 + index,
        categoryRank: index + 1,
        category: "Test category",
        dimensions: null,
        material: null,
        monthlyBought: null,
        firstAvailableAt: null,
        exactVariantPositiveReviews: null,
        exactVariantNegativeReviews: null,
        missingReasons: ["exact_variant_reviews_not_collected"],
        capturedAt: "2026-07-17T05:00:00.000Z",
      },
    })),
  };
  const packet = { ...packetBody, packetHash: stableHash(packetBody) };
  const resultTemplate = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-result-template.v1" as const,
    batchId: `batch-${prefix.toLowerCase()}`,
    sourcePacketHash: packet.packetHash,
    status: "pending_human_evaluation" as const,
    answers: packet.items.map((item) => ({
      evaluationItemId: item.evaluationItemId,
      productUnderstood: null,
      investigateNext10Minutes: null,
      screeningEvidenceSufficient: null,
      worthFurtherInvestigation: null,
      evidenceSufficient: null,
      dominantSignals: [],
      confidence: null,
      reason: "",
    })),
  };
  return { packet, resultTemplate };
}

describe("Stage 1.5 local evaluation workbench", () => {
  it("renders 20 visible-image forms with local draft persistence and validated JSON export", () => {
    const { packet, resultTemplate } = material();
    const html = renderStage15ShadowEvaluationWorkbench({
      packet,
      resultTemplate,
      role: "calibration",
      locked: false,
    });
    expect(html.match(/<img /gu)).toHaveLength(20);
    expect(html).toContain("保存到本机草稿");
    expect(html).toContain("导出已完成评价 JSON");
    expect(html).toContain("localStorage");
    expect(html).toContain("stage15-shadow-combined-human-evaluation-result.v1");
    expect(html).toContain("worthFurtherInvestigation");
    expect(html).not.toContain("productKey");
    expect(html).not.toContain("candidateId");
    expect(html).not.toMatch(/\bB0[A-Z0-9]{8}\b/u);
  });

  it("shows exact-variant positive and negative review evidence with its sample count", () => {
    const { packet, resultTemplate } = material();
    const { packetHash: _sourceHash, ...sourceBody } = packet;
    void _sourceHash;
    const enrichedBody = {
      ...sourceBody,
      proofLevel: "real_public_detail_page_exact_variant_evidence",
      items: sourceBody.items.map((item, index) => ({
        ...item,
        sourceEvidence: {
          ...item.sourceEvidence,
          exactVariantPositiveReviews: [`好评原文摘要 ${index + 1}`],
          exactVariantNegativeReviews: [`差评原文摘要 ${index + 1}`],
          exactVariantReviewSampleCount: 2,
          missingReasons: [],
        },
      })),
    };
    const enrichedPacket = { ...enrichedBody, packetHash: stableHash(enrichedBody) };
    const html = renderStage15ShadowEvaluationWorkbench({
      packet: enrichedPacket,
      resultTemplate: { ...resultTemplate, sourcePacketHash: enrichedPacket.packetHash },
      role: "calibration",
      locked: false,
    });
    expect(html).toContain("精确同款好评");
    expect(html).toContain("好评原文摘要 1");
    expect(html).toContain("精确同款差评");
    expect(html).toContain("差评原文摘要 1");
    expect(html).toContain("评论样本数：2");
  });

  it("keeps Batch V viewable but locked until the calibration policy hash is frozen", () => {
    const { packet, resultTemplate } = material("validation");
    const html = renderStage15ShadowEvaluationWorkbench({
      packet,
      resultTemplate,
      role: "validation",
      locked: true,
    });
    expect(html).toContain('data-locked="true"');
    expect(html).toContain("等待 Batch C policy Hash 冻结");
    expect(html).toContain("disabled");
    expect(html).not.toContain("导出已完成评价 JSON");
  });

  it("writes a hash-bound supplement without modifying the frozen upstream manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "stage15-eval-workbench-"));
    roots.push(root);
    const { packet, resultTemplate } = material();
    const sourceManifest = {
      schemaVersion: "stage15-shadow-upstream-manifest.v1",
      manifestId: "source-manifest-c",
      batchId: "batch-c",
      role: "calibration" as const,
      manifestHash: "f".repeat(64),
    };
    const first = generateStage15ShadowEvaluationWorkbench({
      packet,
      resultTemplate,
      sourceManifest,
      sourceManifestFileSha256: "a".repeat(64),
      accessBudget: { maxDetailPageRequests: 0, detailPagesAccessed: 0 },
      role: "calibration",
      outputDirectory: root,
      createdAt: "2026-07-17T06:00:00.000Z",
    });
    const second = generateStage15ShadowEvaluationWorkbench({
      packet,
      resultTemplate,
      sourceManifest,
      sourceManifestFileSha256: "a".repeat(64),
      accessBudget: { maxDetailPageRequests: 0, detailPagesAccessed: 0 },
      role: "calibration",
      outputDirectory: root,
      createdAt: "2026-07-17T06:00:00.000Z",
    });
    expect(first.artifactWrite.written).toHaveLength(3);
    expect(second.artifactWrite.unchanged).toEqual(first.files);
    const supplement = JSON.parse(readFileSync(join(root, "evaluation-readiness-supplement.v1.json"), "utf8"));
    expect(supplement.sourceUpstreamManifest).toMatchObject({ manifestId: "source-manifest-c", fileSha256: "a".repeat(64) });
    expect(supplement.policyCandidateFeasibility).toBe("blocked_by_exact_variant_review_coverage_0_of_10");
    expect(supplement.boundary).toMatchObject({ databaseWritten: false, productionEffect: false });
  });

  it("rejects packet, template, role, or source bindings that drift", () => {
    const { packet, resultTemplate } = material();
    expect(() => renderStage15ShadowEvaluationWorkbench({
      packet: { ...packet, packetHash: "tampered" },
      resultTemplate,
      role: "calibration",
      locked: false,
    })).toThrow();
    expect(() => renderStage15ShadowEvaluationWorkbench({
      packet,
      resultTemplate: { ...resultTemplate, sourcePacketHash: "tampered" },
      role: "calibration",
      locked: false,
    })).toThrow();
  });
});
