import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";
import { buildCandidateAgentRunHref } from "@/lib/candidateAgentRunLink";
import { buildCandidateTaskLinkMap, resolveCandidateTaskLinks } from "@/lib/candidateTaskLinks";
import {
  canCandidateEnterAgent,
  normalizeCandidate,
  parseCandidatePool,
  serializeCandidatePool,
  serverCandidateToPoolItem,
} from "@/lib/opportunityCandidatePool";
import { OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE } from "@/lib/opportunityDecisionDeskVisualFixture";
import type { R22MarketDecisionSnapshot } from "@/lib/r22DecisionModel";

type OpportunitiesFormProps = NonNullable<Parameters<typeof OpportunitiesForm>[0]>;
const OpportunitiesFormComponent = OpportunitiesForm as ComponentType<OpportunitiesFormProps>;

function marketShortlisted(candidateId: string): R22MarketDecisionSnapshot {
  return {
    schemaVersion: "r22-market-decision-v1",
    evidenceVersion: "r22-evidence-semantics-v1",
    candidateId,
    asin: "B000000001",
    briefId: "A",
    frozenRank: 1,
    marketDecision: "market_shortlisted",
    decisionReasons: ["behavior_contract_fixture"],
    supportingEvidenceRefs: ["fixture:market"],
    opposingEvidenceRefs: [],
    marketMissingFields: [],
    dataCompleteness: 1,
    confidence: "high",
    stabilityStatus: "stable",
    ruleVersion: "r22-stage1-market-v1",
    inputHash: "a".repeat(64),
    createdAt: "2026-07-23T00:00:00.000Z",
  };
}

function expectDecisionSummary(
  markup: string,
  expected: {
    readonly all: number;
    readonly pending: number;
    readonly worthAnalyzing: number;
    readonly analyzing: number;
    readonly converted: number;
  },
) {
  expect(markup).toMatch(new RegExp(`全部候选</p><p[^>]*>${expected.all}</p>`));
  expect(markup).toMatch(new RegExp(`待查看</p><p[^>]*>${expected.pending}</p>`));
  expect(markup).toMatch(new RegExp(`待分析</p><p[^>]*>${expected.worthAnalyzing}</p>`));
  expect(markup).toMatch(new RegExp(`分析中</p><p[^>]*>${expected.analyzing}</p>`));
  expect(markup).toMatch(new RegExp(`已转任务</p><p[^>]*>${expected.converted}</p>`));
}

describe("OpportunitiesForm public behavior", () => {
  it("keeps the default and advanced surfaces distinct through the public interface", () => {
    const defaultMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, { visualFixture: [] }));
    const advancedMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
      surface: "advanced_import",
      visualFixture: [],
    }));

    expect(defaultMarkup).toContain("机会雷达");
    expect(defaultMarkup).not.toContain("高级工具");
    expect(advancedMarkup).toContain("高级工具");
    expect(advancedMarkup).toContain("手工导入外部来源");
  });

  it("renders the locked opportunity preview with surface-specific copy and static safety guidance", () => {
    const defaultMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent));
    const advancedMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
      surface: "advanced_import",
    }));

    expect(defaultMarkup).toContain("机会雷达 / 候选品池 · 功能预览");
    expect(defaultMarkup).not.toContain("高级工具");
    expect(advancedMarkup).toContain("高级工具");
    expect(advancedMarkup).toContain("手工导入外部来源 · 功能预览");

    for (const markup of [defaultMarkup, advancedMarkup]) {
      expect(markup).toContain("示例候选品（仅供参考，非真实数据）");
      expect(markup).toContain("桌面手机支架");
      expect(markup).toContain("宠物慢食碗");
      expect(markup).toContain("硅胶折叠水杯");
      expect(markup).toContain("数据安全说明");
      expect(markup).toContain("返回首页解锁");
    }
  });

  it("renders the isolated fixture without render-phase network or intake behavior", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      const markup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
        visualFixture: OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE,
      }));

      expect(markup).toContain("隔离视觉验收模式");
      expect(markup).toContain('data-testid="opportunity-decision-desk"');
      expect(markup.match(/data-testid="decision-row-/g)).toHaveLength(
        OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE.length,
      );
      expect(markup).not.toContain('data-testid="candidate-intake-toggle"');
      expect(markup).not.toContain("示例候选品（仅供参考，非真实数据）");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("renders the same candidate decision summary on both unlocked surfaces and hides it while locked", () => {
    const defaultMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
      visualFixture: OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE,
    }));
    const advancedMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
      surface: "advanced_import",
      visualFixture: OPPORTUNITY_DECISION_DESK_VISUAL_FIXTURE,
    }));
    const emptyMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent, {
      visualFixture: [],
    }));
    const lockedMarkup = renderToStaticMarkup(createElement(OpportunitiesFormComponent));
    const populatedSummary = {
      all: 7,
      pending: 4,
      worthAnalyzing: 1,
      analyzing: 0,
      converted: 1,
    };

    expectDecisionSummary(defaultMarkup, populatedSummary);
    expectDecisionSummary(advancedMarkup, populatedSummary);
    expectDecisionSummary(emptyMarkup, {
      all: 0,
      pending: 0,
      worthAnalyzing: 0,
      analyzing: 0,
      converted: 0,
    });
    expect(lockedMarkup).not.toContain("全部候选");
  });
});

describe("Candidate authority handoff behavior", () => {
  it("blocks a local draft, then permits only the confirmed server Candidate", () => {
    const localDraft = normalizeCandidate({
      name: "桌面收纳架",
      rawInput: "desk organizer",
      score: 88,
      riskLevel: "green",
    }, 1_000);
    if (!localDraft) throw new Error("expected local draft fixture");

    expect(localDraft.identitySource).toBe("local_draft");
    expect(canCandidateEnterAgent(localDraft, true)).toBe(false);
    expect(buildCandidateAgentRunHref({
      candidateId: localDraft.id,
      name: localDraft.name,
    })).toBeNull();

    const candidateId = "candidate-owner-001";
    const confirmed = serverCandidateToPoolItem({
      id: candidateId,
      name: localDraft.name,
      rawInput: localDraft.rawInput,
      status: "worth_analyzing",
      score: localDraft.score,
      r22MarketDecisionSnapshot: marketShortlisted(candidateId),
    });
    const href = buildCandidateAgentRunHref({
      candidateId: confirmed.id,
      name: confirmed.name,
      rawInput: confirmed.rawInput,
      score: confirmed.score,
      marketDecisionSnapshot: confirmed.r22MarketDecisionSnapshot,
    });

    expect(confirmed.identitySource).toBe("server");
    expect(canCandidateEnterAgent(confirmed, true)).toBe(true);
    expect(href).toContain("/agent/run?");
    expect(href).toContain(`candidateId=${candidateId}`);
  });

  it("blocks another Agent handoff once the Candidate has a Task relation", () => {
    const candidateId = "sandbox_candidate_visitor-001";
    const candidate = serverCandidateToPoolItem({
      id: candidateId,
      name: "访客候选",
      status: "analyzed",
      r22MarketDecisionSnapshot: marketShortlisted(candidateId),
    });
    const taskMap = buildCandidateTaskLinkMap([{
      id: "sandbox_task_001",
      title: "访客候选分析",
      createdAt: "2026-07-23T01:00:00.000Z",
      source: "agent_run",
      result: {
        sourceMeta: {
          candidateId,
          from: "opportunity",
          entry: "candidate_to_agent_run",
        },
      },
    }]);
    const links = resolveCandidateTaskLinks(candidate, taskMap.get(candidateId) ?? []);

    expect(links).toHaveLength(1);
    expect(links[0].taskId).toBe("sandbox_task_001");
    expect(canCandidateEnterAgent(candidate, true, links.length > 0)).toBe(false);
  });

  it("does not let a browser-restored Candidate bypass the server availability gate", () => {
    const candidateId = "candidate-owner-002";
    const serverCandidate = serverCandidateToPoolItem({
      id: candidateId,
      name: "折叠收纳盒",
      status: "worth_analyzing",
      convertedTaskId: "task-owner-002",
      r22MarketDecisionSnapshot: marketShortlisted(candidateId),
    });
    const restored = parseCandidatePool(serializeCandidatePool([serverCandidate], 1_000), 1_001).items[0];

    expect(restored).toBeDefined();
    expect(restored).not.toHaveProperty("convertedTaskId", "task-owner-002");
    expect(restored).not.toHaveProperty("r22MarketDecisionSnapshot");
    expect(canCandidateEnterAgent(restored, false)).toBe(false);
  });
});
