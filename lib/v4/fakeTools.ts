/**
 * V4 P1 — Deterministic fake tools（P1_CONTRACT §3）。
 *
 * 覆盖 plan / question / tool / validate / evidence / merge / conflict /
 * feasibility / content 节点输出。确定性：inputHash → 固定结果表；
 * 零网络/浏览器/LLM。
 *
 * 副作用幂等由 journal 在 graph runner 层保障；此处仅产生确定性结果。
 */
import "server-only";

import { sha256, stableStringify } from "@/lib/v4/journal";

export type ResearchQuestion = {
  questionId: string;
  toolName: string;
  input: Record<string, unknown>;
  inputHash: string;
};

export type ResearchPlan = {
  planRevision: number;
  rationale: string;
  questions: ResearchQuestion[];
  stopConditions: string[];
};

export type ToolResult = {
  toolName: string;
  outputHash: string;
  payload: Record<string, unknown>;
  ok: boolean;
};

export type EvidenceItem = {
  evidenceId: string;
  questionId: string;
  sourceType: string;
  summary: string;
  inputHash: string;
};

export type ConflictItem = {
  conflictId: string;
  description: string;
  involvedEvidenceIds: string[];
};

export type FeasibilitySnapshot = {
  scenario: "baseline" | "optimistic" | "pessimistic";
  margin: number;
  unit: string;
  currency: string;
  notes: string;
};

export type ContentDraft = {
  listingTitle: string;
  bulletPoints: string[];
  imagePlan: string;
  complianceWarnings: string[];
};

/** 固定结果表（按 inputHash 前 8 hex 归一化到 0..4）。 */
const RESULT_TABLE = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
const TOOL_TABLE = [
  "opportunity_priority",
  "competitor_research",
  "keyword_research",
  "review_voc",
  "supplier_research",
] as const;

function slotOf(hash: string): number {
  return parseInt(hash.slice(0, 8), 16) % RESULT_TABLE.length;
}

function stableHash(input: unknown): string {
  return sha256(stableStringify(input));
}

function makeId(prefix: string, hash: string): string {
  return `${prefix}-${hash.slice(0, 12)}`;
}

export class FakeToolRegistry {
  /** build_plan：根据缺口/上下文生成有限问题清单。 */
  plan(input: { contextHash: string; budgetInputHash: string }): ResearchPlan {
    const key = stableHash(input);
    const questions: ResearchQuestion[] = [];
    const count = 2 + (slotOf(key) % 3); // 2..4
    for (let i = 0; i < count; i += 1) {
      const toolName = TOOL_TABLE[(slotOf(key) + i) % TOOL_TABLE.length];
      const questionInput = { toolName, seq: i, contextHash: input.contextHash };
      const inputHash = stableHash(questionInput);
      questions.push({
        questionId: makeId("q", stableHash({ ...questionInput, run: key })),
        toolName,
        input: questionInput,
        inputHash,
      });
    }
    return {
      planRevision: 0,
      rationale: `Deterministic plan derived from context ${input.contextHash.slice(0, 8)}`,
      questions,
      stopConditions: ["no_conflicting_evidence", "budget_exhausted"],
    };
  }

  /** dispatch_tool：确定性工具结果（零网络）。 */
  tool(input: { toolName: string; questionId: string; inputHash: string }): ToolResult {
    const key = stableHash(input);
    const outputHash = sha256(`tool|${input.toolName}|${input.inputHash}`);
    const slot = RESULT_TABLE[slotOf(key)];
    return {
      toolName: input.toolName,
      outputHash,
      ok: true,
      payload: {
        summary: `${input.toolName} deterministic result: ${slot}`,
        value: slot,
        inputHash: input.inputHash,
      },
    };
  }

  /** validate_output：接受全部工具结果（确定性）。 */
  validate(input: { toolResult: ToolResult; questionId: string }): {
    valid: boolean;
    reason: string;
  } {
    if (!input.toolResult.ok) {
      return { valid: false, reason: "tool result reported failure" };
    }
    return { valid: true, reason: "schema_ok" };
  }

  /** merge_evidence：把工具结果转为 EvidenceItem。 */
  evidence(input: {
    toolResult: ToolResult;
    questionId: string;
  }): EvidenceItem {
    const outputHash = input.toolResult.outputHash;
    return {
      evidenceId: makeId("ev", outputHash),
      questionId: input.questionId,
      sourceType: input.toolResult.toolName,
      summary: String(input.toolResult.payload.summary ?? ""),
      inputHash: input.toolResult.payload.inputHash as string,
    };
  }

  /** merge_evidence：合并（P1 fake 直接返回新证据列表）。 */
  merge(input: { evidence: EvidenceItem[] }): { mergedEvidence: EvidenceItem[] } {
    const seen = new Set<string>();
    const merged = input.evidence.filter((e) => {
      if (seen.has(e.evidenceId)) return false;
      seen.add(e.evidenceId);
      return true;
    });
    return { mergedEvidence: merged };
  }

  /** detect_conflicts：确定性冲突检测（P1 fake 无冲突）。 */
  conflicts(input: { evidence: EvidenceItem[] }): { conflicts: ConflictItem[] } {
    const bySummary = new Map<string, EvidenceItem[]>();
    for (const e of input.evidence) {
      const list = bySummary.get(e.summary) ?? [];
      list.push(e);
      bySummary.set(e.summary, list);
    }
    const conflicts: ConflictItem[] = [];
    for (const [summary, group] of bySummary) {
      if (group.length > 1 && summary.includes("conflict-marker")) {
        conflicts.push({
          conflictId: makeId("conf", stableHash(summary)),
          description: `Conflicting evidence for ${summary}`,
          involvedEvidenceIds: group.map((g) => g.evidenceId),
        });
      }
    }
    return { conflicts };
  }

  /** commercial_check：确定性三情景快照。 */
  feasibility(input: {
    facts: Record<string, unknown>;
    budgetInputHash: string;
  }): FeasibilitySnapshot {
    const key = stableHash(input.facts);
    const margin = (slotOf(key) % 50) / 10 + 1.0; // 1.0 .. 5.9
    return {
      scenario: "baseline",
      margin,
      unit: "per_unit",
      currency: "USD",
      notes: `Deterministic feasibility margin ${margin.toFixed(1)}`,
    };
  }

  /** content_skills：确定性内容草稿。 */
  content(input: {
    handoff: { factRevision: number; policyPackVersion: string };
  }): ContentDraft {
    const key = stableHash(input.handoff);
    const slot = RESULT_TABLE[slotOf(key)];
    return {
      listingTitle: `${slot} listing draft (facts rev ${input.handoff.factRevision})`,
      bulletPoints: [`Feature ${slot} A`, `Feature ${slot} B`],
      imagePlan: `main image plan for ${slot}`,
      complianceWarnings: [],
    };
  }
}

/** 供外部复用：对任意输入计算确定性摘要（测试断言用）。 */
export function fakeResultFor(toolName: string, inputHash: string): string {
  return RESULT_TABLE[slotOf(sha256(stableStringify({ toolName, inputHash })))];
}
