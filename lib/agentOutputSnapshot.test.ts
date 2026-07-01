import { describe, expect, it } from "vitest";
import {
  extractAgentOutputSnapshotFromTask,
  normalizeAgentOutputSnapshot,
  validateAgentOutputSnapshot,
} from "@/lib/agentOutputSnapshot";

function fullInput() {
  return {
    workflowResult: {
      productName: "桌面手机支架",
      sourcing: {
        conclusion: "1688/阿里国际站可找同款，需确认 MOQ。",
        sourceSignals: ["多供应商可比价"],
        priceSignals: ["采购价 15-20 元"],
        availabilitySignals: ["现货可能性高"],
      },
      risk: {
        overallLevel: "yellow",
        riskFlags: ["ip_check"],
        complianceConcerns: ["需确认平台类目规则"],
        ipConcerns: ["外观专利需查"],
        logisticsConcerns: ["体积重需核算"],
        safetyConcerns: ["夹具力度需确认"],
        summary: "中风险，需要人工复核。",
      },
      summary: {
        decision: "recommended",
        targetUser: "桌面办公人群",
        sellingPoints: ["解放双手", "角度可调"],
        concerns: ["同质化"],
        confidence: "high",
      },
      listing: {
        title: "Adjustable Desk Phone Stand",
        bullets: ["Adjustable angle", "Foldable body"],
        keywords: ["phone stand", "desk holder"],
        description: "A compact desk phone stand.",
        imageIdeas: ["desk scene"],
        complianceNotes: ["avoid brand terms"],
      },
      finalReport: {
        finalVerdict: "建议小单测试",
        riskLevel: "yellow",
        beginnerFit: "适合新手",
        canTestSmallBatch: true,
        nextSteps: ["联系供应商", "核算运费"],
        manualReviewChecklist: ["复核供应商", "复核专利"],
      },
    },
    sourceMeta: {
      evidenceSnapshot: {
        sourceType: "web",
        sourceName: "source importer",
        sourceUrl: "https://example.com/item?token=secret-token&ref=ok",
        qualityScore: 86,
        confidence: "high",
        riskFlags: ["ip_check"],
        decision: "recommended",
        decisionReason: "Specific source page.",
      },
    },
  };
}

describe("normalizeAgentOutputSnapshot", () => {
  it("normalizes complete workflow output into stable child snapshots", () => {
    const snapshot = normalizeAgentOutputSnapshot(fullInput());

    expect(snapshot.version).toBe("agent-output-v1");
    expect(snapshot.sourcingSnapshot.supplierConclusion).toContain("可找同款");
    expect(snapshot.riskSnapshot.riskLevel).toBe("medium");
    expect(snapshot.summarySnapshot.decision).toBe("recommended");
    expect(snapshot.listingSnapshot.titleDraft).toBe("Adjustable Desk Phone Stand");
    expect(snapshot.nextActionSnapshot.primaryAction).toBe("small_batch_test");
    expect(snapshot.humanReviewSnapshot.required).toBe(true);
    expect(snapshot.fallbackUsed).toBe(false);
    expect(snapshot.candidateEvidence?.sourceUrl).not.toContain("secret-token");
  });

  it("creates fallback snapshot from finalReport only", () => {
    const snapshot = normalizeAgentOutputSnapshot({
      workflowResult: {
        productName: "桌面手机支架",
        finalReport: {
          finalVerdict: "不建议继续",
          riskLevel: "red",
          nextSteps: ["先查侵权"],
          manualReviewChecklist: ["复核高风险"],
        },
      },
    });

    expect(snapshot.fallbackUsed).toBe(true);
    expect(snapshot.riskSnapshot.riskLevel).toBe("high");
    expect(snapshot.summarySnapshot.decision).toBe("not_recommended");
    expect(snapshot.nextActionSnapshot.primaryAction).toBe("check_compliance");
    expect(snapshot.humanReviewSnapshot.required).toBe(true);
    expect(snapshot.warnings).toContain("sourcingSnapshot fallback used");
  });

  it("handles empty or malformed input without throwing", () => {
    const snapshot = normalizeAgentOutputSnapshot({
      workflowResult: {
        productName: 123,
        sourcing: "bad",
        risk: { overallLevel: 999, riskFlags: ["a", "a", 1] },
        listing: { bullets: new Array(20).fill("x".repeat(500)) },
      },
    });

    expect(snapshot.summarySnapshot.decision).toBe("unknown");
    expect(snapshot.riskSnapshot.riskLevel).toBe("unknown");
    expect(snapshot.riskSnapshot.riskFlags).toEqual(["a"]);
    expect(snapshot.listingSnapshot.bulletDrafts.length).toBeLessThanOrEqual(5);
    expect(snapshot.listingSnapshot.bulletDrafts[0].length).toBeLessThanOrEqual(180);
    expect(snapshot.warnings.length).toBeGreaterThan(0);
  });

  it("redacts sensitive keys and url query values", () => {
    const snapshot = normalizeAgentOutputSnapshot({
      workflowResult: {
        productName: "Secret Product",
        finalReport: {
          finalVerdict: "建议观察 password=abc",
          riskLevel: "green",
          nextSteps: ["check https://example.com/a?api_key=abc&color=red"],
        },
        listing: {
          title: "token abc should not leak",
          keywords: ["safe", "cookie=session"],
        },
      },
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("password=abc");
    expect(serialized).not.toContain("api_key=abc");
    expect(serialized).not.toContain("cookie=session");
    expect(serialized).toContain("[redacted]");
    expect(serialized).toContain("color=red");
  });

  it("validates snapshot shape and extracts from task resultJson", () => {
    const snapshot = normalizeAgentOutputSnapshot(fullInput());
    expect(validateAgentOutputSnapshot(snapshot)).toEqual({ ok: true, warnings: [], errors: [] });

    expect(extractAgentOutputSnapshotFromTask({ agentOutputSnapshot: snapshot })).toEqual(snapshot);
    expect(extractAgentOutputSnapshotFromTask({ finalReport: {} })).toBeNull();
    expect(extractAgentOutputSnapshotFromTask("{bad")).toBeNull();
  });
});
