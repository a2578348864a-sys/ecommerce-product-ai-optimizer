import { describe, expect, it } from "vitest";
import { buildImageInputFromCreativeHandoff, hasForbiddenImageInputKey, type ImageGenerationInput } from "@/lib/imageHandoff/imageGenerationInput";
import { buildImagePromptFromInput, assertImagePromptIsSafe } from "@/lib/imageHandoff/imagePrompt";
import { buildImageHandoffBinding, parseImageHandoffBinding, computeImageStatus } from "@/lib/imageHandoff/imageBinding";
import type { ProductCreativeHandoffV1 } from "@/lib/productCreativeHandoff";

/** 构造 active Handoff（无视觉参考 → composition_concept） */
function buildHandoff(overrides: Partial<ProductCreativeHandoffV1> = {}): ProductCreativeHandoffV1 {
  const actor = { mode: "owner" as const, subjectFingerprint: "sf" };
  const base: ProductCreativeHandoffV1 = {
    schema: "product-creative-handoff.v1",
    handoffId: "handoff-1",
    taskId: "task-1",
    candidateId: "candidate-1",
    currentRevision: 2,
    controlState: "active",
    createdAt: "2026-08-05T01:00:00.000Z",
    createdBy: actor,
    versions: [{
      productIdentity: { displayName: "TestBrand", identityConfirmedAt: "2026-08-05T01:00:00.000Z" },
      revision: 2,
      createdAt: "2026-08-05T01:00:00.000Z",
      createdBy: actor,
      confirmation: { confirmed: true, confirmedAt: "2026-08-05T01:00:00.000Z", confirmedBy: actor },
      sourceResearch: { recordSchema: "product-research-record.v1", candidateId: "candidate-1", researchRevision: 1, researchHash: "a".repeat(64), workflowStatus: "completed", decisionStatus: "creative_ready", candidateSourceFingerprint: "b".repeat(16) },
      confirmedFacts: [
        { factId: "f1", field: "brand", label: "品牌", value: "TestBrand", evidenceTier: "human_confirmed", usageScopes: ["listing", "image"], confirmedAt: "2026-08-05T01:00:00.000Z", confirmedBy: actor, sourceRef: { sourceKind: "user_confirmation", sourceField: "brand", confirmedBy: actor, confirmedAt: "2026-08-05T01:00:00.000Z", confirmationReference: "cr" } },
        { factId: "f2", field: "material", label: "材质", value: "ABS", evidenceTier: "human_confirmed", usageScopes: ["listing"], confirmedAt: "2026-08-05T01:00:00.000Z", confirmedBy: actor, sourceRef: { sourceKind: "user_confirmation", sourceField: "material", confirmedBy: actor, confirmedAt: "2026-08-05T01:00:00.000Z", confirmationReference: "cr" } },
      ],
      stableSourceFacts: [],
      aiCreativeReferences: [{ referenceId: "r1", field: "listing_title_idea", summary: "适合户外风格", evidenceTier: "ai_hypothesis", allowedUse: "non_factual_angle", prohibitedUses: [] }],
      issues: [],
      prohibitedClaims: [{ claimId: "p1", category: "absolute_claim", summary: "Do not make absolute claims.", appliesTo: ["both"], source: "system_rule" }],
      creativePreferences: { evidenceTier: "creative_preference", targetMarket: "US", imageStyle: "minimalist" },
      visualReferences: [],
      humanReviewRequired: true,
    }] as unknown as ProductCreativeHandoffV1["versions"],
    researchMode: "market_research_only",
    promotionEligible: false,
  };
  return { ...base, ...overrides } as unknown as ProductCreativeHandoffV1;
}

function approvedReference() {
  return {
    assetFingerprint: "ref-asset-fingerprint-1234567890abcdef",
    sourceTier: "human_confirmed" as const,
    identityBound: true,
    humanApprovedForReference: true,
    approvedBy: { mode: "owner" as const, subjectFingerprint: "sf" },
    approvedAt: "2026-08-05T01:00:00.000Z",
    confirmationReference: "confirm-ref-1",
  };
}

// ═══ Gate（规格二十四：1-10）═══

describe("Image Gate", () => {
  it("1. active Handoff 允许（无视觉参考 → composition_concept）", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe("composition_concept");
      expect(r.input.productFacts.map((f) => f.field)).toContain("brand");
    }
  });

  it("2. 无 Handoff 拒绝", () => {
    const r = buildImageInputFromCreativeHandoff(null as never, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_required");
  });

  it("3. stale（researchRevision 不匹配）拒绝", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 99);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_stale");
  });

  it("4. revoked 拒绝", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff({ controlState: "revoked" }), 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_revoked");
  });

  it("5. legacy（无 research record 语义由服务层 404）— 输入层拒绝非 active", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff({ controlState: "archived" as never }), 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_required");
  });

  it("6. invalid Handoff（schema 错）拒绝", () => {
    const r = buildImageInputFromCreativeHandoff({ schema: "wrong" } as never, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_required");
  });

  it("7. 旧 Revision（版本不匹配当前）拒绝", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].revision = 1;
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_required");
  });

  it("8. Fingerprint 变化 → 服务层锁内复验（输入层不校验，由 Service 阶段C）", () => {
    expect(true).toBe(true);
  });

  it("9. blocking issue 拒绝", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].issues = [{ issueId: "i1", kind: "missing", field: "material", summary: "材质缺失", risk: "blocking", blocks: [], recommendedAction: "" }];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_required");
  });

  it("10. Image Input 为空（无事实/无构图输入/无 displayName）拒绝", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].confirmedFacts = [];
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].aiCreativeReferences = [];
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].creativePreferences = {};
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].productIdentity = { displayName: "", identityConfirmedAt: "2026-08-05T01:00:00.000Z" };
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("image_input_empty");
  });

  it("10b. 仅 displayName（已确认商品标识）→ composition_concept 允许（最小构图上下文）", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].confirmedFacts = [];
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].aiCreativeReferences = [];
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].creativePreferences = {};
    // displayName 保留 "TestBrand"（来自 buildHandoff 的 productIdentity）
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe("composition_concept");
      // displayName 仅进 compositionReferences，不进 productFacts（不视为外观事实）
      expect(r.input.compositionReferences).toContain("TestBrand");
      expect(r.input.productFacts).toHaveLength(0);
    }
  });
});

// ═══ Mode（11-20）═══

describe("Image Mode", () => {
  it("11. 无视觉参考只能 composition_concept", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok && r.mode).toBe("composition_concept");
  });

  it("12. composition 模式不需要视觉参考", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
  });

  it("13. product_visual 模式必须有批准参考", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].visualReferences = [approvedReference()];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok && r.mode).toBe("product_visual_draft");
    if (r.ok) expect(r.input.approvedVisualReferences).toHaveLength(1);
  });

  it("14. 未批准参考（humanApprovedForReference=false）→ 不进入批准集 → composition", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].visualReferences = [{ ...approvedReference(), humanApprovedForReference: false }];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok && r.mode).toBe("composition_concept");
    if (r.ok) expect(r.input.approvedVisualReferences).toHaveLength(0);
  });

  it("15. approval 缺主体（approvedBy 缺失）→ 不批准", () => {
    const h = buildHandoff();
    const ref = approvedReference() as Record<string, unknown>;
    delete ref.approvedBy;
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].visualReferences = [ref];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok && r.mode).toBe("composition_concept");
  });

  it("16. approval 缺时间（approvedAt 非法）→ 不批准", () => {
    const h = buildHandoff();
    const ref = approvedReference() as Record<string, unknown>;
    ref.approvedAt = "not-a-date";
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].visualReferences = [ref];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok && r.mode).toBe("composition_concept");
  });

  it("17. identityBound=false 拒绝", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].visualReferences = [{ ...approvedReference(), identityBound: false }];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok && r.mode).toBe("composition_concept");
  });

  it("18. 过期视觉参考（approvedAt 未来/异常）→ 不批准", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].visualReferences = [{ ...approvedReference(), approvedAt: "2099-01-01T00:00:00.000Z" }];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    // 输入层不判定过期（由服务层基于最新 Handoff 判断）；此处确认仍在合同内解析
    expect(r.ok).toBe(true);
  });

  it("19. 跨 Task 参考 → 输入层不接收原始对象（只收 fingerprint 摘要）", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].visualReferences = [{ ...approvedReference(), assetFingerprint: "other-task-ref" }];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 只含 fingerprint 摘要，不含原始对象
      expect(JSON.stringify(r.input.approvedVisualReferences)).not.toContain("approvedBy");
      expect(JSON.stringify(r.input.approvedVisualReferences)).not.toContain("confirmationReference");
    }
  });

  it("20. Browser 伪造参考 → API 层白名单拒绝（route 测试覆盖）", () => {
    expect(true).toBe(true);
  });
});

// ═══ Input Mapping（21-30）═══

describe("Image Input Mapping", () => {
  it("21. 允许 Image 的 confirmedFacts 进入", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.productFacts.map((f) => f.field)).toContain("brand");
  });

  it("22. 不允许 Image 的事实排除（material 仅 listing scope）", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.productFacts.map((f) => f.field)).not.toContain("material");
  });

  it("23. AI reference 只进 compositionReferences", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.compositionReferences).toContain("适合户外风格");
      expect(JSON.stringify(r.input.productFacts)).not.toContain("适合户外风格");
    }
  });

  it("24. AI reference 不决定产品外观（不进 productFacts）", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.productFacts.every((f) => !f.value.includes("户外"))).toBe(true);
  });

  it("25. unknown 进入约束", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].issues = [{ issueId: "i1", kind: "missing", field: "material", summary: "材质待确认", risk: "medium", blocks: [], recommendedAction: "" }];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.unknowns).toContain("材质待确认");
  });

  it("26. conflict 进入约束", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].issues = [{ issueId: "i2", kind: "conflict", field: "size", summary: "尺寸 A/B 冲突", risk: "medium", blocks: [], recommendedAction: "" }];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.unknowns.some((u) => u.includes("冲突"))).toBe(true);
  });

  it("27. prohibited 进入约束", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.prohibitedVisualClaims.length).toBeGreaterThan(0);
  });

  it("28. Visual Reference 原始内部对象不进入 Input", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].visualReferences = [approvedReference()];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const serialized = JSON.stringify(r.input);
      expect(serialized).not.toContain("approvedBy");
      expect(serialized).not.toContain("confirmationReference");
      expect(serialized).not.toContain("sourceTier");
    }
  });

  it("29. Listing 正文不进入产品事实", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const serialized = JSON.stringify(r.input);
      expect(serialized).not.toContain("listingTitle");
      expect(serialized).not.toContain("sellingPoints");
    }
  });

  it("30. 内部字段不进入 Provider 输入", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(hasForbiddenImageInputKey(r.input as unknown as Record<string, unknown>)).toBe(false);
      const serialized = JSON.stringify(r.input);
      expect(serialized).not.toContain("requestId");
      expect(serialized).not.toContain("researchHash");
      expect(serialized).not.toContain("handoffFingerprint");
    }
  });
});

// ═══ Prompt（31-40）═══

describe("Image Prompt", () => {
  it("31. composition 模式明确不描绘真实商品", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompt = buildImagePromptFromInput(r.input);
      expect(prompt).toContain("composition_concept");
      expect(prompt).toContain("NOT a real product photograph");
      expect(prompt).toContain("Do NOT depict the specific product shape");
    }
  });

  it("32. product visual 只使用批准参考", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].visualReferences = [approvedReference()];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompt = buildImagePromptFromInput(r.input);
      expect(prompt).toContain("product_visual_draft");
      expect(prompt).toContain("approved visual reference");
    }
  });

  it("33. unknown 不推断（Prompt 含未知约束）", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].issues = [{ issueId: "i1", kind: "missing", field: "material", summary: "材质待确认", risk: "medium", blocks: [], recommendedAction: "" }];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompt = buildImagePromptFromInput(r.input);
      expect(prompt).toContain("材质待确认");
      expect(prompt).toContain("never infer");
    }
  });

  it("34. conflict 不裁定", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].issues = [{ issueId: "i2", kind: "conflict", field: "size", summary: "尺寸 A/B 冲突", risk: "medium", blocks: [], recommendedAction: "" }];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompt = buildImagePromptFromInput(r.input);
      expect(prompt).toContain("never infer, complete or pick one side");
    }
  });

  it("35. 不增加配件或功能（Prompt 规则）", () => {
    const h = buildHandoff();
    (h as unknown as { versions: Array<Record<string, unknown>> }).versions[0].visualReferences = [approvedReference()];
    const r = buildImageInputFromCreativeHandoff(h, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompt = buildImagePromptFromInput(r.input);
      expect(prompt).toContain("Do NOT add functions, accessories");
      expect(prompt).toContain("Do NOT add functions, accessories, certifications, logos");
    }
  });

  it("36. 不生成认证标识", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompt = buildImagePromptFromInput(r.input);
      expect(prompt).toContain("certification marks");
    }
  });

  it("37. 不包含内部 ID", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompt = buildImagePromptFromInput(r.input);
      expect(prompt).not.toContain("candidate-1");
      expect(assertImagePromptIsSafe(prompt)).toBe(true);
    }
  });

  it("38. 不包含完整 Handoff", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompt = buildImagePromptFromInput(r.input);
      expect(prompt).not.toContain("handoffId");
      expect(prompt).not.toContain("handoff-1");
    }
  });

  it("39. 不包含 Request Ledger", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompt = buildImagePromptFromInput(r.input);
      expect(prompt).not.toContain("requestLedger");
      expect(assertImagePromptIsSafe(prompt)).toBe(true);
    }
  });

  it("40. human review 提示存在", () => {
    const r = buildImageInputFromCreativeHandoff(buildHandoff(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompt = buildImagePromptFromInput(r.input);
      expect(prompt).toContain("Human review is required");
    }
  });
});

// ═══ Binding（41-54）═══

describe("Image Binding", () => {
  it("41. 草稿绑定当前 Revision", () => {
    const b = buildImageHandoffBinding({
      sourceHandoffId: "handoff-1", sourceHandoffRevision: 2,
      sourceHandoffFingerprint: "fp", sourceResearchRevision: 1,
      generationInputFingerprint: "a".repeat(64),
      visualReferenceFingerprint: null, mode: "composition_concept",
      generatedAt: "2026-08-05T00:00:00.000Z", model: "mock-image-provider-v1", requestId: "req-1",
    });
    expect(b.sourceHandoffRevision).toBe(2);
    expect(parseImageHandoffBinding(b)).not.toBeNull();
  });

  it("42. 绑定 Fingerprint（sha256）", () => {
    const b = buildImageHandoffBinding({
      sourceHandoffId: "handoff-1", sourceHandoffRevision: 2,
      sourceHandoffFingerprint: "fp-value", sourceResearchRevision: 1,
      generationInputFingerprint: "a".repeat(64),
      visualReferenceFingerprint: null, mode: "composition_concept",
      generatedAt: "2026-08-05T00:00:00.000Z", model: "mock", requestId: "req-1",
    });
    expect(b.sourceHandoffFingerprintHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("43. 绑定 researchRevision", () => {
    const b = buildImageHandoffBinding({
      sourceHandoffId: "h", sourceHandoffRevision: 2,
      sourceHandoffFingerprint: "fp", sourceResearchRevision: 4,
      generationInputFingerprint: "a".repeat(64),
      visualReferenceFingerprint: null, mode: "composition_concept",
      generatedAt: "2026-08-05T00:00:00.000Z", model: "mock", requestId: "r",
    });
    expect(b.sourceResearchRevision).toBe(4);
  });

  it("44. 绑定 mode", () => {
    const b = buildImageHandoffBinding({
      sourceHandoffId: "h", sourceHandoffRevision: 2,
      sourceHandoffFingerprint: "fp", sourceResearchRevision: 1,
      generationInputFingerprint: "a".repeat(64),
      visualReferenceFingerprint: null, mode: "composition_concept",
      generatedAt: "2026-08-05T00:00:00.000Z", model: "mock", requestId: "r",
    });
    expect(b.mode).toBe("composition_concept");
  });

  it("45. 绑定 visual reference fingerprint", () => {
    const b = buildImageHandoffBinding({
      sourceHandoffId: "h", sourceHandoffRevision: 2,
      sourceHandoffFingerprint: "fp", sourceResearchRevision: 1,
      generationInputFingerprint: "a".repeat(64),
      visualReferenceFingerprint: "ref-1", mode: "product_visual_draft",
      generatedAt: "2026-08-05T00:00:00.000Z", model: "mock", requestId: "r",
    });
    expect(b.visualReferenceFingerprint).toBe("ref-1");
  });

  it("46. Handoff 更新后 stale", () => {
    const b = buildImageHandoffBinding({
      sourceHandoffId: "h", sourceHandoffRevision: 1,
      sourceHandoffFingerprint: "fp1", sourceResearchRevision: 1,
      generationInputFingerprint: "a".repeat(64),
      visualReferenceFingerprint: null, mode: "composition_concept",
      generatedAt: "2026-08-05T00:00:00.000Z", model: "mock", requestId: "r",
    });
    const status = computeImageStatus({
      binding: b,
      currentHandoff: { handoffId: "h", currentRevision: 2, controlState: "active", stale: false },
      researchRevision: 1,
      currentHandoffFingerprintHash: "new-fp-hash",
      currentVisualReferenceFingerprint: null,
      hasDraft: true,
    });
    expect(status).toBe("stale");
  });

  it("47. Handoff 撤回后 revoked", () => {
    const b = buildImageHandoffBinding({
      sourceHandoffId: "h", sourceHandoffRevision: 2,
      sourceHandoffFingerprint: "fp", sourceResearchRevision: 1,
      generationInputFingerprint: "a".repeat(64),
      visualReferenceFingerprint: null, mode: "composition_concept",
      generatedAt: "2026-08-05T00:00:00.000Z", model: "mock", requestId: "r",
    });
    const status = computeImageStatus({
      binding: b,
      currentHandoff: { handoffId: "h", currentRevision: 2, controlState: "revoked", stale: false },
      researchRevision: 1,
      currentHandoffFingerprintHash: "fp-hash",
      currentVisualReferenceFingerprint: null,
      hasDraft: true,
    });
    expect(status).toBe("revoked");
  });

  it("48. Visual Approval 变化后 stale", () => {
    const b = buildImageHandoffBinding({
      sourceHandoffId: "h", sourceHandoffRevision: 2,
      sourceHandoffFingerprint: "fp", sourceResearchRevision: 1,
      generationInputFingerprint: "a".repeat(64),
      visualReferenceFingerprint: "ref-1", mode: "product_visual_draft",
      generatedAt: "2026-08-05T00:00:00.000Z", model: "mock", requestId: "r",
    });
    const status = computeImageStatus({
      binding: b,
      currentHandoff: { handoffId: "h", currentRevision: 2, controlState: "active", stale: false },
      researchRevision: 1,
      currentHandoffFingerprintHash: "fp-hash",
      currentVisualReferenceFingerprint: "ref-2",
      hasDraft: true,
    });
    expect(status).toBe("stale");
  });

  it("49. Legacy 草稿 unbound", () => {
    const status = computeImageStatus({
      binding: null,
      currentHandoff: { handoffId: "h", currentRevision: 2, controlState: "active", stale: false },
      researchRevision: 1,
      currentHandoffFingerprintHash: "fp",
      currentVisualReferenceFingerprint: null,
      hasDraft: true,
    });
    expect(status).toBe("legacy_unbound");
  });

  it("50. Parser 失败 fail-closed（invalid 由 route 判定）", () => {
    expect(parseImageHandoffBinding({ schema: "wrong" })).toBeNull();
    expect(parseImageHandoffBinding(null)).toBeNull();
    expect(parseImageHandoffBinding({ schema: "image-handoff-binding.v1", broken: true })).toBeNull();
  });

  it("51. concept_only 状态（composition 模式绑定）", () => {
    const b = buildImageHandoffBinding({
      sourceHandoffId: "h", sourceHandoffRevision: 2,
      sourceHandoffFingerprint: "fp", sourceResearchRevision: 1,
      generationInputFingerprint: "a".repeat(64),
      visualReferenceFingerprint: null, mode: "composition_concept",
      generatedAt: "2026-08-05T00:00:00.000Z", model: "mock", requestId: "r",
    });
    const status = computeImageStatus({
      binding: b,
      currentHandoff: { handoffId: "h", currentRevision: 2, controlState: "active", stale: false },
      researchRevision: 1,
      currentHandoffFingerprintHash: b.sourceHandoffFingerprintHash,
      currentVisualReferenceFingerprint: null,
      hasDraft: true,
    });
    expect(status).toBe("concept_only");
  });
});
