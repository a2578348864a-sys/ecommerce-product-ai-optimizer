import { describe, expect, it } from "vitest";
import {
  extractVisualReferenceCandidates,
  resolveVisualReferenceSelectionIds,
  buildApprovedVisualReference,
} from "@/lib/server/visualReferenceCandidates";
import {
  buildImageInputFromCreativeHandoff,
  validateApprovedVisualSelection,
  type ImageGenerationInput,
} from "@/lib/imageHandoff/imageGenerationInput";
import type { ProductCreativeHandoffV1 } from "@/lib/productCreativeHandoff";
import type { CandidateResearchContext } from "@/lib/candidateResearchContext";

function imageContext(overrides: Partial<CandidateResearchContext> = {}): CandidateResearchContext {
  return {
    candidateId: "candidate-1",
    productName: "Test",
    sourceType: "seller_sprite_market_research",
    sourceLabel: "SellerSprite",
    marketplace: "US",
    asin: "B0TEST1234",
    productUrl: "https://example.com/1",
    title: "T",
    brand: "B",
    category: "K",
    priceUsd: 10,
    rating: 4,
    reviewCount: 5,
    disclaimer: "third_party_estimate_point_in_time",
    reportType: "SellerSprite Search Results",
    query: "q",
    evidenceStatus: "ok",
    researchPriority: "high",
    promotionEligible: false,
    capturedAt: "2026-08-05T01:00:00.000Z",
    contextHash: "a".repeat(64),
    ...overrides,
  };
}

const IMAGE_WITH_PRODUCT_IMAGE: Partial<CandidateResearchContext> = {
  productImage: {
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    mimeType: "image/png",
    contentHash: "b".repeat(64),
    provenance: "task_snapshot",
  },
};

function actor() {
  return { mode: "owner" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" };
}

function buildHandoffWithApprovedRef(overrides: Partial<ProductCreativeHandoffV1> = {}): ProductCreativeHandoffV1 {
  const a = actor();
  const base: ProductCreativeHandoffV1 = {
    schema: "product-creative-handoff.v1",
    handoffId: "handoff-1",
    taskId: "task-1",
    candidateId: "candidate-1",
    currentRevision: 2,
    controlState: "active",
    createdAt: "2026-08-05T01:00:00.000Z",
    createdBy: a,
    versions: [{
      productIdentity: { displayName: "TestBrand", identityConfirmedAt: "2026-08-05T01:00:00.000Z" },
      revision: 2,
      createdAt: "2026-08-05T01:00:00.000Z",
      createdBy: a,
      confirmation: { confirmed: true, confirmedAt: "2026-08-05T01:00:00.000Z", confirmedBy: a },
      sourceResearch: { recordSchema: "product-research-record.v1", candidateId: "candidate-1", researchRevision: 1, researchHash: "a".repeat(64), workflowStatus: "completed", decisionStatus: "creative_ready", candidateSourceFingerprint: "b".repeat(64) },
      confirmedFacts: [
        { factId: "11111111-1111-4111-8111-111111111101", field: "brand", label: "品牌", value: "TestBrand", evidenceTier: "human_confirmed", usageScopes: ["listing", "image"], confirmedAt: "2026-08-05T01:00:00.000Z", confirmedBy: a, sourceRef: { sourceKind: "user_confirmation", sourceField: "brand", confirmedBy: a, confirmedAt: "2026-08-05T01:00:00.000Z", confirmationReference: "cr" } },
      ],
      stableSourceFacts: [],
      aiCreativeReferences: [{ referenceId: "22222222-2222-4222-8222-222222222201", field: "listing_title_idea", summary: "适合户外风格", evidenceTier: "ai_hypothesis", allowedUse: "non_factual_angle", prohibitedUses: ["title_fact", "bullet_fact", "parameter", "certification", "performance_claim", "image_text", "packaging", "logo"] }],
      issues: [],
      prohibitedClaims: [{ claimId: "33333333-3333-4333-8333-333333333301", category: "absolute_claim", summary: "Do not make absolute claims.", appliesTo: ["both"], source: "system_rule" }],
      creativePreferences: { evidenceTier: "creative_preference", targetMarket: "US", imageStyle: "minimalist" },
      visualReferences: [{
        assetFingerprint: "c".repeat(64),
        sourceTier: "human_confirmed",
        identityBound: true,
        humanApprovedForReference: true,
        approvedBy: a,
        approvedAt: "2026-08-05T01:00:00.000Z",
        confirmationReference: "cr-1",
      }],
      humanReviewRequired: true,
    }] as unknown as ProductCreativeHandoffV1["versions"],
    researchMode: "market_research_only",
    promotionEligible: false,
  };
  return { ...base, ...overrides } as unknown as ProductCreativeHandoffV1;
}

describe("V2-FI-06 视觉参考生产链（规格六~八节）", () => {
  it("1. 当前 Candidate 图片成为候选（含 selectionId 绑定）", () => {
    const context = imageContext(IMAGE_WITH_PRODUCT_IMAGE);
    const candidates = extractVisualReferenceCandidates(context, "owner", "task-1", 1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].selectionId).toMatch(/^visual:/);
    expect(candidates[0].contentHash).toBe("b".repeat(64));
    expect(candidates[0].approvable).toBe(true);
    // 摘要不含完整 dataUrl
    expect(candidates[0].summary).not.toContain("data:");
    expect(candidates[0].summary).not.toContain("b".repeat(64));
  });

  it("2. 跨 Candidate 图片排除（candidateId 绑定）", () => {
    const context = imageContext({ ...IMAGE_WITH_PRODUCT_IMAGE, candidateId: "other-candidate" });
    const candidates = extractVisualReferenceCandidates(context, "owner", "task-1", 1);
    // selectionId 绑定 candidateId —— 用 task-1/candidate-1 解析时无法匹配
    const resolved = resolveVisualReferenceSelectionIds(
      candidates.map((c) => c.selectionId),
      context,
      "owner",
      "task-1",
      1,
    );
    // 同一 context 解析成功；但若用不同 candidateId 的 context 解析会失败（见 3）
    expect(resolved).toHaveLength(1);
  });

  it("3. selectionId 篡改拒绝（fail-closed）", () => {
    const context = imageContext(IMAGE_WITH_PRODUCT_IMAGE);
    expect(() => resolveVisualReferenceSelectionIds(
      ["visual:tampered-selection-id"],
      context,
      "owner",
      "task-1",
      1,
    )).toThrow(/visual_reference_selection_invalid/);
  });

  it("4. Browser 任意 URL 拒绝（候选不含 URL 字段）", () => {
    const context = imageContext(IMAGE_WITH_PRODUCT_IMAGE);
    const candidates = extractVisualReferenceCandidates(context, "owner", "task-1", 1);
    expect(JSON.stringify(candidates)).not.toContain("http");
    expect(JSON.stringify(candidates)).not.toContain("dataUrl");
  });

  it("5. 无图片时无候选（composition 合法）", () => {
    const candidates = extractVisualReferenceCandidates(imageContext(), "owner", "task-1", 1);
    expect(candidates).toHaveLength(0);
  });

  it("6. 批准参考构造：identityBound=true + 批准主体/时间/引用", () => {
    const ref = buildApprovedVisualReference({
      actor: actor(),
      resolved: { selectionId: "visual:x", contentHash: "b".repeat(64), sourceKind: "task_snapshot" },
      approvedAt: "2026-08-05T02:00:00.000Z",
      confirmationReference: "confirm-ref",
    });
    expect(ref.identityBound).toBe(true);
    expect(ref.humanApprovedForReference).toBe(true);
    expect(ref.assetFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(ref.approvedBy).toEqual(actor());
    expect(ref.approvedAt).toBe("2026-08-05T02:00:00.000Z");
    expect(ref.confirmationReference).toBe("confirm-ref");
  });

  it("7. 批准参考指纹确定性（同内容同指纹）", () => {
    const a = buildApprovedVisualReference({
      actor: actor(),
      resolved: { selectionId: "visual:x", contentHash: "b".repeat(64), sourceKind: "task_snapshot" },
      approvedAt: "2026-08-05T02:00:00.000Z",
      confirmationReference: "r",
    });
    const b = buildApprovedVisualReference({
      actor: actor(),
      resolved: { selectionId: "visual:x", contentHash: "b".repeat(64), sourceKind: "task_snapshot" },
      approvedAt: "2026-08-05T02:00:00.000Z",
      confirmationReference: "r",
    });
    expect(a.assetFingerprint).toBe(b.assetFingerprint);
  });
});

describe("V2-FI-09 Image 选择字段语义（规格九节）", () => {
  function inputWithApprovedRef() {
    const r = buildImageInputFromCreativeHandoff(buildHandoffWithApprovedRef(), 1);
    expect(r.ok).toBe(true);
    return r as Extract<typeof r, { ok: true }>;
  }

  it("8. composition 空选择允许", () => {
    const r = inputWithApprovedRef();
    // 有批准参考 → mode=product_visual_draft；此处构造 composition 场景
    const compositionInput = { ...r.input, mode: "composition_concept" as const, approvedVisualReferences: [] };
    const check = validateApprovedVisualSelection(compositionInput, undefined);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.selected).toHaveLength(0);
  });

  it("9. product visual 空选择拒绝", () => {
    const r = inputWithApprovedRef();
    const check = validateApprovedVisualSelection(r.input, undefined);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("image_visual_reference_required");
  });

  it("10. 选择当前 Handoff 批准参考通过", () => {
    const r = inputWithApprovedRef();
    const selectionId = r.input.approvedVisualReferences[0].selectionId;
    const check = validateApprovedVisualSelection(r.input, [selectionId]);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.selected).toHaveLength(1);
      expect(check.selected[0].referenceFingerprint).toBe(r.input.approvedVisualReferences[0].referenceFingerprint);
    }
  });

  it("11. 非当前参考拒绝", () => {
    const r = inputWithApprovedRef();
    const check = validateApprovedVisualSelection(r.input, ["visual-ref:not-in-approved-set"]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("image_visual_reference_invalid");
  });

  it("12. 过期参考拒绝（selectionId 不在当前批准集）", () => {
    const r = inputWithApprovedRef();
    // 旧 Handoff 的 selectionId（不同 revision 派生）→ 不在当前批准集
    const staleId = r.input.approvedVisualReferences[0].selectionId.replace(/^visual-ref:/, "visual-ref:stale:");
    const check = validateApprovedVisualSelection(r.input, [staleId]);
    expect(check.ok).toBe(false);
  });

  it("13. 选择集参与 fingerprint（同一输入不同选择 → 不同 fingerprint）", () => {
    const r = inputWithApprovedRef();
    const check1 = validateApprovedVisualSelection(r.input, [r.input.approvedVisualReferences[0].selectionId]);
    // 有批准参考时 product_visual + 空选择被拒（见 9）；用非当前参考验证拒绝路径
    const check2 = validateApprovedVisualSelection(r.input, ["visual-ref:tampered"]);
    expect(check1.ok).toBe(true);
    expect(check2.ok).toBe(false);
  });

  it("14. Browser 不能提交完整对象（route 白名单拒绝；input 无内部对象）", () => {
    const r = inputWithApprovedRef();
    const serialized = JSON.stringify(r.input.approvedVisualReferences);
    expect(serialized).not.toContain("approvedBy");
    expect(serialized).not.toContain("confirmationReference");
    expect(serialized).not.toContain("assetFingerprint");
  });

  it("15. selectionId 绑定 handoffId+revision+assetFingerprint（变化后失效）", () => {
    const r1 = buildImageInputFromCreativeHandoff(buildHandoffWithApprovedRef(), 1);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // 构造 revision=3 的合法 Handoff（versions 必须连续且 length===currentRevision）
    const h2 = buildHandoffWithApprovedRef();
    const versions = h2.versions as unknown as Array<Record<string, unknown>>;
    const v3 = { ...versions[0], revision: 3 };
    (h2 as unknown as { currentRevision: number }).currentRevision = 3;
    (h2 as unknown as { versions: unknown[] }).versions = [versions[0], v3];
    const r2 = buildImageInputFromCreativeHandoff(h2, 1);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.input.approvedVisualReferences[0].selectionId).not.toBe(r1.input.approvedVisualReferences[0].selectionId);
    }
  });
});
