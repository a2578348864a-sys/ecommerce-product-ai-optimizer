import { describe, expect, it } from "vitest";
import {
  buildProductCreativeHandoffProjectionEvidence,
  ProjectionEvidenceAdapterError,
  type ProjectionEvidenceInput,
} from "@/lib/productCreativeHandoffProjectionEvidence";
import {
  projectProductCreativeHandoffCandidate,
} from "@/lib/productCreativeHandoffProjection";
import { createHash } from "node:crypto";

const NOW = "2026-08-05T00:00:00.000Z";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function buildContext(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "candidate-fix3",
    productName: "Test Product",
    sourceType: "seller_sprite_market_research",
    sourceLabel: "SellerSprite",
    marketplace: "US",
    asin: "B0123456789",
    productUrl: "https://example.com/p",
    title: "Test Product Title",
    brand: "TestBrand",
    category: "Kitchen",
    priceUsd: 19.99,
    rating: 4.5,
    reviewCount: 120,
    disclaimer: "third_party_estimate_point_in_time",
    reportType: "SellerSprite Search Results",
    query: "kitchen gadget",
    evidenceStatus: "ok",
    researchPriority: "high",
    promotionEligible: false,
    capturedAt: NOW,
    contextHash: "a".repeat(64),
    ...overrides,
  };
}

function buildRecord(candidateId = "candidate-fix3") {
  return {
    schema: "product-research-record.v1",
    revision: 1,
    researchHash: "b".repeat(64),
    candidateId,
    runId: "run-fix3",
    contextHash: "c".repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    latestDecision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      status: "creative_ready",
      reason: "ok",
      nextAction: null,
      researchHash: "b".repeat(64),
      decidedAt: NOW,
      actor: { mode: "owner", actorRef: "owner:v1" },
    },
    decisionEvents: [{
      decisionId: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      status: "creative_ready",
      reason: "ok",
      nextAction: null,
      researchHash: "b".repeat(64),
      decidedAt: NOW,
      actor: { mode: "owner", actorRef: "owner:v1" },
    }],
  };
}

function buildAgentOutput(overrides: Record<string, unknown> = {}) {
  return {
    version: "agent-output-v1",
    generatedAt: NOW,
    sourcingSnapshot: {
      supplierConclusion: "Supplier confirmed MOQ 500.",
      sourceSignals: ["Alibaba"],
      priceSignals: ["$15-20"],
      availabilitySignals: ["in stock"],
      assumptions: [],
      missingInfo: ["certification"],
      confidence: "medium",
    },
    riskSnapshot: {
      riskLevel: "medium",
      riskFlags: ["IP concern: logo similarity"],
      complianceConcerns: [],
      ipConcerns: [],
      logisticsConcerns: [],
      safetyConcerns: [],
      riskReason: "Logo similarity risk",
      needsManualReview: true,
    },
    summarySnapshot: {
      decision: "recommended",
      decisionReason: "Good margin",
      targetUser: "home cooks",
      sellingPoints: ["Lightweight", "Easy to clean"],
      concerns: [],
      confidence: "medium",
    },
    listingSnapshot: {
      titleDraft: "Lightweight Kitchen Gadget",
      bulletDrafts: ["Easy to clean", "Compact design"],
      keywordHints: ["kitchen", "gadget"],
      imageIdeas: ["product on white background"],
      complianceNotes: [],
      missingInputs: ["certification"],
    },
    nextActionSnapshot: {
      primaryAction: "prepare_listing",
      actionLabel: "准备 Listing",
      checklist: ["Verify certification"],
      blockingIssues: [],
      suggestedOwnerStep: "Verify certification",
    },
    humanReviewSnapshot: {
      required: true,
      reasons: ["IP concern"],
      reviewFocus: ["compliance"],
      defaultStatus: "needs_review",
    },
    fallbackUsed: false,
    warnings: [],
    ...overrides,
  };
}

function buildInput(overrides: Record<string, unknown> = {}): ProjectionEvidenceInput {
  const record = buildRecord();
  const context = buildContext();
  const agentOutput = buildAgentOutput();
  return {
    researchRecord: record,
    context,
    agentOutput,
    researchRevision: 1,
    researchHash: record.researchHash,
    ...overrides,
  } as ProjectionEvidenceInput;
}

describe("ProjectionEvidence Adapter 直接测试", () => {
  it("1. 合法输入生成 ProjectionEvidence", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    expect(evidence.length).toBeGreaterThan(0);
    const tiers = evidence.map((e) => e.evidenceTier);
    expect(tiers).toContain("source_snapshot");
    expect(tiers).toContain("ai_hypothesis");
  });

  it("2. 同输入输出完全确定", () => {
    const a = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const b = buildProductCreativeHandoffProjectionEvidence(buildInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("3. 不修改输入", () => {
    const input = buildInput();
    const before = JSON.stringify(input);
    buildProductCreativeHandoffProjectionEvidence(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("5. Candidate 身份不一致拒绝", () => {
    expect(() => buildProductCreativeHandoffProjectionEvidence(
      buildInput({ context: buildContext({ candidateId: "other-candidate" }) }),
    )).toThrow(ProjectionEvidenceAdapterError);
  });

  it("8. 跨商品来源拒绝（candidateId 不一致）", () => {
    const input = buildInput({ context: buildContext({ candidateId: "cross-entity" }) });
    expect(() => buildProductCreativeHandoffProjectionEvidence(input)).toThrowError(
      expect.objectContaining({ code: "candidate_identity_mismatch" }),
    );
  });

  it("9. 缺 capturedAt 进入 issue 或拒绝", () => {
    const bad = buildContext({ capturedAt: "not-a-date" });
    expect(() => buildProductCreativeHandoffProjectionEvidence(
      buildInput({ context: bad }),
    )).toThrowError(expect.objectContaining({ code: "invalid_captured_at" }));
  });

  it("11. 来源快照不进入 confirmedFacts（映射后确认）", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const humanConfirmed = evidence.filter((e) => e.evidenceTier === "human_confirmed");
    expect(humanConfirmed).toHaveLength(0); // 无人工确认生产点，不伪造
    const sourceSnapshots = evidence.filter((e) => e.evidenceTier === "source_snapshot");
    expect(sourceSnapshots.length).toBeGreaterThan(0);
  });

  it("13. 稳定来源产生 stable source 候选", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const source = evidence.filter((e) => e.evidenceTier === "source_snapshot");
    expect(source.length).toBeGreaterThanOrEqual(2); // asin + title + brand...
    for (const item of source) {
      if (item.evidenceTier !== "source_snapshot") continue;
      expect(item.fact.usageScopes).toEqual(["internal"]);
      expect(item.fact.sourceRef.sourceKind).toBe("candidate_snapshot");
    }
  });

  it("14. AI 总结只进入 aiCreativeReferences", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const ai = evidence.filter((e) => e.evidenceTier === "ai_hypothesis");
    expect(ai.length).toBeGreaterThan(0);
    // AI 内容不得进入 source_snapshot
    const source = evidence.filter((e) => e.evidenceTier === "source_snapshot");
    const sourceFields = source.map((s) => s.evidenceTier === "source_snapshot" ? s.fact.field : "");
    expect(sourceFields).not.toContain("selling_point_idea");
    expect(sourceFields).not.toContain("listing_title_idea");
  });

  it("15. Listing 草稿只进入 aiCreativeReferences", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const listingRefs = evidence.filter((e) =>
      e.evidenceTier === "ai_hypothesis"
      && (e.reference.field === "listing_title_idea" || e.reference.field === "bullet_idea" || e.reference.field === "image_idea"));
    expect(listingRefs.length).toBeGreaterThan(0);
    const source = evidence.filter((e) => e.evidenceTier === "source_snapshot");
    for (const s of source) {
      if (s.evidenceTier !== "source_snapshot") continue;
      expect(s.fact.field).not.toMatch(/^listing_|^bullet_|^image_idea/);
    }
  });

  it("16. unknown 保留（risk issue）", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const issues = evidence.filter((e) => e.evidenceTier === "unknown_or_conflict");
    expect(issues.length).toBeGreaterThan(0); // riskFlags → issue
  });

  it("17. conflict 保留（needsManualReview → conflict issue）", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const conflicts = evidence.filter((e) =>
      e.evidenceTier === "unknown_or_conflict" && e.issue.kind === "conflict");
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it("18. blocking issue 进入 evidence（risk=blocking），投影在无人工确认时失败", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(
      buildInput({
        agentOutput: buildAgentOutput({
          nextActionSnapshot: {
            primaryAction: "check_compliance",
            actionLabel: "先查合规风险",
            checklist: [],
            blockingIssues: ["IP blocking issue"],
            suggestedOwnerStep: "Resolve IP",
          },
        }),
      }),
    );
    const blockingIssues = evidence.filter((e) => e.evidenceTier === "unknown_or_conflict");
    expect(blockingIssues.length).toBeGreaterThan(0);
    // PR2-0 强制 confirmedFacts ≥1；无人工确认 → 投影失败 → Preview 捕获降级
    const record = buildRecord();
    expect(() => projectProductCreativeHandoffCandidate({
      sourceResearch: {
        recordSchema: "product-research-record.v1",
        candidateId: record.candidateId,
        researchRevision: 1,
        researchHash: record.researchHash,
        workflowStatus: "completed",
        decisionStatus: "creative_ready",
        candidateSourceFingerprint: "d".repeat(64),
      },
      productIdentity: { displayName: "Test", identityConfirmedAt: NOW },
      evidence,
      prohibitedClaims: [{
        claimId: "00000000-0000-4000-8000-000000000001",
        category: "absolute_claim",
        summary: "No absolute claims.",
        appliesTo: ["both"],
        source: "system_rule",
      }],
      creativePreferences: { evidenceTier: "creative_preference" },
      visualReferences: [],
    })).toThrowError(expect.objectContaining({ code: "invalid_projected_candidate" }));
  });

  it("19. creative_ready 不自动把来源升级为人工事实", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const human = evidence.filter((e) => e.evidenceTier === "human_confirmed");
    expect(human).toHaveLength(0); // 即使 latestDecision=creative_ready
  });

  it("20. workflow 完成不自动把 AI 输出升级为事实", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    // AI 内容全部在 ai_hypothesis，无 source_snapshot 冒充
    const sourceFields = evidence
      .filter((e) => e.evidenceTier === "source_snapshot")
      .map((e) => (e as { fact: { field: string } }).fact.field);
    expect(sourceFields).not.toContain("selling_points");
    expect(sourceFields).not.toContain("title_draft");
  });

  it("21. 五层投影：evidence 层齐全；无人工确认时投影失败（Preview 降级语义）", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const tiers = evidence.map((e) => e.evidenceTier);
    expect(tiers).toContain("source_snapshot");
    expect(tiers).toContain("ai_hypothesis");
    expect(tiers).toContain("unknown_or_conflict");
    // 无人工确认（无 user_confirmation 生产点）→ PR2-0 强制 ≥1 confirmedFact → 投影失败
    const record = buildRecord();
    expect(() => projectProductCreativeHandoffCandidate({
      sourceResearch: {
        recordSchema: "product-research-record.v1",
        candidateId: record.candidateId,
        researchRevision: 1,
        researchHash: record.researchHash,
        workflowStatus: "completed",
        decisionStatus: "creative_ready",
        candidateSourceFingerprint: "d".repeat(64),
      },
      productIdentity: { displayName: "Test", identityConfirmedAt: NOW },
      evidence,
      prohibitedClaims: [{
        claimId: "00000000-0000-4000-8000-000000000001",
        category: "absolute_claim",
        summary: "No absolute claims.",
        appliesTo: ["both"],
        source: "system_rule",
      }],
      creativePreferences: { evidenceTier: "creative_preference" },
      visualReferences: [],
    })).toThrowError(expect.objectContaining({ code: "invalid_projected_candidate" }));
  });
});

describe("投影接线行为（Preview 语义）", () => {
  it("28. 仅来源数据时 confirmedFacts 为空", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput({ agentOutput: null }));
    const human = evidence.filter((e) => e.evidenceTier === "human_confirmed");
    expect(human).toHaveLength(0);
    const source = evidence.filter((e) => e.evidenceTier === "source_snapshot");
    expect(source.length).toBeGreaterThan(0);
  });

  it("29. 仅 AI 内容时 confirmedFacts 为空", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput({
      agentOutput: buildAgentOutput(),
    }));
    const human = evidence.filter((e) => e.evidenceTier === "human_confirmed");
    expect(human).toHaveLength(0);
  });

  it("31. 不通过跨层升级制造可选事实（stable/AI 永不进入 confirmedFacts）", () => {
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const human = evidence.filter((e) => e.evidenceTier === "human_confirmed");
    expect(human).toHaveLength(0); // 合法来源仅 user_confirmation，无生产点 → 不伪造
    const stable = evidence.filter((e) => e.evidenceTier === "source_snapshot");
    for (const item of stable) {
      if (item.evidenceTier !== "source_snapshot") continue;
      expect(item.fact.usageScopes).toEqual(["internal"]); // stable 仅 internal，不可选为 confirmed
    }
  });

  it("30. 无可选事实时语义：stable facts 不可选为 confirmed（Create 应 no_facts_selected）", () => {
    // stable facts 不能作为 confirmedFacts 被选择 — 只有 future user_confirmation 可产生
    const { evidence } = buildProductCreativeHandoffProjectionEvidence(buildInput());
    const confirmed = evidence.filter((e) => e.evidenceTier === "human_confirmed");
    expect(confirmed).toHaveLength(0);
    expect(evidence.some((e) => e.evidenceTier === "source_snapshot")).toBe(true);
  });
});
