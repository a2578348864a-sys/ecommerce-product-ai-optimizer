import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildListingInputFromCreativeHandoff } from "@/lib/listingHandoff/listingGenerationInput";
import { buildSafeFallbackListingDraft } from "@/lib/listingHandoff/safeListingFallback";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";

const serviceSource = readFileSync(resolve(process.cwd(), "lib/listingHandoff/listingGenerationService.ts"), "utf8");
const routeSource = readFileSync(resolve(process.cwd(), "app/api/tasks/[id]/listing-handoff/route.ts"), "utf8");
const uiSource = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");

// ── fixtures ────────────────────────────────────────────

const now = "2026-08-05T00:00:00.000Z";

function buildHandoff(facts: Array<{ field: string; label: string; value: string }> = [
  { field: "brand", label: "品牌", value: "TestBrand" },
  { field: "category", label: "类目", value: "Home & Kitchen > Office" },
  { field: "price_usd", label: "价格", value: "12.99" },
  { field: "rating", label: "评分", value: "4.6" },
]) {
  return {
    schema: "product-creative-handoff.v1",
    handoffId: "11111111-1111-4111-8111-111111111111",
    taskId: "task-test",
    candidateId: "candidate-test",
    currentRevision: 1,
    controlState: "active" as const,
    createdAt: now,
    createdBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" },
    researchMode: "market_research_only",
    promotionEligible: false,
    versions: [{
      revision: 1,
      createdAt: now,
      createdBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" },
      sourceResearch: { recordSchema: "product-research-record.v1", candidateId: "candidate-test", researchRevision: 1, researchHash: "a".repeat(64), workflowStatus: "completed", decisionStatus: "creative_ready", candidateSourceFingerprint: "b".repeat(64) },
      productIdentity: { displayName: "Test", identityConfirmedAt: now },
      confirmedFacts: facts.map((f, i) => ({
        factId: `00000000-0000-4000-8000-00000000000${i + 1}`,
        field: f.field, label: f.label, value: f.value,
        evidenceTier: "human_confirmed", usageScopes: ["listing", "internal"],
        sourceRef: { sourceKind: "user_confirmation", sourceField: f.field, confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" }, confirmedAt: now, confirmationReference: `confirm:${f.field}` },
        confirmedAt: now, confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" },
      })),
      stableSourceFacts: [],
      aiCreativeReferences: [],
      issues: [],
      prohibitedClaims: [{ claimId: "00000000-0000-4000-8000-000000000005", category: "absolute_claim", summary: "不得使用绝对化表述", appliesTo: ["both"], source: "system_rule" }],
      creativePreferences: { evidenceTier: "creative_preference", tone: "professional" },
      visualReferences: [],
      humanReviewRequired: true,
      confirmation: { confirmed: true, confirmedAt: now, confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" } },
      handoffFingerprint: "d".repeat(64),
    }],
  };
}

function buildGenerationInput(facts = buildHandoff().versions[0].confirmedFacts) {
  const r = buildListingInputFromCreativeHandoff(buildHandoff(facts) as never, 1);
  if (!r.ok) throw new Error(`fixture failed: ${r.code}`);
  return r.input;
}

/** 构造一份必被 Claim Evidence 拒绝的 AI 输出（含无证据材质/性能声明） */
function buildUnsupportedAiDraft() {
  return {
    source: "real_ai_draft",
    version: 1,
    generatedAt: now,
    model: "real-ai-provider",
    humanReviewRequired: true,
    titles: ["Premium Aluminum Phone Mount"],
    bullets: ["采用航空级铝合金材质", "超强吸力性能提升300%"],
    description: "A premium mount.",
    keywords: ["phone mount", "aluminum"],
    sellingPoints: ["高端材质"],
    riskNotes: ["需人工复核"],
    reviewChecklist: ["人工核对"],
  };
}

// ── 测试 ───────────────────────────────────────────────

describe("safeListingFallback（安全降级草稿）", () => {
  it("1. 保守草稿通过 ai_listing_pack v1 Schema", () => {
    const input = buildGenerationInput();
    const result = buildSafeFallbackListingDraft({ generationInput: input, generatedAt: now, model: "real-ai-provider" });
    expect(result).not.toBeNull();
    const schema = validateAiListingPackDraft(result!.draft);
    expect(schema.ok).toBe(true);
  });

  it("2. 保守草稿通过 Claim Evidence（零放宽）", () => {
    const input = buildGenerationInput();
    const result = buildSafeFallbackListingDraft({ generationInput: input, generatedAt: now, model: "real-ai-provider" })!;
    const schema = validateAiListingPackDraft(result.draft);
    expect(schema.ok).toBe(true);
    if (!schema.ok) return;
    const filtered = filterListingClaims(schema.data, { prohibitedClaims: input.prohibitedClaims, customClaimLabel: "Handoff prohibited claim" });
    const evidence = verifyListingClaims(filtered.cleaned, input);
    expect(listingClaimsHaveEvidence(evidence)).toBe(true);
  });

  it("3. Bullet 只表达事实（字段: 值），无等级/性能/认证/效果声明", () => {
    const input = buildGenerationInput();
    const result = buildSafeFallbackListingDraft({ generationInput: input, generatedAt: now, model: "real-ai-provider" })!;
    const draft = result.draft;
    const bullets = draft.bullets as string[];
    expect(bullets.length).toBeGreaterThanOrEqual(1);
    for (const b of bullets) {
      // 每条必须包含 字段: 值 形态（来自 confirmedFacts）
      const hasFact = input.productFacts.some((f) => b.includes(f.label) && b.includes(f.value));
      expect(hasFact).toBe(true);
      // 不得含无证据修饰词
      expect(b).not.toMatch(/性能|认证|材质等级|超强|顶级|最优|100%|300%|航空级|医用级/);
    }
  });

  it("4. safeFallbackApplied=true 明确标记（不冒充 AI 原始输出）", () => {
    const input = buildGenerationInput();
    const result = buildSafeFallbackListingDraft({ generationInput: input, generatedAt: now, model: "real-ai-provider" });
    expect(result?.safeFallbackApplied).toBe(true);
  });

  it("5. confirmedFacts 为空 → 返回 null（调用方抛稳定 422，不伪造内容）", () => {
    // 输入门禁已在 buildListingInputFromCreativeHandoff 拦截空事实（listing_input_empty）；
    // 服务层降级函数对空 productFacts 也必须返回 null（双重防线）
    const input = buildGenerationInput();
    const emptyInput = { ...input, productFacts: [] };
    const result = buildSafeFallbackListingDraft({ generationInput: emptyInput, generatedAt: now, model: "real-ai-provider" });
    expect(result).toBeNull();
  });

  it("6. 同一输入两次构造 → 完全一致（确定性）", () => {
    const input = buildGenerationInput();
    const a = buildSafeFallbackListingDraft({ generationInput: input, generatedAt: now, model: "real-ai-provider" })!;
    const b = buildSafeFallbackListingDraft({ generationInput: input, generatedAt: now, model: "real-ai-provider" })!;
    expect(JSON.stringify(a.draft)).toBe(JSON.stringify(b.draft));
  });
});

describe("listingGenerationService 安全降级接入", () => {
  it("7. 服务代码含安全降级分支（AI 被拒 → applyStructuredFallback）", () => {
    expect(serviceSource).toContain("applyStructuredFallback");
    expect(serviceSource).toContain("fallbackApplied");
    expect(serviceSource).toContain("safe_fact_draft");
    // 合法 AI 输出路径保留（原样保存）
    expect(serviceSource).toContain("ai_optimized_listing");
  });

  it("8. Provider 失败不降级（throw real_listing_provider_failed 保持）", () => {
    // realListingProvider 在 Provider 失败时抛错（不返回空 draft）
    const providerSource = readFileSync(resolve(process.cwd(), "lib/listingHandoff/realListingProvider.ts"), "utf8");
    expect(providerSource).toContain("real_listing_provider_failed");
    // 服务层对 AI 输出不合规走 fallback（Provider 服务故障与输出不合规区分）
    expect(serviceSource).toContain("ai_schema_invalid");
    expect(serviceSource).toContain("provider_failed");
  });

  it("9. Route 返回 safeFallbackApplied（前端提示依据）", () => {
    expect(routeSource).toContain("safeFallbackApplied: result.safeFallbackApplied === true");
  });

  it("10. UI 仅一条保守草稿提示，不含内部/Claim 详情", () => {
    expect(uiSource).toContain("AI 优化未通过质量检查，已保留安全基础草稿。");
    // 不显示内部错误、Claim 详情、模型字段或调试信息
    expect(uiSource).not.toContain("unclassified_factual_claim");
    expect(uiSource).not.toContain("reasonCode");
    expect(uiSource).not.toContain("safeFallbackApplied ? ");
  });
});
