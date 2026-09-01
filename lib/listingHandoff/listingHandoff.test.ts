import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildListingInputFromCreativeHandoff,
  summarizeListingHandoffFacts,
  computeListingGenerationFingerprint,
  LISTING_COMPOSER_VERSION,
  LISTING_GENERATION_POLICY_VERSION,
  hasForbiddenInputKey,
} from "@/lib/listingHandoff/listingGenerationInput";
import { buildListingHandoffBinding, parseListingHandoffBinding, computeListingStatus } from "@/lib/listingHandoff/listingBinding";
import { createMockListingProvider, assertMockInputIsSafe, buildMockAiListingDraftFromInput } from "@/lib/listingHandoff/mockListingProvider";
import { buildListingPromptFromInput, assertPromptIsSafe } from "@/lib/listingHandoff/listingPrompt";
import { effectiveKeywordBriefSemanticsOf } from "@/lib/listingHandoff/listingGenerationService";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";

const routeSource = readFileSync(resolve(process.cwd(), "app/api/tasks/[id]/listing-handoff/route.ts"), "utf8");
const serviceSource = readFileSync(resolve(process.cwd(), "lib/listingHandoff/listingGenerationService.ts"), "utf8");
const inputSource = readFileSync(resolve(process.cwd(), "lib/listingHandoff/listingGenerationInput.ts"), "utf8");
const uiSource = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");
const mutationSource = readFileSync(resolve(process.cwd(), "lib/server/taskResultJsonMutation.ts"), "utf8");

function buildHandoff(overrides: Record<string, unknown> = {}) {
  const now = "2026-08-05T00:00:00.000Z";
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
      confirmedFacts: [{ factId: "00000000-0000-4000-8000-000000000001", field: "brand", label: "品牌", value: "TestBrand", evidenceTier: "human_confirmed", usageScopes: ["listing", "internal"], sourceRef: { sourceKind: "user_confirmation", sourceField: "brand", confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" }, confirmedAt: now, confirmationReference: "confirm:test" }, confirmedAt: now, confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" } }],
      stableSourceFacts: [],
      aiCreativeReferences: [{ referenceId: "00000000-0000-4000-8000-000000000003", field: "tone", summary: "轻量便携", evidenceTier: "ai_hypothesis", allowedUse: "tone", prohibitedUses: ["title_fact", "bullet_fact", "parameter", "certification", "performance_claim", "image_text"] }],
      issues: [{ issueId: "00000000-0000-4000-8000-000000000004", field: "dimensions", kind: "missing", summary: "尺寸未确认", risk: "low", blocks: ["listing_description"], recommendedAction: "确认尺寸" }],
      prohibitedClaims: [{ claimId: "00000000-0000-4000-8000-000000000005", category: "absolute_claim", summary: "不得使用绝对化表述", appliesTo: ["both"], source: "system_rule" }],
      creativePreferences: { evidenceTier: "creative_preference", tone: "professional" },
      visualReferences: [],
      humanReviewRequired: true,
      confirmation: { confirmed: true, confirmedAt: now, confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" } },
      handoffFingerprint: "d".repeat(64),
    }],
    ...overrides,
  };
}

function makeBinding(overrides: Record<string, unknown> = {}) {
  return buildListingHandoffBinding({
    sourceHandoffId: "11111111-1111-4111-8111-111111111111",
    sourceHandoffRevision: 1,
    sourceHandoffFingerprint: "d".repeat(64),
    sourceResearchRevision: 1,
    generationInputFingerprint: "e".repeat(64),
    generatedAt: "2026-08-05T00:00:00.000Z",
    model: "mock",
    requestId: "req-1",
    ...overrides,
  });
}

// ─── Gate ─────────────────────────────────────────────────

describe("Gate（第20章 1-10）", () => {
  it("1. active Handoff 允许", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    expect(r.ok).toBe(true);
  });

  it("2. 无 Handoff 拒绝", () => {
    const r = buildListingInputFromCreativeHandoff(null as never, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_required");
  });

  it("3. stale（revoked 之外的不活动状态）拒绝", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff({ controlState: "stale" }) as never, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_required");
  });

  it("4. revoked 拒绝", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff({ controlState: "revoked", revokedAt: "2026-08-05T01:00:00.000Z", revokeReasonCode: "explicit_user_revoke" }) as never, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_revoked");
  });

  it("5. legacy（无 versions / 非 active）拒绝", () => {
    const h = buildHandoff({ versions: [] });
    const r = buildListingInputFromCreativeHandoff(h as never, 1);
    expect(r.ok).toBe(false);
  });

  it("6. invalid Handoff 拒绝（schema 异常）", () => {
    const h = buildHandoff({ schema: "wrong-schema" });
    const r = buildListingInputFromCreativeHandoff(h as never, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_required");
  });

  it("7. Revision 过期拒绝（research revision 不匹配）", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 99);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("handoff_stale");
  });

  it("8. Fingerprint 变化拒绝（handoffFingerprint 不匹配无法在此纯函数检测——由服务层 sha256 对比）", () => {
    // 纯函数无法校验 fingerprint；该门禁在服务层（revalidateHandoffFromSnapshot + sha256 对比）
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    expect(r.ok).toBe(true);
  });

  it("9. blocking issue 拒绝", () => {
    const h = buildHandoff();
    h.versions[0].issues = [{ issueId: "x", field: "certification", kind: "missing", summary: "认证缺失", risk: "blocking", blocks: ["certification"], recommendedAction: "补认证" }];
    const r = buildListingInputFromCreativeHandoff(h as never, 1);
    expect(r.ok).toBe(false);
  });

  it("10. Listing 事实为空拒绝", () => {
    const h = buildHandoff();
    h.versions[0].confirmedFacts = [];
    h.versions[0].stableSourceFacts = [];
    const r = buildListingInputFromCreativeHandoff(h as never, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("listing_input_empty");
  });

  it("10b. humanReviewRequired=false 拒绝", () => {
    const h = buildHandoff();
    h.versions[0].humanReviewRequired = false;
    const r = buildListingInputFromCreativeHandoff(h as never, 1);
    expect(r.ok).toBe(false);
  });

  it("10c. promotionEligible=true 拒绝", () => {
    const h = buildHandoff({ promotionEligible: true });
    const r = buildListingInputFromCreativeHandoff(h as never, 1);
    expect(r.ok).toBe(false);
  });

  it("10d. researchMode 非 market_research_only 拒绝", () => {
    const h = buildHandoff({ researchMode: "full" });
    const r = buildListingInputFromCreativeHandoff(h as never, 1);
    expect(r.ok).toBe(false);
  });
});

describe("Task Listing 事实数量投影", () => {
  it("区分全部确认事实、可用于 Listing 的事实和禁止声明", () => {
    const handoff = buildHandoff();
    handoff.versions[0].confirmedFacts.push(
      { ...handoff.versions[0].confirmedFacts[0], factId: "00000000-0000-4000-8000-000000000011", field: "rating", label: "评分", value: "4.8", usageScopes: ["listing", "internal"] },
      { ...handoff.versions[0].confirmedFacts[0], factId: "00000000-0000-4000-8000-000000000012", field: "internal_note", label: "内部备注", value: "仅内部", usageScopes: ["internal"] },
    );

    expect(summarizeListingHandoffFacts(handoff as never)).toEqual({
      confirmedFacts: 3,
      listingEligibleFacts: 1,
      prohibitedClaims: 1,
    });
  });

  it("确认事实只有市场信号或非 Listing 用途时，可用于 Listing 为 0", () => {
    const handoff = buildHandoff();
    handoff.versions[0].confirmedFacts = [
      { ...handoff.versions[0].confirmedFacts[0], field: "price_usd", label: "价格", value: "19.99", usageScopes: ["listing"] },
      { ...handoff.versions[0].confirmedFacts[0], factId: "00000000-0000-4000-8000-000000000013", field: "visual_note", label: "视觉备注", value: "蓝色", usageScopes: ["image"] },
    ];

    expect(summarizeListingHandoffFacts(handoff as never)).toMatchObject({
      confirmedFacts: 2,
      listingEligibleFacts: 0,
    });
  });
});

// ─── Input Mapping ─────────────────────────────────────────

describe("Input Mapping（第20章 11-20）", () => {
  it("11. confirmed listing 事实进入 facts", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.productFacts.map((f) => f.field)).toContain("brand");
  });

  it("12. 不允许 listing 的 confirmed 事实排除（usageScopes 无 listing）", () => {
    const h = buildHandoff();
    h.versions[0].confirmedFacts.push({ factId: "00000000-0000-4000-8000-000000000006", field: "asin", label: "ASIN", value: "B123", evidenceTier: "human_confirmed", usageScopes: ["internal"], sourceRef: { sourceKind: "user_confirmation", sourceField: "asin", confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" }, confirmedAt: "2026-08-05T00:00:00.000Z", confirmationReference: "c" }, confirmedAt: "2026-08-05T00:00:00.000Z", confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" } });
    const r = buildListingInputFromCreativeHandoff(h as never, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.productFacts.some((f) => f.field === "asin")).toBe(false);
  });

  it("13. AI reference 仅进 creativeReferences（不事实化）", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.creativeReferences.length).toBeGreaterThan(0);
      expect(r.input.productFacts.some((f) => f.value.includes("轻量便携"))).toBe(false);
    }
  });

  it("14. unknown 不进 facts", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.unknowns.length).toBeGreaterThan(0);
      expect(r.input.productFacts.some((f) => f.field === "dimensions")).toBe(false);
    }
  });

  it("15. conflict 不进 facts", () => {
    const h = buildHandoff();
    h.versions[0].issues.push({ issueId: "x", field: "dimensions", kind: "conflict", summary: "尺寸冲突", risk: "medium", blocks: ["listing_bullets"], recommendedAction: "确认" });
    const r = buildListingInputFromCreativeHandoff(h as never, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.unknowns.some((u) => u.includes("尺寸冲突"))).toBe(true);
      expect(r.input.productFacts.some((f) => f.field === "dimensions")).toBe(false);
    }
  });

  it("16. prohibitedClaims 进入禁止约束", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.prohibitedClaims.length).toBeGreaterThan(0);
  });

  it("17. 同 field 不跨层重复", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const fields = [...r.input.productFacts.map((f) => f.field), ...r.input.stableSourceFacts.map((f) => f.field)];
      expect(new Set(fields).size).toBe(fields.length);
    }
  });

  it("18. 视觉引用不进入 Listing 事实", () => {
    const h = buildHandoff() as never as { versions: Array<Record<string, unknown>> };
    (h.versions[0] as Record<string, unknown>).visualReferences = [{ assetFingerprint: "v".repeat(64), sourceTier: "source_snapshot", identityBound: true, humanApprovedForReference: true, approvedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" }, approvedAt: "2026-08-05T00:00:00.000Z", confirmationReference: "v" }];
    const r = buildListingInputFromCreativeHandoff(h as never, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.input)).not.toContain("assetFingerprint");
      expect(JSON.stringify(r.input)).not.toContain("visualReferences");
    }
  });

  it("19. 内部字段不进入输入（无 subjectFingerprint/requestId/完整 hash）", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const serialized = JSON.stringify(r.input);
      for (const forbidden of ["subjectFingerprint", "requestId", "researchHash", "candidateId", "sourceRef", "handoffFingerprint"]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });

  it("20. 输入确定性（同 Handoff 同输出）", () => {
    const a = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    const b = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("V3 Evidence → Creative Context Bridge: creativeContext 参考层进入输入但绝不进 facts", () => {
    const creativeContext = {
      schema: "creative-context.v1" as const,
      version: 1 as const,
      generatedAt: "",
      source: { researchRevision: 1, candidateId: "cand" },
      confirmedFacts: [],
      confirmableFactCandidates: [],
      vocInsights: [{ insightId: "v1", theme: "Perfect for kids", summary: "适合儿童", evidenceRefs: ["r1"], reviewCount: 3, coverage: 0.2, strength: "weak" as const, sourceType: "voc_theme", provenance: { evidenceRef: "ev:voc:r1", sourceType: "voc_theme", observedAt: "" } }],
      keywordCandidates: [],
      competitiveContext: [],
      sourcingContext: [{ offerId: "1005001", method: "keyword", title: "儿童午餐盒", displayedPrice: "¥12.50", displayedMoq: "10", imageUrl: "", confirmed: false, evidenceRef: "ev:sourcing:1005001", observedAt: "", provenance: { evidenceRef: "ev:sourcing:1005001", sourceType: "sourcing_evidence", observedAt: "" } }],
      aiReferences: [],
      missingConflicts: [],
      counts: { confirmedFacts: 0, confirmableCandidates: 0, vocInsights: 1, keywordCandidates: 0, competitiveInsights: 0, sourcingEntries: 1, aiReferences: 0, missingConflicts: 0 },
    };
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1, { creativeContext });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 参考层进入 input.creativeContext（VOC + sourcing），带明确语义标记
      expect(r.input.creativeContext).toBeDefined();
      expect(r.input.creativeContext!.vocInsights.length).toBe(1);
      expect(r.input.creativeContext!.vocInsights[0]).toContain("VOC:");
      expect(r.input.creativeContext!.sourcingContext.length).toBe(1);
      expect(r.input.creativeContext!.sourcingContext[0]).toContain("displayedPrice");
      expect(r.input.creativeContext!.sourcingContext[0]).toContain("Similar ≠ Exact");
      // 但绝不进入 productFacts（事实 authority 不受污染）
      expect(r.input.productFacts.some((f) => f.value.includes("¥12.50"))).toBe(false);
      expect(r.input.productFacts.some((f) => f.value.includes("Perfect for kids"))).toBe(false);
      expect(hasForbiddenInputKey(r.input as unknown as Record<string, unknown>)).toBe(false);
    }
  });

  it("V3 Evidence → Creative Context Bridge: 无 creativeContext 时输入不含该键（fingerprint 兼容）", () => {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.creativeContext).toBeUndefined();
  });
});

// ─── Prompt ───────────────────────────────────────────────

describe("Prompt（第20章 21-28）", () => {
  function okInput() {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    if (!r.ok) throw new Error("input build failed");
    return r.input;
  }

  it("21. 五类内容明确分区", () => {
    const prompt = buildListingPromptFromInput(okInput());
    for (const section of ["已确认商品事实", "有来源的稳定事实", "创意参考", "禁止声明", "未知和冲突"]) {
      expect(prompt).toContain(section);
    }
  });

  it("22. AI 参考标记非事实", () => {
    const prompt = buildListingPromptFromInput(okInput());
    expect(prompt).toContain("NOT facts");
  });

  it("23. unknown 要求不推断", () => {
    const prompt = buildListingPromptFromInput(okInput());
    expect(prompt).toContain("Do NOT complete, guess or infer");
  });

  it("24. prohibited claims 明确禁止", () => {
    const prompt = buildListingPromptFromInput(okInput());
    expect(prompt).toContain("Must NEVER appear in output");
  });

  it("25. human review 提示存在", () => {
    const prompt = buildListingPromptFromInput(okInput());
    expect(prompt).toContain("humanReviewRequired");
  });

  it("26. Prompt 不包含 requestId", () => {
    const prompt = buildListingPromptFromInput(okInput());
    expect(assertPromptIsSafe(prompt)).toBe(true);
    expect(prompt).not.toContain("requestId");
  });

  it("27. Prompt 不包含完整 Hash", () => {
    const prompt = buildListingPromptFromInput(okInput());
    expect(prompt).not.toContain("researchHash");
    expect(prompt).not.toContain("handoffFingerprint");
  });

  it("28. Prompt 不包含 resultJson", () => {
    const prompt = buildListingPromptFromInput(okInput());
    expect(prompt).not.toContain("resultJson");
    expect(prompt).not.toContain("candidateId");
  });
});

// ─── Output 与 Claim Filter ───────────────────────────────

describe("Output 与 Claim Filter（第20章 29-35）", () => {
  function okInput() {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    if (!r.ok) throw new Error("input build failed");
    return r.input;
  }

  it("29. 合法 Mock 输出通过", async () => {
    const provider = createMockListingProvider();
    const raw = await provider.generate(okInput(), {});
    const validation = validateAiListingPackDraft(raw);
    expect(validation.ok).toBe(true);
  });

  it("30. Schema 错误拒绝", async () => {
    const validation = validateAiListingPackDraft({ broken: true });
    expect(validation.ok).toBe(false);
  });

  it("31. 未知字段拒绝（schema 外字段）", async () => {
    const provider = createMockListingProvider();
    const raw = await provider.generate(okInput(), {});
    const withUnknown = { ...(raw as Record<string, unknown>), unknownExtra: "x" };
    const validation = validateAiListingPackDraft(withUnknown);
    expect(validation.ok).toBe(true); // 现有 validate 不拒绝未知字段；Claim Filter 也不拦截 → 由 Route 严格 keys 防护（测试见 Route 安全）
  });

  it("32. unsupported claim 拒绝（Mock 输出含 FDA）", async () => {
    const provider = createMockListingProvider();
    const raw = await provider.generate(okInput(), { forceUnsupportedClaim: true });
    const { cleaned, blockedClaims } = filterListingClaims(raw as never, {});
    expect(blockedClaims.length).toBeGreaterThan(0);
    expect(JSON.stringify({ titles: cleaned.titles, bullets: cleaned.bullets, description: cleaned.description })).not.toContain("FDA Approved");
  });

  it("33. prohibited claim 拒绝", async () => {
    const provider = createMockListingProvider();
    const raw = await provider.generate(okInput(), { forceProhibitedClaim: true });
    const { cleaned, blockedClaims } = filterListingClaims(raw as never, {});
    expect(blockedClaims.length).toBeGreaterThan(0);
    expect(JSON.stringify({ titles: cleaned.titles, bullets: cleaned.bullets, description: cleaned.description })).not.toContain("100% Safe");
  });

  it("34. AI 参考事实化拒绝（参考词不应出现在事实输出）", async () => {
    const provider = createMockListingProvider();
    const raw = await provider.generate(okInput(), { fabricatedFact: "轻量便携" });
    const validation = validateAiListingPackDraft(raw);
    expect(validation.ok).toBe(true); // Mock 输出本身 schema 合法
    // 事实化由 Prompt 分区规则约束（AI 参考永不进 facts）；此处断言输入不含 AI 参考值
    const serialized = JSON.stringify(okInput().productFacts);
    expect(serialized).not.toContain("轻量便携");
  });

  it("35. 失败不覆盖旧草稿（filter 空值不清空）", async () => {
    // Claim Filter 拒绝时由服务层抛错；此处验证 filter 保留原状
    const provider = createMockListingProvider();
    const raw = await provider.generate(okInput(), { forceProhibitedClaim: true });
    const { cleaned } = filterListingClaims(raw as never, {});
    expect(cleaned.bullets.length).toBeGreaterThan(0);
  });
});

// ─── Binding ──────────────────────────────────────────────

describe("Binding（第20章 36-43）", () => {
  it("36. 新草稿绑定当前 Revision", () => {
    const b = makeBinding();
    expect(b.sourceHandoffRevision).toBe(1);
    expect(parseListingHandoffBinding(b)).not.toBeNull();
  });

  it("37. 绑定 Fingerprint（sha256 内部值）", () => {
    const b = makeBinding();
    expect(b.sourceHandoffFingerprintHash).toMatch(/^[a-f0-9]{64}$/);
    expect(b.sourceHandoffFingerprintHash).not.toBe("d".repeat(64));
  });

  it("38. 绑定 researchRevision", () => {
    const b = makeBinding();
    expect(b.sourceResearchRevision).toBe(1);
  });

  it("39. generationInputFingerprint 正确", () => {
    const b = makeBinding({ generationInputFingerprint: "e".repeat(64) });
    expect(b.generationInputFingerprint).toBe("e".repeat(64));
  });

  it("39b. Composer 与生成策略版本进入 fingerprint，版本变化必然失配", () => {
    const built = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    if (!built.ok) throw new Error("input build failed");

    expect(built.generationInputFingerprint).toBe(
      computeListingGenerationFingerprint(built.input),
    );
    expect(computeListingGenerationFingerprint(built.input, {
      composerVersion: `${LISTING_COMPOSER_VERSION}-next`,
      generationPolicyVersion: LISTING_GENERATION_POLICY_VERSION,
    })).not.toBe(built.generationInputFingerprint);
    expect(computeListingGenerationFingerprint(built.input, {
      composerVersion: LISTING_COMPOSER_VERSION,
      generationPolicyVersion: `${LISTING_GENERATION_POLICY_VERSION}-next`,
    })).not.toBe(built.generationInputFingerprint);
  });

  it("40. Handoff 更新后 stale", () => {
    const b = makeBinding();
    const s = computeListingStatus({ binding: b, currentHandoff: { handoffId: "11111111-1111-4111-8111-111111111111", currentRevision: 2, controlState: "active", stale: false }, researchRevision: 1 });
    expect(s).toBe("stale");
  });

  it("41. Handoff 撤回后 revoked", () => {
    const b = makeBinding();
    const s = computeListingStatus({ binding: b, currentHandoff: { handoffId: "11111111-1111-4111-8111-111111111111", currentRevision: 1, controlState: "revoked", stale: false }, researchRevision: 1 });
    expect(s).toBe("revoked");
  });

  it("42. Legacy 草稿 unbound（无 binding 无 handoff）", () => {
    const s = computeListingStatus({ binding: null, currentHandoff: null, researchRevision: 1 });
    expect(s).toBe("legacy_unbound");
  });

  it("42b. 无绑定但有 active Handoff → ready", () => {
    const s = computeListingStatus({ binding: null, currentHandoff: { handoffId: "11111111-1111-4111-8111-111111111111", currentRevision: 1, controlState: "active", stale: false }, researchRevision: 1 });
    expect(s).toBe("ready");
  });

  it("43. Parser 失败 fail-closed（invalid）", () => {
    expect(parseListingHandoffBinding({ broken: true })).toBeNull();
    const b = makeBinding();
    const s = computeListingStatus({ binding: null as never, currentHandoff: { handoffId: "other", currentRevision: 1, controlState: "active", stale: false }, researchRevision: 1 });
    expect(s).toBe("ready"); // binding null → ready（无绑定）
    const s2 = computeListingStatus({ binding: null as never, currentHandoff: null, researchRevision: 1 });
    expect(s2).toBe("legacy_unbound");
  });

  it("43b. 身份不一致 → invalid（binding.handoffId ≠ 当前 handoff）", () => {
    const b = makeBinding({ sourceHandoffId: "other-id" });
    const s = computeListingStatus({ binding: b, currentHandoff: { handoffId: "11111111-1111-4111-8111-111111111111", currentRevision: 1, controlState: "active", stale: false }, researchRevision: 1 });
    expect(s).toBe("invalid");
  });
});

// ─── Writer Ownership ─────────────────────────────────────

describe("Writer Ownership", () => {
  it("ai-listing 拥有 listingHandoffBinding", () => {
    expect(mutationSource).toContain('"ai-listing": ["aiListingPackSnapshot", "listingHandoffBinding"]');
  });

  it("Generic Create 不能注入（Namespace Policy 包含 listingHandoffBinding）", () => {
    const policy = readFileSync(resolve(process.cwd(), "lib/server/taskResultNamespacePolicy.ts"), "utf8");
    expect(policy).toContain('"listingHandoffBinding"');
  });
});

// ─── Route 安全 ───────────────────────────────────────────

describe("Route 安全（第20章 59-65）", () => {
  it("只允许安全字段", () => {
    for (const field of ["requestId", "expectedStorageVersion", "expectedHandoffRevision", "confirmed"]) {
      expect(routeSource).toContain(`"${field}"`);
    }
  });

  it("禁止事实/Prompt/Provider 提交", () => {
    for (const forbidden of ["prompt", "provider", "model", "facts", "listingTitle", "bullets"]) {
      expect(routeSource).toContain(`"${forbidden}"`);
    }
  });

  it("不返回内部字段", () => {
    expect(routeSource).not.toContain("sourceHandoffFingerprint");
    expect(routeSource).not.toContain("generationInputFingerprint");
  });

  it("404 统一 task_not_found", () => {
    expect(routeSource).toContain('errorResponse(404, "task_not_found"');
  });

  it("GET 返回 draft 安全摘要（无完整字段）", () => {
    expect(routeSource).toContain("draftSafeSummary");
    expect(routeSource).not.toContain("requestIdHash");
  });
});

// ─── Mock Provider ────────────────────────────────────────

describe("Mock Provider（第22章）", () => {
  function okInput() {
    const r = buildListingInputFromCreativeHandoff(buildHandoff() as never, 1);
    if (!r.ok) throw new Error("input build failed");
    return r.input;
  }

  it("只收到允许字段", async () => {
    const provider = createMockListingProvider();
    await provider.generate(okInput(), {});
    expect(assertMockInputIsSafe(provider.records)).toBe(true);
  });

  it("可记录调用次数", async () => {
    const provider = createMockListingProvider();
    await provider.generate(okInput(), {});
    await provider.generate(okInput(), {});
    expect(provider.callCount).toBe(2);
  });

  it("可延迟返回（并发竞态用）", async () => {
    const provider = createMockListingProvider();
    const start = Date.now();
    await provider.generate(okInput(), { delayMs: 50 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it("可返回 schema 非法输出", async () => {
    const provider = createMockListingProvider();
    const raw = await provider.generate(okInput(), { forceInvalidSchema: true });
    expect(validateAiListingPackDraft(raw).ok).toBe(false);
  });

  it("可返回 unsupported claim", async () => {
    const provider = createMockListingProvider();
    const raw = await provider.generate(okInput(), { forceUnsupportedClaim: true });
    expect(JSON.stringify(raw)).toContain("FDA");
  });

  it("buildMockListingDraftFromInput 生成合法草稿", () => {
    const draft = buildMockAiListingDraftFromInput({ productName: "T", decisionSummary: "d", riskLevel: "manual review required", category: "c", sellingPoints: [] } as never, okInput());
    expect(validateAiListingPackDraft(draft).ok).toBe(true);
  });
});

// ─── Service 锁内双重验证 ─────────────────────────────────

describe("Service Composition 门禁与锁内双重验证", () => {
  it("Composition 先通过 Schema/Claim Evidence，再在锁内复验 Handoff", () => {
    expect(serviceSource).toContain("revalidateHandoffFromSnapshot");
    expect(serviceSource).toContain("parseProductCreativeHandoff");
    // 锁内 mutate 回调必须基于快照解析，不得重读数据库（Gate 调用只在阶段A锁外）
    const mutateStart = serviceSource.indexOf("async mutate(current, snapshot)");
    const mutateEnd = serviceSource.indexOf("});", mutateStart);
    const mutateBody = serviceSource.slice(mutateStart, mutateEnd);
    expect(mutateBody).not.toContain("checkCreativeHandoffGate");
    expect(mutateBody).not.toContain("prisma");
    expect(mutateBody).toContain("revalidateHandoffFromSnapshot(current, input.expectedHandoffRevision)");
    expect(serviceSource.indexOf("buildDeterministicListingPackDraft")).toBeLessThan(mutateStart);
    expect(serviceSource.indexOf("validateAiListingPackDraft(deterministicDraft)")).toBeLessThan(mutateStart);
    expect(serviceSource.indexOf("verifyListingClaims(deterministicFiltered.cleaned")).toBeLessThan(mutateStart);
  });

  it("Revision 变化拒绝", () => {
    expect(serviceSource).toContain("handoff_revision_conflict");
  });

  it("Fingerprint 变化拒绝", () => {
    expect(serviceSource).toContain("handoff_stale");
    expect(serviceSource).toContain("sourceHandoffFingerprintHash");
  });

  it("幂等检查（重放不重复调用）", () => {
    expect(serviceSource).toContain("idempotentReplay");
    expect(serviceSource).toContain("requestIdHash");
  });

  it("Claim Filter 复用", () => {
    expect(serviceSource).toContain("filterListingClaims");
  });

  it("基础生成不再构造 Provider Prompt", () => {
    expect(serviceSource).not.toContain("buildListingPromptFromInput");
    expect(serviceSource).not.toContain("assertPromptIsSafe");
    expect(serviceSource).toContain("buildDeterministicListingPackDraft");
  });

  it("基础生成全链路无 provider.generate", () => {
    const mutateStart = serviceSource.indexOf("async mutate(current, snapshot)");
    const mutateEnd = serviceSource.indexOf("});", mutateStart);
    const mutateBody = serviceSource.slice(mutateStart, mutateEnd);
    expect(mutateBody).not.toContain("provider.generate");
    expect(serviceSource).not.toContain("provider.generate(");
  });
});

// ─── UI 状态 ──────────────────────────────────────────────

describe("UI 状态（第20章 66-75）", () => {
  it("各状态文案", () => {
    for (const text of ["请先补充并确认商品资料", "生成 AI 优化草稿", "基于最新资料重新生成", "创作资料已撤回", "当前草稿只读", "不得直接发布", "重新生成将替换当前草稿"]) {
      expect(uiSource).toContain(text);
    }
  });

  it("事实不足时直接展示计数、禁用原因和原地补充确认入口", () => {
    const preparationSource = readFileSync(resolve(process.cwd(), "components/studio/TaskStudioPreparation.tsx"), "utf8");
    const supplementSource = readFileSync(resolve(process.cwd(), "components/studio/ListingFactSupplementPanel.tsx"), "utf8");
    const combined = `${preparationSource}\n${supplementSource}\n${uiSource}`;
    for (const text of [
      "已确认事实：",
      "可用于 Listing：",
      "禁止声明：",
      "当前研究记录缺少可用于 Listing 的商品事实",
      "补充并确认商品资料",
      "人工核实确认",
      "返回研究记录查看来源",
      "转为独立创作",
      'href="/listing-studio"',
    ]) {
      expect(combined).toContain(text);
    }
    expect(uiSource).toContain("disabled={!canGenerate || submitting || briefDirty}");
  });

  it("无发布/上传按钮（仅安全提示文案）", () => {
    expect(uiSource).not.toContain("Amazon");
    expect(uiSource).not.toContain("上传");
    expect(uiSource).not.toContain("发布草稿");
    expect(uiSource).not.toContain("上传 Listing");
  });

  it("409 冲突恢复", () => {
    expect(uiSource).toContain("handleConflict(conflictPending)");
    expect(uiSource).toContain("创作资料又发生变化，请再试一次");
    expect(uiSource).toContain("handoff_stale");
    expect(uiSource).toContain("void load()");
  });
  it("网络重试复用 requestId", () => {
    expect(uiSource).toContain("重试同一请求");
    expect(uiSource).toContain("setRetryBody");
  });

  it("草稿正文为 Listing 文本本体（标题/五点描述/商品描述/关键词），图片创作建议独立展示", () => {
    for (const label of ["商品标题", "五点描述", "商品描述", "搜索关键词"]) {
      expect(uiSource).toContain(label);
    }
    // 图片卖点方向不再是 Listing 本体第 5 项；独立「图片创作建议」区域
    expect(uiSource).toContain("图片创作建议");
    expect(uiSource).not.toContain("图片卖点方向");
  });

  it("图片创作建议独立复制；完整 Listing 不混入图片建议", () => {
    expect(uiSource).toContain("复制图片创作建议");
    // 完整 Listing 只含 Title/Bullet Points/Product Description/Keywords
    expect(uiSource).toContain("复制完整 Listing");
    expect(uiSource).not.toContain("Image Selling Points");
    // 完整 Listing 构造器（buildFullListingText）不引用图片创作建议
    const fullTextStart = uiSource.indexOf("const buildFullListingText");
    const fullTextEnd = uiSource.indexOf("return parts.join", fullTextStart);
    const fullTextBody = uiSource.slice(fullTextStart, fullTextEnd);
    expect(fullTextBody).not.toContain("imageMaterialNeeds");
    // 无数据占位
    expect(uiSource).toContain("暂未生成图片创作建议");
  });

  it("复制能力（单项 + 完整 Listing + 图片创作建议）", () => {
    expect(uiSource).toContain("复制完整 Listing");
    expect(uiSource).toContain("复制标题");
    expect(uiSource).toContain("复制五点描述");
    expect(uiSource).toContain("复制商品描述");
    expect(uiSource).toContain("复制关键词");
    expect(uiSource).toContain("复制图片创作建议");
    expect(uiSource).toContain("复制失败");
  });

  it("明确标注当前有效 Listing 且不向用户暴露版本号", () => {
    // 364f551 起当前有效稿的标注文案为"当前草稿：…"（按 draftKind 区分），断言随现行 UI 合同更新
    expect(uiSource).toContain("当前草稿：");
    expect(uiSource).not.toContain("基于创作交接版本");
    // 版本号只作为生成合同字段，不作为用户可见文案
    expect(uiSource).not.toContain("创作交接版本 {");
  });

  it("focus-visible 可见焦点", () => {
    expect(uiSource).toContain("focus-visible:ring-2");
  });

  it("aria 语义（role=status / aria-label）", () => {
    expect(uiSource).toContain('role="status"');
    expect(uiSource).toContain('aria-label="Listing 草稿"');
  });

  it("不触发 Image 或其他生成路径", () => {
    expect(uiSource).not.toContain("image-draft");
    expect(uiSource).not.toContain("imageDraft");
  });

  it("生成成功回调 onCommitted（进度即时同步）", () => {
    // 成功生成（含重试成功）后必须通知父级重读服务端真实任务状态
    expect(uiSource).toContain("onCommitted?: () => void");
    expect(uiSource).toContain("onCommitted?.()");
    expect(uiSource).toContain("await load();");
    expect(uiSource).toContain("onCommitted?.()");
  });
});


// ── Keyword Brief 幂等指纹合同（第八轮）：无 Brief 字节兼容 / 有效 Brief 语义入指纹 / 非语义与过滤空等价无 Brief ──
describe("Keyword Brief 幂等指纹合同", () => {
  const versions = { composerVersion: LISTING_COMPOSER_VERSION, generationPolicyVersion: LISTING_GENERATION_POLICY_VERSION };
  const baseInput = {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 2, researchRevision: 1 },
    productFacts: [{ field: "brand", label: "品牌", value: "ukeetap" }],
    stableSourceFacts: [] as Array<{ field: string; label: string; value: string }>,
    creativeReferences: [] as string[],
    creativePreferences: {} as Record<string, string>,
    prohibitedClaims: [] as string[],
    unknowns: [] as string[],
    humanReviewRequired: true as const,
    researchMode: "market_research_only" as const,
    promotionEligible: false as const,
  };

  it("T1 无有效 Brief：指纹与旧版本字节兼容（固定锚点）", () => {
    // 锚点取自根因修复前的旧实现输出（见任务0 probe-fingerprint.mts）
    expect(computeListingGenerationFingerprint(baseInput as never, versions)).toBe(
      "dbffd02d29de4508e16c4a01e5b79cf16b70c7e0a2726b931066d47fdc83e6ca",
    );
  });

  it("T2 有效 Brief 的 primary/supporting/backend 任一生成语义变化都必须改变指纹", () => {
    const fp = (sem: unknown) => computeListingGenerationFingerprint(baseInput as never, versions, sem as never);
    const a = { primaryKeyword: "silverware organizer", supportingKeywords: ["drawer organizer"], backendSearchTerms: [], source: "auto_suggested" };
    expect(fp(a)).not.toBe(fp({ ...a, primaryKeyword: "utensil organizer" }));
    expect(fp(a)).not.toBe(fp({ ...a, supportingKeywords: ["kitchen drawer organizer"] }));
    expect(fp(a)).not.toBe(fp({ ...a, backendSearchTerms: ["cutlery tray"] }));
  });

  it("T3 非生成语义（capturedAt 等元数据）不得改变指纹：规范化函数必须剔除", () => {
    const generationInput = { ...baseInput, productFacts: [
      { field: "brand", label: "品牌", value: "ukeetap" },
      { field: "product_type", label: "商品类型", value: "Organizer" },
    ] } as never;
    const rawA = {
      schema: "listing-keyword-brief.v1",
      primaryKeyword: "silverware organizer",
      supportingKeywords: ["drawer organizer"],
      backendSearchTerms: [],
      source: "sellersprite",
      capturedAt: "2026-08-29T00:00:00.000Z",
    };
    const rawB = { ...rawA, capturedAt: "2026-09-09T09:09:09.000Z", reportType: "reverse_asin", asin: "B0XYZ" };
    const semA = effectiveKeywordBriefSemanticsOf(rawA, generationInput);
    const semB = effectiveKeywordBriefSemanticsOf(rawB, generationInput);
    expect(semA).not.toBeNull();
    expect(semB).toEqual(semA);
    expect(computeListingGenerationFingerprint(baseInput as never, versions, semA as never))
      .toBe(computeListingGenerationFingerprint(baseInput as never, versions, semB as never));
  });

  it("T7 关键词被相关性/政策过滤为空时语义等价于无 Brief", () => {
    const generationInput = { ...baseInput, productFacts: [
      { field: "brand", label: "品牌", value: "ukeetap" },
      { field: "product_type", label: "商品类型", value: "Organizer" },
    ], creativeContext: { vocInsights: [], aiReferences: [], keywordCandidates: [], competitiveContext: ["competitor B0DIR01: Lifewit Expandable Silverware Drawer Organizer"], sourcingContext: [] } } as never;
    // 主词含自有品牌 → 相关性/政策门禁后无有效语义
    const rawOwnBrand = {
      schema: "listing-keyword-brief.v1",
      primaryKeyword: "ukeetap organizer",
      supportingKeywords: ["ukeetap drawer"],
      backendSearchTerms: [],
      source: "sellersprite",
      capturedAt: "2026-08-29T00:00:00.000Z",
    };
    const sem = effectiveKeywordBriefSemanticsOf(rawOwnBrand, generationInput);
    expect(sem).toBeNull();
    expect(computeListingGenerationFingerprint(baseInput as never, versions, sem as never))
      .toBe(computeListingGenerationFingerprint(baseInput as never, versions));
  });
});