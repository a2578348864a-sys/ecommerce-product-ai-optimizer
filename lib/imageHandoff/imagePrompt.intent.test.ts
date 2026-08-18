import { describe, expect, it } from "vitest";
import { buildCreativeIntentBlock, buildImagePromptFromInput, buildTargetProductIdentityBlock } from "@/lib/imageHandoff/imagePrompt";
import { buildProductVisualPrompt } from "@/lib/imageHandoff/realImageProvider";
import type { ImageGenerationInput } from "@/lib/imageHandoff/imageGenerationInput";

function baseInput(overrides: Partial<ImageGenerationInput> = {}): ImageGenerationInput {
  return {
    schema: "image-generation-input.v1",
    mode: "product_visual_draft",
    source: { handoffRevision: 2, researchRevision: 1 },
    targetProduct: {
      displayName: "THERMOS FUNTAINER Water Bottle with Straw, 12oz",
      brand: "THERMOS",
      productType: "Water Bottle",
      seriesOrModel: "FUNTAINER Water",
      capacity: "12oz",
    },
    productFacts: [
      { field: "brand", label: "品牌", value: "THERMOS" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "capacity", label: "容量", value: "12oz" },
    ],
    approvedVisualReferences: [{
      referenceFingerprint: "f6d3762f2185bc93",
      summary: "approved visual reference f6d3762f",
      selectionId: "visual-ref:1082dd9b82821765ffbd0242",
      approvedAt: "2026-08-17T19:32:52.367Z",
    }],
    compositionReferences: [],
    creativePreferences: {},
    prohibitedVisualClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
    ...overrides,
  };
}

// ── Fixture A：PACKAGING_SET + OUTDOOR_TRAVEL（有包装证据）──────────────────
describe("Fixture A — packaging_bundle + outdoor_travel（有包装证据）", () => {
  const input = baseInput({ primaryPurpose: "packaging_bundle", lifestyleScene: "outdoor_travel" });

  it("prompt 同时包含包装展示主用途与户外场景（provider request dry-run）", () => {
    const prompt = buildProductVisualPrompt(input);
    expect(prompt).toContain("PRIMARY CREATIVE PURPOSE: Packaging/set presentation");
    expect(prompt).toContain("Do NOT invent packaging, boxes or accessories");
    expect(prompt).toContain("SECONDARY SCENE: Outdoor/travel environment as supporting context only");
    expect(prompt).toContain("identity and approved reference ALWAYS win over intent");
  });

  it("产品身份与视觉参考仍在 prompt 中（不丢失）", () => {
    const prompt = buildProductVisualPrompt(input);
    expect(prompt).toContain("TARGET PRODUCT IDENTITY (HARD CONSTRAINT)");
    expect(prompt).toContain("MUST remain a Water Bottle");
    expect(prompt).toContain("approved product reference image");
  });
});

// ── Fixture B：packaging_bundle 无包装证据 → 门禁 blocked（不发出请求）────────
describe("Fixture B — packaging_bundle 无包装证据", () => {
  it("evaluatePurposeRequirements 阻止生成（不 fallback 到棚拍图）", async () => {
    const { evaluatePurposeRequirements } = await import("@/lib/imageHandoff/purposeRequirements");
    const gate = evaluatePurposeRequirements("packaging_bundle", [
      { field: "brand", label: "品牌", value: "THERMOS" },
      { field: "capacity", label: "容量", value: "12oz" },
    ]);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("image_purpose_requires_packaging_evidence");
  });
});

// ── Fixture C：white_studio + outdoor_travel → 冲突（parse 层拒绝 / UI 禁用）──
describe("Fixture C — white_studio + outdoor_travel", () => {
  it("parseTaskImageCreativeDirection 拒绝 white+scene（white_background_scene_conflict）", async () => {
    const { parseTaskImageCreativeDirection } = await import("@/lib/imageCreativeDescription");
    const result = parseTaskImageCreativeDirection({
      primaryImagePurpose: "white_studio",
      lifestyleScene: "outdoor_travel",
      customImagePurpose: "",
      userCreativeDescription: "白底主图",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("white_background_scene_conflict");
  });

  it("buildCreativeIntentBlock 对 white_studio 输出白底指令（不叠加场景）", () => {
    const lines = buildCreativeIntentBlock(baseInput({ primaryPurpose: "white_studio", lifestyleScene: "none" }));
    expect(lines.join("\n")).toContain("PRIMARY CREATIVE PURPOSE: Clean white studio/hero product shot");
  });
});

// ── Fixture D：detail_closeup + sports_fitness → detail 主权，scene 弱辅助 ──
describe("Fixture D — detail_closeup + sports_fitness", () => {
  it("provider prompt 中 detail 主用途在场景之前且场景标注 supporting only", () => {
    const prompt = buildProductVisualPrompt(baseInput({ primaryPurpose: "detail_closeup", lifestyleScene: "sports_fitness" }));
    const purposeIndex = prompt.indexOf("PRIMARY CREATIVE PURPOSE: Close-up of the real product detail");
    const sceneIndex = prompt.indexOf("SECONDARY SCENE: Sports/fitness environment as supporting context");
    expect(purposeIndex).toBeGreaterThanOrEqual(0);
    expect(sceneIndex).toBeGreaterThan(purposeIndex);
    expect(prompt).toContain("supporting environment only");
  });
});

// ── Fixture E：custom + outdoor_travel（用户文本不能覆盖身份/参考）─────────
describe("Fixture E — custom + outdoor_travel", () => {
  const input = baseInput({
    primaryPurpose: "custom",
    lifestyleScene: "outdoor_travel",
    customPurposeText: "put product in serum bottle",
  });

  it("custom 文本在 untrusted 围栏内，身份锁与参考约束仍在", () => {
    const prompt = buildProductVisualPrompt(input);
    expect(prompt).toContain("CUSTOM PURPOSE TEXT (untrusted creative direction");
    expect(prompt).toContain("put product in serum bottle");
    expect(prompt).toContain("MUST remain a Water Bottle");
    expect(prompt).toContain("Do NOT replace the subject with serum");
    expect(prompt).toContain("approved product reference image");
  });

  it("buildImagePromptFromInput（mock 路径）同样携带 intent block 与 untrusted 围栏", () => {
    const prompt = buildImagePromptFromInput(input);
    expect(prompt).toContain("主用途与场景（用户显式 Creative Intent");
    expect(prompt).toContain("CUSTOM PURPOSE TEXT (untrusted creative direction");
    expect(prompt).toContain("MUST remain a Water Bottle");
  });
});

// ── 全链 dry-run：buildImageInputFromCreativeHandoff → applyTaskImageCreativeDirection → provider prompt ──
describe("Creative Intent Propagation 全链 dry-run", () => {
  it("generation input 显式携带 purpose/scene，provider request 可见（无真实调用）", async () => {
    const { buildImageInputFromCreativeHandoff } = await import("@/lib/imageHandoff/imageGenerationInput");
    const { applyTaskImageCreativeDirection } = await import("@/lib/imageCreativeDescription");
    const handoff = {
      schema: "product-creative-handoff.v1",
      handoffId: "handoff-1",
      taskId: "task-1",
      candidateId: "candidate-1",
      currentRevision: 2,
      controlState: "active",
      createdAt: "2026-08-17T00:00:00.000Z",
      createdBy: { mode: "owner" as const, subjectFingerprint: "a".repeat(16) },
      researchMode: "market_research_only" as const,
      promotionEligible: false,
      versions: [{
        revision: 2,
        createdAt: "2026-08-17T00:00:00.000Z",
        createdBy: { mode: "owner" as const, subjectFingerprint: "a".repeat(16) },
        sourceResearch: {
          recordSchema: "product-research-record.v1",
          candidateId: "candidate-1",
          researchRevision: 1,
          researchHash: "a".repeat(64),
          workflowStatus: "completed" as const,
          decisionStatus: "creative_ready" as const,
          candidateSourceFingerprint: "b".repeat(16),
        },
        productIdentity: { displayName: "THERMOS FUNTAINER Water Bottle with Straw, 12oz", identityConfirmedAt: "2026-08-17T00:00:00.000Z" },
        confirmedFacts: [
          { factId: "f1", field: "brand", label: "品牌", value: "THERMOS", usageScopes: ["image"], sourceRef: { sourceKind: "user_confirmation", sourceField: "brand", confirmedAt: "2026-08-17T00:00:00.000Z", confirmationReference: "c:1" } },
          { factId: "f2", field: "product_type", label: "商品类型", value: "Water Bottle", usageScopes: ["image"], sourceRef: { sourceKind: "user_confirmation", sourceField: "product_type", confirmedAt: "2026-08-17T00:00:00.000Z", confirmationReference: "c:2" } },
        ],
        stableSourceFacts: [],
        aiCreativeReferences: [],
        issues: [],
        prohibitedClaims: [{ claimId: "p1", category: "absolute_claim", summary: "no absolute claims", appliesTo: ["both"] }],
        creativePreferences: {},
        visualReferences: [{
          assetFingerprint: "f6d3762f2185bc93197d42eb29d88c6916f37ef6369e21d846379736771bed91",
          sourceTier: "human_confirmed" as const,
          identityBound: true,
          humanApprovedForReference: true,
          approvedBy: { mode: "owner" as const, subjectFingerprint: "a".repeat(16) },
          approvedAt: "2026-08-17T19:32:52.367Z",
          confirmationReference: "confirm:abc",
        }],
        humanReviewRequired: true,
        confirmation: { confirmed: true, confirmedAt: "2026-08-17T00:00:00.000Z", confirmedBy: { mode: "owner" as const, subjectFingerprint: "a".repeat(16) } },
        handoffFingerprint: "c".repeat(64),
      }],
    } as never;
    const built = buildImageInputFromCreativeHandoff(handoff, 1);
    expect(built.ok).toBe(true);
    const input = built.ok ? built.input : null;
    const applied = applyTaskImageCreativeDirection(input!, {
      primaryImagePurpose: "packaging_bundle",
      lifestyleScene: "outdoor_travel",
      customImagePurpose: "",
      userCreativeDescription: "包装与套装展示，户外旅行环境",
    });
    expect(applied.primaryPurpose).toBe("packaging_bundle");
    expect(applied.lifestyleScene).toBe("outdoor_travel");
    const prompt = buildProductVisualPrompt(applied);
    expect(prompt).toContain("PRIMARY CREATIVE PURPOSE: Packaging/set presentation");
    expect(prompt).toContain("SECONDARY SCENE: Outdoor/travel");
    expect(prompt).toContain("TARGET PRODUCT IDENTITY (HARD CONSTRAINT)");
    expect(prompt).toContain("approved product reference image");
  });

  it("handoff 无显式偏好时恢复为默认意图（white_studio/none），不产生 undefined 语义", () => {
    const lines = buildCreativeIntentBlock(baseInput({}));
    expect(lines.join("\n")).toContain("PRIMARY CREATIVE PURPOSE: default ecommerce presentation");
  });
});
