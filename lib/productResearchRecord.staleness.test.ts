/**
 * V3 UX Closure — Staleness 契约测试（completion 后证据变化 → NEEDS_RECONFIRMATION）
 */
import { describe, expect, it } from "vitest";
import {
  computeResearchEvidenceHash,
  getResearchCompletion,
  getResearchStaleState,
  parseResearchCompletion,
  RESEARCH_COMPLETION_SCHEMA,
} from "@/lib/productResearchRecord";

function completedResultJson(evidenceHash?: string): Record<string, unknown> {
  return {
    browserEvidence: { schema: "browser-evidence.v1", snapshots: [{ fields: { asin: { value: "B0F2BF31PW" } } }] },
    vocAnalysis: { schema: "voc-analysis.v1", themes: { positiveThemes: ["good"] } },
    researchRecord: {
      schema: "product-research-record.v1",
      revision: 1,
      latestDecision: { status: "creative_ready" },
    },
    researchCompletion: {
      schema: RESEARCH_COMPLETION_SCHEMA,
      status: "completed",
      completedAt: "2026-08-19T00:00:00.000Z",
      decisionId: "16634ef2-c31c-4c39-978e-f6be646d34db",
      revision: 1,
      finalStatus: "creative_ready",
      ...(evidenceHash ? { evidenceHash } : {}),
    },
  };
}

describe("computeResearchEvidenceHash", () => {
  it("证据命名空间变化 → hash 变化；与 evidence 无关的字段不影响", () => {
    const base = completedResultJson();
    const hash1 = computeResearchEvidenceHash(base);
    expect(hash1).toBeTruthy();
    expect(hash1?.length).toBe(64);

    // 新增 browserEvidence 快照 → hash 变化
    const changed = completedResultJson();
    (changed.browserEvidence as { snapshots: unknown[] }).snapshots.push({ fields: { asin: { value: "B0F2BF31PW" }, title: { value: "x" } } });
    const hash2 = computeResearchEvidenceHash(changed);
    expect(hash2).not.toBe(hash1);

    // 与证据无关字段（如 productName）变化 → hash 不变
    const cosmetic = completedResultJson();
    cosmetic.productName = "changed title";
    expect(computeResearchEvidenceHash(cosmetic)).toBe(hash1);
  });

  it("无证据命名空间 → null", () => {
    expect(computeResearchEvidenceHash({ productName: "x" })).toBeNull();
    expect(computeResearchEvidenceHash(null)).toBeNull();
  });
});

describe("getResearchStaleState", () => {
  it("completion 无 evidenceHash（旧数据）→ 不 stale（兼容）", () => {
    const state = getResearchStaleState(completedResultJson());
    expect(state.completed).toBe(true);
    expect(state.stale).toBe(false);
  });

  it("completion 有 hash 且证据未变 → 不 stale", () => {
    const result = completedResultJson();
    const hash = computeResearchEvidenceHash(result)!;
    const withHash = completedResultJson(hash);
    const state = getResearchStaleState(withHash);
    expect(state.stale).toBe(false);
  });

  it("completion 有 hash 且证据变化 → stale=true（NEEDS_RECONFIRMATION）", () => {
    const result = completedResultJson();
    const hash = computeResearchEvidenceHash(result)!;
    const withHash = completedResultJson(hash);
    // 新增证据
    (withHash.sourcingEvidence as Record<string, unknown>) = { schema: "sourcing-evidence.v1", candidates: [] };
    const state = getResearchStaleState(withHash);
    expect(state.stale).toBe(true);
    expect(state.completionEvidenceHash).toBe(hash);
    expect(state.currentEvidenceHash).not.toBe(hash);
  });

  it("无 completion → completed=false、stale=false", () => {
    const state = getResearchStaleState({ browserEvidence: {} });
    expect(state.completed).toBe(false);
    expect(state.stale).toBe(false);
  });
});

describe("parseResearchCompletion（evidenceHash 字段）", () => {
  it("解析保留 evidenceHash；缺省为 null（兼容旧数据）", () => {
    const withHash = parseResearchCompletion(completedResultJson("a".repeat(64)).researchCompletion);
    expect(withHash?.evidenceHash).toBe("a".repeat(64));
    const withoutHash = parseResearchCompletion(completedResultJson().researchCompletion);
    expect(withoutHash?.evidenceHash).toBeUndefined();
  });

  it("getResearchCompletion 读取带 hash 的 completion", () => {
    const completion = getResearchCompletion(completedResultJson("b".repeat(64)));
    expect(completion?.evidenceHash).toBe("b".repeat(64));
  });
});
