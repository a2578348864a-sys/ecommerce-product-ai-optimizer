import { describe, expect, it } from "vitest";
import { deriveTaskOperationSummary } from "@/lib/taskOperationSummary";

function makeAgentTask(overrides: Record<string, unknown> = {}) {
  return {
    type: "workflow",
    title: "Desk Phone Stand",
    materialText: "Desk Phone Stand",
    oneLineSummary: "Controlled sample",
    level: "yellow",
    decisionStatus: "pending" as const,
    result: {
      productName: "Desk Phone Stand",
      sourceMeta: {
        source: "opportunity",
        opportunityTitle: "Desk Phone Stand",
        opportunitySource: "B2 sample",
        opportunityScore: 86,
        evidenceSnapshot: {
          version: 1,
          sourceType: "manual",
          sourceName: "B2 sample",
          sourceUrl: "https://example.com/item?token=[redacted]",
          evidenceItems: ["controlled_sample"],
          extractionSignals: ["manual"],
          qualityScore: 86,
          confidence: "high",
          riskFlags: ["ip_check"],
          decision: "recommended",
          decisionReason: "Specific product page with usable source evidence.",
          nextAction: "Continue to agent run after manual confirmation.",
          generatedAt: "2026-07-01T00:00:00.000Z",
        },
      },
      agentOutputSnapshot: {
        version: "agent-output-v1",
        generatedAt: "2026-07-01T00:00:00.000Z",
        fallbackUsed: false,
        warnings: [],
        candidateEvidence: {
          sourceType: "manual",
          sourceName: "B2 sample",
          sourceUrl: "https://example.com/item?token=[redacted]",
          qualityScore: 86,
          confidence: "high",
          riskFlags: ["ip_check"],
          decision: "recommended",
          decisionReason: "Controlled sample for B3.",
        },
        sourcingSnapshot: {
          supplierConclusion: "Supplier review is possible, but quote still needs manual confirmation.",
          sourceSignals: ["specific source"],
          priceSignals: ["price not verified"],
          availabilitySignals: ["common category"],
          assumptions: [],
          missingInfo: ["supplier quote", "MOQ"],
          confidence: "high",
        },
        riskSnapshot: {
          riskLevel: "medium",
          riskFlags: ["ip_check"],
          complianceConcerns: ["Check platform compliance"],
          ipConcerns: ["Check design patent"],
          logisticsConcerns: ["Confirm package weight"],
          safetyConcerns: ["Confirm material safety"],
          riskReason: "Compliance and IP need manual review.",
          needsManualReview: false,
        },
        summarySnapshot: {
          decision: "recommended",
          decisionReason: "Good sample, but still needs supplier quote.",
          targetUser: "home office users",
          sellingPoints: ["foldable", "adjustable"],
          concerns: ["commodity category"],
          confidence: "high",
        },
        listingSnapshot: {
          titleDraft: "Adjustable Foldable Desk Phone Stand",
          bulletDrafts: ["Foldable design", "Adjustable angle"],
          keywordHints: ["phone stand", "desk phone holder"],
          imageIdeas: ["desk scene"],
          complianceNotes: ["avoid brand terms"],
          missingInputs: [],
        },
        nextActionSnapshot: {
          primaryAction: "small_batch_test",
          actionLabel: "Review before small batch test",
          checklist: ["verify supplier", "check patent", "fill quote"],
          blockingIssues: ["real quote not verified", "supplier not verified", "patent not checked"],
          suggestedOwnerStep: "Review before small batch test.",
        },
        humanReviewSnapshot: {
          required: false,
          reasons: [],
          reviewFocus: ["supplier", "IP", "margin"],
          defaultStatus: "not_required",
        },
      },
      ...overrides,
    },
  };
}

describe("deriveTaskOperationSummary", () => {
  it("turns complete B1 and B2 data into an operations action summary", () => {
    const summary = deriveTaskOperationSummary(makeAgentTask());

    expect(summary.stage).toBe("small_batch_test");
    expect(summary.stageLabel).toBe("小批量测试");
    expect(summary.decision).toBe("recommended");
    expect(summary.decisionLabel).toBe("建议推进");
    expect(summary.riskLevel).toBe("medium");
    expect(summary.riskLabel).toBe("中风险");
    expect(summary.primaryAction).toBe("small_batch_test");
    expect(summary.actionLabel).toBe("Review before small batch test");
    expect(summary.listingReadiness).toBe("ready");
    expect(summary.sourceQualityScore).toBe(86);
    expect(summary.confidence).toBe("high");
    expect(summary.fallbackUsed).toBe(false);
  });

  it("prioritizes human review when humanReviewSnapshot requires it", () => {
    const task = makeAgentTask({
      agentOutputSnapshot: {
        ...makeAgentTask().result.agentOutputSnapshot,
        humanReviewSnapshot: {
          required: true,
          reasons: ["risk needs human review"],
          reviewFocus: ["IP"],
          defaultStatus: "needs_review",
        },
      },
    });

    expect(deriveTaskOperationSummary(task).stage).toBe("needs_review");
  });

  it("prioritizes high risk as compliance check when manual review is not explicitly required", () => {
    const base = makeAgentTask().result.agentOutputSnapshot;
    const task = makeAgentTask({
      agentOutputSnapshot: {
        ...base,
        riskSnapshot: {
          ...base.riskSnapshot,
          riskLevel: "high",
          needsManualReview: false,
        },
        humanReviewSnapshot: {
          required: false,
          reasons: [],
          reviewFocus: [],
          defaultStatus: "not_required",
        },
      },
    });

    expect(deriveTaskOperationSummary(task).stage).toBe("check_compliance");
  });

  it("maps prepare_listing next action into prepare_listing stage", () => {
    const base = makeAgentTask().result.agentOutputSnapshot;
    const task = makeAgentTask({
      agentOutputSnapshot: {
        ...base,
        nextActionSnapshot: {
          ...base.nextActionSnapshot,
          primaryAction: "prepare_listing",
          actionLabel: "准备 Listing",
        },
      },
    });

    expect(deriveTaskOperationSummary(task).stage).toBe("prepare_listing");
  });

  it("derives partial and missing listing readiness", () => {
    const base = makeAgentTask().result.agentOutputSnapshot;
    const partial = deriveTaskOperationSummary(makeAgentTask({
      agentOutputSnapshot: {
        ...base,
        listingSnapshot: {
          ...base.listingSnapshot,
          bulletDrafts: [],
          keywordHints: [],
          missingInputs: ["keywords"],
        },
      },
    }));
    const missing = deriveTaskOperationSummary(makeAgentTask({
      agentOutputSnapshot: {
        ...base,
        listingSnapshot: {
          titleDraft: "",
          bulletDrafts: [],
          keywordHints: [],
          imageIdeas: [],
          complianceNotes: [],
          missingInputs: [],
        },
      },
    }));

    expect(partial.listingReadiness).toBe("partial");
    expect(missing.listingReadiness).toBe("missing");
  });

  it("falls back to candidate evidence when agent snapshot is missing", () => {
    const task = makeAgentTask({ agentOutputSnapshot: undefined });
    const summary = deriveTaskOperationSummary(task);

    expect(summary.decision).toBe("recommended");
    expect(summary.riskLevel).toBe("medium");
    expect(summary.evidenceSummary).toContain("Specific product page");
    expect(summary.sourceQualityScore).toBe(86);
    expect(summary.fallbackUsed).toBe(true);
  });

  it("degrades safely for legacy tasks without B1 or B2 data", () => {
    const summary = deriveTaskOperationSummary({
      type: "workflow",
      title: "Legacy task",
      materialText: "Legacy task",
      oneLineSummary: "",
      level: "",
      decisionStatus: "pending",
      result: { productName: "Legacy task" },
    });

    expect(summary.stage).toBe("unknown");
    expect(summary.stageLabel).toContain("历史任务");
    expect(summary.fallbackUsed).toBe(true);
    expect(summary.warnings).toContain("历史任务未记录标准化运营推进摘要");
  });

  it("limits blocking issues and review focus", () => {
    const base = makeAgentTask().result.agentOutputSnapshot;
    const summary = deriveTaskOperationSummary(makeAgentTask({
      agentOutputSnapshot: {
        ...base,
        nextActionSnapshot: {
          ...base.nextActionSnapshot,
          blockingIssues: ["a", "b", "c", "d", "e", "f"],
        },
        humanReviewSnapshot: {
          required: true,
          reasons: ["a", "b", "c"],
          reviewFocus: ["one", "two", "three", "four", "five", "six"],
          defaultStatus: "needs_review",
        },
      },
    }));

    expect(summary.blockingIssues).toHaveLength(5);
    expect(summary.reviewFocus).toHaveLength(5);
  });
});
