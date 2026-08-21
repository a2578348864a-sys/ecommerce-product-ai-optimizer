/**
 * V4 P1 — Research Graph（P1_CONTRACT §2 / D2/D3/D6/D7）。
 *
 * StateGraph（@langchain/langgraph 1.4.12）+ interrupt() HITL：
 *   load_context → validate_identity → assess_gaps → build_plan → [计划审核 interrupt]
 *   → dispatch_tool(fake) → validate_output → merge_evidence → detect_conflicts
 *   → (revise_plan ≤2 或继续) → synthesize_market → gate_a[interrupt]
 *   → supplier_research(fake) → product_fact_gate[interrupt] → commercial_check
 *   → gate_b[interrupt] → content_handoff → content_skills(fake)
 *   → content_review[interrupt] → complete；含 cancel / fail 路径。
 *
 * 5 个 human interrupt：build_plan(计划审核)、gate_a、product_fact_gate、gate_b、
 * content_review。
 *
 * Checkpoint 只用于恢复控制流；业务记录在 runStore（V4ResearchRun）与 journal。
 * 节点为纯函数（依赖注入 deps）；runner 负责持久化 runStore + 追加结构化事件。
 */
import "server-only";

import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
  type CompiledStateGraph,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import {
  RESEARCH_RUN_SCHEMA_VERSION,
  defaultResearchBudget,
  isTerminalStatus,
  type ResearchBudget,
  type ResearchRunError,
  type ResearchRunEvent,
  type ResearchRunNode,
  type ResearchRunState,
  type ResearchRunStatus,
  type ResearchRunWait,
  type ResumePayload,
} from "@/lib/v4/contracts";
import { CandidateNotFoundError, DomainAdapter, type CandidateSnapshot, type DomainDb } from "@/lib/v4/domain";
import { buildToolEnvelope, executeMarketTool, MARKET_TOOL_NAMES } from "@/lib/v4/tools/registry";
import type { CalcOutput } from "@/lib/v4/calculator/contract";
import type { ToolCallEnvelope as ToolCallEnvelopeLike, ToolResultEnvelope } from "@/lib/v4/tools/envelope";
import { buildMarketReport, validateEvidenceForMerge, validateReportCitations, type EvidenceItemV2, type MarketResearchReport } from "@/lib/v4/report";
import { FakeToolRegistry, type ConflictItem, type ContentDraft, type EvidenceItem, type FeasibilitySnapshot, type ResearchPlan, type ResearchQuestion, type ToolResult } from "@/lib/v4/fakeTools";
import { createPrismaRunStore, ResearchRunStore, type RunRow, RunStoreError } from "@/lib/v4/runStore";
import { createPrismaJournal, IdempotencyConflictError, SideEffectJournal, buildIdempotencyKey, sha256, stableStringify } from "@/lib/v4/journal";
import { checkpointDbPath, openCheckpoint } from "@/lib/v4/checkpoint";
import { prisma } from "@/lib/server/db";

export type ResearchGraph = CompiledStateGraph<any, any>;

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

export type HumanDecisionPayload = Extract<ResumePayload, { kind: "human_decision" }>;

export type InterruptValue = {
  kind: "human_decision" | "authentication" | "input" | "budget";
  reasonCode: string;
  node: ResearchRunNode;
  instructions?: string;
  plan?: ResearchPlan;
};

export const GraphStateAnnotation = Annotation.Root({
  runId: Annotation<string>,
  candidateId: Annotation<string>,
  ownerScope: Annotation<string>,
  sandboxId: Annotation<string | null>,
  mode: Annotation<"local_live" | "public_replay">,
  status: Annotation<ResearchRunStatus>,
  currentNode: Annotation<ResearchRunNode>,
  planRevision: Annotation<number>,
  automaticPlanRevisionCount: Annotation<number>,
  activeQuestionId: Annotation<string | null>,
  activeToolCallId: Annotation<string | null>,
  activeToolName: Annotation<string | null>,
  activeInputHash: Annotation<string | null>,
  activeToolResult: Annotation<ToolResult | null>,
  evidenceRevision: Annotation<number>,
  factRevision: Annotation<number | null>,
  policyPackVersion: Annotation<string | null>,
  budget: Annotation<ResearchBudget>,
  wait: Annotation<ResearchRunWait | null>,
  lastError: Annotation<ResearchRunError | null>,
  contextHash: Annotation<string>,
  candidateSnapshot: Annotation<CandidateSnapshot | null>,
  plan: Annotation<ResearchPlan | null>,
  questions: Annotation<ResearchQuestion[]>,
  dispatchedQuestionIds: Annotation<string[]>,
  evidence: Annotation<EvidenceItem[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  conflicts: Annotation<ConflictItem[]>,
  facts: Annotation<Record<string, unknown> | null>,
  feasibility: Annotation<FeasibilitySnapshot | null>,
  content: Annotation<ContentDraft | null>,
  handoff: Annotation<{ factRevision: number; policyPackVersion: string } | null>,
  lastValidation: Annotation<{ valid: boolean; reason: string } | null>,
  lastEvent: Annotation<Omit<ResearchRunEvent, "seq"> | null>,
  retryMode: Annotation<boolean>,
  activeToolEnvelope: Annotation<ToolResultEnvelope | null>,
  evidenceV2: Annotation<EvidenceItemV2[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  report: Annotation<MarketResearchReport | null>,
  gateAChoice: Annotation<string | null>,
  gateBChoice: Annotation<string | null>,
  commercial: Annotation<CalcOutput | null>,
});

export type GraphState = typeof GraphStateAnnotation.State;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type GraphDeps = {
  domain: DomainAdapter;
  tools: FakeToolRegistry;
  journal: SideEffectJournal;
  runStore: ResearchRunStore;
  checkpointPath: (runId: string) => string;
  /** P2：市场工具注册表（recorded/live）。缺省时退化为 fake tools。 */
  marketTools?: { names: readonly string[]; execute(envelope: ToolCallEnvelopeLike): Promise<ToolResultEnvelope> };
};

export function initialBudget(): ResearchBudget {
  return defaultResearchBudget();
}

function ev(
  node: ResearchRunNode,
  type: ResearchRunEvent["type"],
  payload: unknown,
): Omit<ResearchRunEvent, "seq"> {
  return { type, node, payloadJson: JSON.stringify(payload ?? {}), createdAt: new Date().toISOString() };
}

function failState(
  node: ResearchRunNode,
  error: { code: ResearchRunError["code"]; recoverable: boolean; safeMessage?: string },
): Partial<GraphState> {
  return {
    status: error.recoverable ? "failed_recoverable" : "failed_terminal",
    currentNode: "fail",
    lastError: { code: error.code, recoverable: error.recoverable, safeMessage: error.safeMessage, occurredAt: new Date().toISOString() },
  };
}

function consumeBudget(
  budget: ResearchBudget,
  consumption: { browserSteps?: number; llmTokens?: number; imageCalls?: number; cost?: number },
): { budget: ResearchBudget; over: boolean } {
  const next: ResearchBudget = {
    ...budget,
    usedBrowserSteps: budget.usedBrowserSteps + (consumption.browserSteps ?? 0),
    usedLlmTokens: budget.usedLlmTokens + (consumption.llmTokens ?? 0),
    usedImageCalls: budget.usedImageCalls + (consumption.imageCalls ?? 0),
    usedCost: budget.usedCost + (consumption.cost ?? 0),
  };
  const over =
    next.usedBrowserSteps > next.maxBrowserSteps ||
    next.usedLlmTokens > next.maxLlmTokens ||
    next.usedImageCalls > next.maxImageCalls ||
    next.usedCost > next.maxCost;
  return { budget: next, over };
}

/** P2：fake 计划问题名 → 市场工具名（recorded/live 双模式经注册表执行）。 */
const LEGACY_TO_MARKET: Record<string, string> = {
  competitor_research: "amazon/search",
  keyword_research: "keyword",
  review_voc: "voc",
  opportunity_priority: "sellersprite",
  supplier_research: "supplier_1688",
};

function nextQuestion(state: GraphState): ResearchQuestion | null {
  return (
    state.questions.find((q) => !state.dispatchedQuestionIds.includes(q.questionId)) ?? null
  );
}

function ctxFromState(state: GraphState) {
  return {
    candidate: state.candidateSnapshot ?? { id: state.candidateId, name: "", source: "", link: null, score: 0, keyword: "", riskLevel: "", status: "pending" },
  };
}

type NodeFn = (state: GraphState) => Promise<Partial<GraphState>> | Partial<GraphState>;

// ---------------------------------------------------------------------------
// Nodes (deps injected via closure)
// ---------------------------------------------------------------------------

function makeNodes(deps: GraphDeps): Record<string, NodeFn> {
  const loadContext: NodeFn = async (state) => {
    try {
      const ctx = await deps.domain.loadContext({ candidateId: state.candidateId });
      return {
        status: "running",
        currentNode: "load_context",
        contextHash: ctx.contextHash,
        candidateSnapshot: ctx.candidate,
        lastError: null,
      };
    } catch {
      return failState("load_context", { code: "WRONG_ENTITY", recoverable: false, safeMessage: "candidate not found" });
    }
  };

  const validateIdentity: NodeFn = async (state) => {
    const result = await deps.domain.validateIdentity(ctxFromState(state));
    if (!result.ok) {
      return failState("validate_identity", { code: "WRONG_ENTITY", recoverable: false, safeMessage: result.reason ?? "identity ambiguous" });
    }
    return { status: "running", currentNode: "validate_identity" };
  };

  const assessGaps: NodeFn = async (state) => {
    return { status: "running", currentNode: "assess_gaps" };
  };

  const buildPlan: NodeFn = async (state) => {
    const plan = deps.tools.plan({ contextHash: state.contextHash, budgetInputHash: String(state.budget.usedLlmTokens) });
    const decision = interrupt<InterruptValue, ResumePayload>({
      kind: "human_decision",
      reasonCode: "PLAN_REVIEW",
      node: "build_plan",
      instructions: "Review the proposed research plan and approve or stop.",
      plan,
    } satisfies InterruptValue);
    const human = decision as HumanDecisionPayload;
    if (human.kind !== "human_decision" || human.decision === "stop") {
      return { status: "cancelled", currentNode: "cancel", wait: null, lastEvent: ev("build_plan", "human_decision", { decision: "stop" }) };
    }
    return {
      status: "running",
      currentNode: "build_plan",
      plan,
      questions: plan.questions,
      planRevision: 1,
      wait: null,
      lastEvent: ev("build_plan", "human_decision", { decision: "continue" }),
    };
  };

  const dispatchTool: NodeFn = async (state) => {
    const question = nextQuestion(state);
    if (!question) {
      return failState("dispatch_tool", { code: "UNKNOWN_RECOVERABLE", recoverable: true, safeMessage: "no remaining question" });
    }
    // P2：市场工具经注册表（recorded/live）；fake 计划问题名映射到市场工具
    const marketName: string | null = deps.marketTools && (LEGACY_TO_MARKET[question.toolName] || (MARKET_TOOL_NAMES as readonly string[]).includes(question.toolName)) ? (LEGACY_TO_MARKET[question.toolName] ?? question.toolName) : null;
    let toolResult: ToolResult = deps.tools.tool({ toolName: question.toolName, questionId: question.questionId, inputHash: question.inputHash });
    let envResult: ToolResultEnvelope | null = null;
    if (marketName && deps.marketTools) {
      const targetEntity = typeof question.input?.offerId === "string" ? String(question.input.offerId) : typeof question.input?.targetEntity === "string" ? String(question.input.targetEntity) : state.candidateSnapshot?.name || state.candidateId;
      const envelope = buildToolEnvelope({
        runId: state.runId,
        questionId: question.questionId,
        toolName: marketName,
        targetEntity,
        marketplace: marketName.startsWith("amazon") ? "amazon.com" : marketName === "supplier_1688" ? "1688.com" : "US",
        inputHash: question.inputHash,
        idempotencyKey: buildIdempotencyKey({ runId: state.runId, questionId: question.questionId, toolName: marketName, inputHash: question.inputHash }),
        budget: { maxCost: state.budget.maxCost, currency: state.budget.currency, maxBrowserSteps: state.budget.maxBrowserSteps },
      });
      envResult = await deps.marketTools.execute(envelope);
      if (envResult.status === "waiting_auth") {
        return { status: "waiting_auth", currentNode: "dispatch_tool", wait: { kind: "authentication", reasonCode: envResult.errors[0]?.code ?? "AUTH_REQUIRED", instructions: "工具需要人工接管（登录/验证码）。", requestedAt: new Date().toISOString() }, lastEvent: ev("dispatch_tool", "waiting_human", { reason: envResult.errors[0]?.code }) };
      }
      if (envResult.status === "budget_exceeded") {
        return { status: "paused_budget", currentNode: "dispatch_tool", wait: { kind: "budget", reasonCode: "BUDGET_EXCEEDED", requestedAt: new Date().toISOString() }, lastEvent: ev("dispatch_tool", "budget_paused", {}) };
      }
      if (envResult.status === "stopped_error") {
        const code = envResult.errors[0]?.code ?? "UNKNOWN_RECOVERABLE";
        const recoverable = code === "DOM_CHANGED" || code === "RATE_LIMITED" || code === "TIMEOUT" || code === "SCHEMA_INVALID" || code === "SOURCE_STALE";
        return failState("dispatch_tool", { code, recoverable, safeMessage: envResult.errors[0]?.safeMessage });
      }
      if (envResult.status !== "ok" && envResult.status !== "no_results") {
        return failState("dispatch_tool", { code: "UNKNOWN_RECOVERABLE", recoverable: true, safeMessage: "tool status " + envResult.status });
      }
      toolResult = { toolName: marketName, outputHash: sha256(stableStringify(envResult)), payload: { envelope: envResult }, ok: envResult.status === "ok" };
    }
    const budget = consumeBudget(state.budget, { browserSteps: 1, llmTokens: 50, cost: 0.05 });
    if (budget.over) {
      interrupt<InterruptValue, ResumePayload>({ kind: "budget", reasonCode: "BUDGET_EXCEEDED", node: "dispatch_tool" } satisfies InterruptValue);
      return {
        status: "paused_budget",
        currentNode: "dispatch_tool",
        budget: budget.budget,
        wait: { kind: "budget", reasonCode: "BUDGET_EXCEEDED", requestedAt: new Date().toISOString() },
      };
    }
    return {
      status: "running",
      currentNode: "dispatch_tool",
      activeQuestionId: question.questionId,
      activeToolCallId: `call-${question.inputHash.slice(0, 12)}`,
      activeToolName: marketName ?? question.toolName,
      activeInputHash: question.inputHash,
      activeToolResult: toolResult,
      activeToolEnvelope: envResult,
      dispatchedQuestionIds: [...state.dispatchedQuestionIds, question.questionId],
      budget: budget.budget,
      lastEvent: ev("dispatch_tool", "tool_dispatched", { toolName: marketName ?? question.toolName, questionId: question.questionId, inputHash: question.inputHash }),
    };
  };

  const validateOutput: NodeFn = async (state) => {
    // P2：市场工具结果已由注册表 envelope 校验（validateToolResult）；不再走 fake 校验。
    const validation = state.activeToolEnvelope ? { valid: true, reason: "envelope-validated" } : deps.tools.validate({ toolResult: state.activeToolResult ?? { toolName: "unknown", outputHash: "", payload: {}, ok: false }, questionId: state.activeQuestionId ?? "" });
    if (!validation.valid) {
      return failState("validate_output", { code: "SCHEMA_INVALID", recoverable: true, safeMessage: validation.reason });
    }
    return {
      status: "running",
      currentNode: "validate_output",
      lastValidation: validation,
      lastEvent: ev("validate_output", "tool_result_validated", { valid: true }),
    };
  };

  const applyEvidence = async (
    state: GraphState,
    toolResult: ToolResult,
    questionId: string,
    idemKey: string,
  ): Promise<Partial<GraphState>> => {
    let evidenceV2Items: EvidenceItemV2[] = [];
    if (state.activeToolEnvelope && state.activeToolEnvelope.status === "ok") {
      const env = state.activeToolEnvelope;
      const data = (env.data ?? {}) as Record<string, unknown>;
      const type: EvidenceItemV2["type"] =
        state.activeToolName === "amazon/search" || state.activeToolName === "amazon/detail" ? "amazon_page" :
        state.activeToolName === "keyword" ? "keyword" :
        state.activeToolName === "voc" ? "voc" : "sellersprite";
      const item: EvidenceItemV2 = {
        evidenceId: `ev-${questionId}-${state.evidenceRevision + 1}`,
        type,
        entity: String(env.observedEntity ?? state.candidateId),
        marketplace: "US",
        observedAt: env.capturedAt,
        sourceRef: env.rawArtifactRefs?.[0]?.ref ?? state.activeToolName ?? "recorded",
        fields: {
          asin: data.asin ?? undefined,
          title: data.title ?? undefined,
          price: data.price ?? undefined,
          rating: data.rating ?? undefined,
          reviewCount: data.reviewCount ?? undefined,
          ...(data.themes ? { themes: data.themes } : {}),
          ...(data.keywords ? { keywords: data.keywords } : {}),
        },
        rawRef: env.rawArtifactRefs?.[0]?.ref,
        warnings: (env.warnings ?? []).map((w) => w.message),
      };
      const v = validateEvidenceForMerge(item);
      if (v.ok) { evidenceV2Items = [item]; }
    }
    const evidenceItem = deps.tools.evidence({ toolResult, questionId });
    await deps.journal.commit({ runId: state.runId, idempotencyKey: idemKey });
    const evidenceRevision = state.evidenceRevision + 1;
    return {
      status: "running",
      currentNode: "merge_evidence",
      evidence: [evidenceItem],
      ...(evidenceV2Items.length ? { evidenceV2: evidenceV2Items, activeToolEnvelope: null } : {}),
      evidenceRevision,
      activeQuestionId: null,
      activeToolResult: null,
      lastEvent: ev("merge_evidence", "evidence_merged", { evidenceRevision, count: state.evidence.length + 1 }),
  };
    };
  const mergeEvidence: NodeFn = async (state) => {
    const toolResult = state.activeToolResult;
    if (!toolResult) {
      return failState("merge_evidence", { code: "UNKNOWN_RECOVERABLE", recoverable: true, safeMessage: "no tool result" });
    }
    const questionId = state.activeQuestionId ?? "";
    const inputHash = state.activeInputHash ?? "";
    const toolName = state.activeToolName ?? "";
    const idemKey = buildIdempotencyKey({ runId: state.runId, questionId, toolName, inputHash });
    const decision = await deps.journal.resolve(
      { runId: state.runId, idempotencyKey: idemKey, inputHash, action: toolName },
      { explicitRetry: state.retryMode },
    );
    if (decision.kind === "conflict") {
      return failState("merge_evidence", { code: "SCHEMA_INVALID", recoverable: true, safeMessage: "idempotency conflict" });
    }
    if (decision.kind === "pending") {
      // 悬空 recorded：不自动重放；等待显式 retry。
      interrupt<InterruptValue, ResumePayload>({
        kind: "input",
        reasonCode: "IDEMPOTENCY_PENDING",
        node: "merge_evidence",
        instructions: "Side-effect not committed; explicit retry required.",
      });
      // resumed after retry: re-resolve with explicitRetry=true
      const retried = await deps.journal.resolve(
        { runId: state.runId, idempotencyKey: idemKey, inputHash, action: toolName },
        { explicitRetry: true },
      );
      if (retried.kind === "conflict") {
        return failState("merge_evidence", { code: "SCHEMA_INVALID", recoverable: true, safeMessage: "idempotency conflict" });
      }
      if (retried.kind === "pending") {
        return {
          status: "waiting_input",
          currentNode: "merge_evidence",
          wait: { kind: "input", reasonCode: "IDEMPOTENCY_PENDING", instructions: "Side-effect not committed; explicit retry required.", requestedAt: new Date().toISOString() },
          lastEvent: ev("merge_evidence", "tool_result_validated", { status: "pending_retry" }),
        };
      }
      if (retried.kind === "skip") {
        return {
          status: "running",
          currentNode: "merge_evidence",
          activeQuestionId: null,
          activeToolResult: null,
          lastEvent: ev("merge_evidence", "evidence_merged", { evidenceRevision: state.evidenceRevision, count: state.evidence.length, status: "skipped_duplicate" }),
        };
      }
      // retried apply/retry -> merge below
      return applyEvidence(state, toolResult, questionId, idemKey);
    }
    if (decision.kind === "skip") {
      return {
        status: "running",
        currentNode: "merge_evidence",
        activeQuestionId: null,
        activeToolResult: null,
        lastEvent: ev("merge_evidence", "evidence_merged", { evidenceRevision: state.evidenceRevision, count: state.evidence.length, status: "skipped_duplicate" }),
      };
    }
    return applyEvidence(state, toolResult, questionId, idemKey);
  };

  const detectConflicts: NodeFn = async (state) => {
    const { conflicts } = deps.tools.conflicts({ evidence: state.evidence });
    return {
      status: "running",
      currentNode: "detect_conflicts",
      conflicts,
      lastEvent: ev("detect_conflicts", "conflict_detected", { count: conflicts.length }),
    };
  };

  const revisePlan: NodeFn = async (state) => {
    const nextCount = Math.min(state.automaticPlanRevisionCount + 1, 2);
    const revised = deps.tools.plan({ contextHash: state.contextHash, budgetInputHash: String(state.planRevision) });
    const plan: ResearchPlan = { ...revised, planRevision: state.planRevision + 1, rationale: `revised due to conflicts (attempt ${nextCount})` };
    return {
      status: "revising",
      currentNode: "revise_plan",
      plan,
      questions: plan.questions,
      planRevision: state.planRevision + 1,
      automaticPlanRevisionCount: nextCount,
      lastEvent: ev("revise_plan", "plan_revised", { planRevision: state.planRevision + 1, rationale: plan.rationale }),
    };
  };

  const synthesizeMarket: NodeFn = async (state) => {
    const gaps = (state.activeToolEnvelope && state.activeToolEnvelope.status === "no_results")
      ? [{ question: "工具未返回结果（no_results）", reason: state.activeToolEnvelope.warnings?.[0]?.message ?? "fixture 缺失" }]
      : state.questions.filter((q) => !state.dispatchedQuestionIds.includes(q.questionId)).map((q) => ({ question: q.questionId, reason: "未执行" }));
    if (state.evidenceV2.length === 0 && state.evidence.length === 0) {
      return { status: "running", currentNode: "synthesize_market", gaps: gaps.map((x) => x.question), lastEvent: ev("synthesize_market", "node_completed", { evidenceCount: 0, gaps: gaps.length }) };
    }
    const report = buildMarketReport({
      reportId: `report-${state.runId.slice(0, 8)}`,
      runId: state.runId,
      candidateId: state.candidateId,
      marketplace: "US",
      evidence: state.evidenceV2,
      gaps,
      planRevision: state.planRevision,
    });
    const cited = validateReportCitations(report);
    if (!cited.ok) {
      return failState("synthesize_market", { code: "SCHEMA_INVALID", recoverable: true, safeMessage: "报告引用不完整" });
    }
    return { status: "running", currentNode: "synthesize_market", report, lastEvent: ev("synthesize_market", "node_completed", { evidenceCount: report.evidence.length, sections: report.sections.length }) };
  };
  const gateA: NodeFn = async (state) => {
    const decision = interrupt<InterruptValue, ResumePayload>({ kind: "human_decision", reasonCode: "GATE_A", node: "gate_a", instructions: "Review market synthesis and decide: continue_sourcing / needs_information / abandon." } satisfies InterruptValue);
    const human = decision as HumanDecisionPayload;
    const choice = human.kind === "human_decision" ? human.decision : "stop";
    if (human.kind !== "human_decision" || choice === "stop" || choice === "abandon") {
      return { status: "cancelled", currentNode: "cancel", wait: null, lastEvent: ev("gate_a", "human_decision", { decision: "abandon", note: human.note ?? null }) };
    }
    if (choice === "needs_information") {
      return { status: "running", currentNode: "gate_a", gateAChoice: "needs_information", wait: null, lastEvent: ev("gate_a", "human_decision", { decision: "needs_information", note: human.note ?? null }) };
    }
    return { status: "running", currentNode: "gate_a", gateAChoice: "continue_sourcing", wait: null, lastEvent: ev("gate_a", "human_decision", { decision: "continue_sourcing", note: human.note ?? null }) };
  };

  const supplierResearch: NodeFn = async (state) => {
    const inputHash = sha256(stableStringify({ supplier: state.candidateId }));
    const toolResult = deps.tools.tool({ toolName: "supplier_research", questionId: "supplier-research", inputHash });
    const budget = consumeBudget(state.budget, { browserSteps: 2, llmTokens: 80, cost: 0.08 });
    if (budget.over) {
      interrupt<InterruptValue, ResumePayload>({ kind: "budget", reasonCode: "BUDGET_EXCEEDED", node: "supplier_research" } satisfies InterruptValue);
      return { status: "paused_budget", currentNode: "supplier_research", budget: budget.budget, wait: { kind: "budget", reasonCode: "BUDGET_EXCEEDED", requestedAt: new Date().toISOString() } };
    }
    return {
      status: "running",
      currentNode: "supplier_research",
      budget: budget.budget,
      facts: { ...(state.facts ?? {}), supplier: toolResult.payload },
      lastEvent: ev("supplier_research", "tool_dispatched", { toolName: "supplier_research" }),
    };
  };

  const productFactGate: NodeFn = async (state) => {
    const decision = interrupt<InterruptValue, ResumePayload>({ kind: "human_decision", reasonCode: "FACT_GATE", node: "product_fact_gate", instructions: "Confirm the product facts before commercial feasibility." } satisfies InterruptValue);
    const human = decision as HumanDecisionPayload;
    if (human.kind !== "human_decision" || human.decision === "stop") {
      return { status: "cancelled", currentNode: "cancel", wait: null, lastEvent: ev("product_fact_gate", "human_decision", { decision: "stop" }) };
    }
    return { status: "running", currentNode: "product_fact_gate", factRevision: 1, wait: null, lastEvent: ev("product_fact_gate", "human_decision", { decision: "continue" }) };
  };

  const commercialCheck: NodeFn = async (state) => {
    // P4：确定性 Calculator 输出由 API POST /commercial 持久化到行 commercialJson；
    // 未提供输入时 → waiting_input（返回补信息路径）。
    const row = await deps.runStore.getRun(state.runId);
    let commercial: CalcOutput | null = null;
    if (row && row.commercialJson) {
      try { commercial = JSON.parse(row.commercialJson) as CalcOutput; } catch { commercial = null; }
    }
    if (!commercial) {
      const resumedInput = interrupt<InterruptValue, ResumePayload>({ kind: "input", reasonCode: "COMMERCIAL_INPUT_REQUIRED", node: "commercial_check", instructions: "请提供商业计算输入（采购价/MOQ/售价/尺寸重量/头程/佣金/履约/汇率）。" } satisfies InterruptValue);
      // resume 后重查：仍无计算输出 → 再次 interrupt
      const rowNow = await deps.runStore.getRun(state.runId);
      let calcNow: CalcOutput | null = null;
      if (rowNow && rowNow.commercialJson) { try { calcNow = JSON.parse(rowNow.commercialJson) as CalcOutput; } catch { calcNow = null; } }
      if (!calcNow) {
        interrupt<InterruptValue, ResumePayload>({ kind: "input", reasonCode: "COMMERCIAL_INPUT_REQUIRED", node: "commercial_check", instructions: "商业计算输入仍未提供。" } satisfies InterruptValue);
        return { status: "waiting_input", currentNode: "commercial_check", wait: { kind: "input", reasonCode: "COMMERCIAL_INPUT_REQUIRED", instructions: "请提供商业计算输入。", requestedAt: new Date().toISOString() }, lastEvent: ev("commercial_check", "waiting_human", { reason: "COMMERCIAL_INPUT_REQUIRED" }) };
      }
      void resumedInput;
      return { status: "waiting_input", currentNode: "commercial_check", wait: { kind: "input", reasonCode: "COMMERCIAL_INPUT_REQUIRED", instructions: "请提供商业计算输入。", requestedAt: new Date().toISOString() }, lastEvent: ev("commercial_check", "waiting_human", { reason: "COMMERCIAL_INPUT_REQUIRED" }) };
    }
    return { status: "running", currentNode: "commercial_check", commercial, lastEvent: ev("commercial_check", "node_completed", { scenario: "baseline" }) };
  };
  const gateB: NodeFn = async (state) => {

    const decision = interrupt<InterruptValue, ResumePayload>({ kind: "human_decision", reasonCode: "GATE_B", node: "gate_b", instructions: "Review commercial feasibility: content_ready / revise_product / needs_information / abandon." } satisfies InterruptValue);
    const human = decision as HumanDecisionPayload;
    const choice = human.kind === "human_decision" ? human.decision : "stop";
    if (human.kind !== "human_decision" || choice === "stop" || choice === "abandon") {
      return { status: "cancelled", currentNode: "cancel", wait: null, lastEvent: ev("gate_b", "human_decision", { decision: "abandon", note: human.note ?? null }) };
    }
    return { status: "running", currentNode: "gate_b", gateBChoice: choice, wait: null, lastEvent: ev("gate_b", "human_decision", { decision: choice, note: human.note ?? null }) };
  };

  const contentHandoff: NodeFn = async (state) => {
    const handoff = { factRevision: state.factRevision ?? 0, policyPackVersion: "policy.v1" };
    return { status: "running", currentNode: "content_handoff", handoff, policyPackVersion: "policy.v1" };
  };

  const contentSkills: NodeFn = async (state) => {
    // P5：内容草稿（Listing/Image/Guards 结果）由 API POST /content 经 Skills 管线生成并持久化到 contentJson；
    // 未生成时 → waiting_input（返回补信息/生成路径）。
    const row = await deps.runStore.getRun(state.runId);
    let contentDraft: unknown = null;
    if (row && row.contentJson) {
      try { contentDraft = JSON.parse(row.contentJson); } catch { contentDraft = null; }
    }
    if (!contentDraft) {
      const resumedInput = interrupt<InterruptValue, ResumePayload>({ kind: "input", reasonCode: "CONTENT_GENERATION_REQUIRED", node: "content_skills", instructions: "请先通过内容 Skills 管线生成 Listing/Image 草稿与 Guards 结果。" } satisfies InterruptValue);
      // resume 后重查：仍无内容 → 再次 interrupt（防止未生成即前进）
      const rowNow = await deps.runStore.getRun(state.runId);
      let draftNow: unknown = null;
      if (rowNow && rowNow.contentJson) { try { draftNow = JSON.parse(rowNow.contentJson); } catch { draftNow = null; } }
      if (!draftNow) {
        interrupt<InterruptValue, ResumePayload>({ kind: "input", reasonCode: "CONTENT_GENERATION_REQUIRED", node: "content_skills", instructions: "内容草稿仍未生成。" } satisfies InterruptValue);
        return { status: "waiting_input", currentNode: "content_skills", wait: { kind: "input", reasonCode: "CONTENT_GENERATION_REQUIRED", instructions: "请先生成内容草稿。", requestedAt: new Date().toISOString() }, lastEvent: ev("content_skills", "waiting_human", { reason: "CONTENT_GENERATION_REQUIRED" }) };
      }
      void resumedInput;
      return { status: "waiting_input", currentNode: "content_skills", wait: { kind: "input", reasonCode: "CONTENT_GENERATION_REQUIRED", instructions: "请先生成内容草稿。", requestedAt: new Date().toISOString() }, lastEvent: ev("content_skills", "waiting_human", { reason: "CONTENT_GENERATION_REQUIRED" }) };
    }
    const budget = consumeBudget(state.budget, { browserSteps: 0, llmTokens: 100, cost: 0.1 });
    if (budget.over) {
      interrupt<InterruptValue, ResumePayload>({ kind: "budget", reasonCode: "BUDGET_EXCEEDED", node: "content_skills" } satisfies InterruptValue);
      return { status: "paused_budget", currentNode: "content_skills", budget: budget.budget, wait: { kind: "budget", reasonCode: "BUDGET_EXCEEDED", requestedAt: new Date().toISOString() } };
    }
    return { status: "running", currentNode: "content_skills", content: contentDraft as ContentDraft, budget: budget.budget, lastEvent: ev("content_skills", "tool_dispatched", { toolName: "content_skills" }) };
  };

  const contentReview: NodeFn = async (state) => {
    const decision = interrupt<InterruptValue, ResumePayload>({ kind: "human_decision", reasonCode: "CONTENT_REVIEW", node: "content_review", instructions: "Review content: approve_export / request_revision / reject_asset." } satisfies InterruptValue);
    const human = decision as HumanDecisionPayload;
    const choice = human.kind === "human_decision" ? human.decision : "stop";
    if (human.kind !== "human_decision" || choice === "stop" || choice === "reject_asset") {
      return { status: "cancelled", currentNode: "cancel", wait: null, lastEvent: ev("content_review", "human_decision", { decision: choice === "reject_asset" ? "reject_asset" : "abandon", note: human.note ?? null }) };
    }
    if (choice === "request_revision") {
      return { status: "running", currentNode: "content_skills", wait: null, lastEvent: ev("content_review", "human_decision", { decision: "request_revision", note: human.note ?? null }) };
    }
    return { status: "running", currentNode: "content_review", wait: null, lastEvent: ev("content_review", "human_decision", { decision: "approve_export", note: human.note ?? null }) };
  };

  const complete: NodeFn = async () => {
    return { status: "completed", currentNode: "complete", lastEvent: ev("complete", "completed", {}) };
  };

  const fail: NodeFn = async (state) => {
    const recoverable = state.lastError?.recoverable ?? false;
    return { status: recoverable ? "failed_recoverable" : "failed_terminal", currentNode: "fail", lastEvent: ev("fail", "failed", { code: state.lastError?.code }) };
  };

  const cancel: NodeFn = async () => {
    return { status: "cancelled", currentNode: "cancel", lastEvent: ev("cancel", "cancelled", {}) };
  };

  return {
    load_context: loadContext,
    validate_identity: validateIdentity,
    assess_gaps: assessGaps,
    build_plan: buildPlan,
    dispatch_tool: dispatchTool,
    validate_output: validateOutput,
    merge_evidence: mergeEvidence,
    detect_conflicts: detectConflicts,
    revise_plan: revisePlan,
    synthesize_market: synthesizeMarket,
    gate_a: gateA,
    supplier_research: supplierResearch,
    product_fact_gate: productFactGate,
    commercial_check: commercialCheck,
    gate_b: gateB,
    content_handoff: contentHandoff,
    content_skills: contentSkills,
    content_review: contentReview,
    complete,
    fail,
    cancel,
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function terminalOr(next: ResearchRunNode) {
  return (state: GraphState): string => {
    if (state.status === "cancelled") return "cancel";
    if (state.status === "failed_terminal" || state.status === "failed_recoverable") return "fail";
    return next;
  };
}

function detectConflictsRoute(state: GraphState): string {
  if (state.status === "cancelled") return "cancel";
  if (state.status === "failed_terminal" || state.status === "failed_recoverable") return "fail";
  if (state.conflicts.length > 0 && state.automaticPlanRevisionCount < 2) return "revise_plan";
  return "synthesize_market";
}

/** 逐问题循环：合并证据后，若仍有未派发问题则继续 dispatch_tool，否则进入冲突检测。 */
function mergeEvidenceRoute(state: GraphState): string {
  if (state.status === "cancelled") return "cancel";
  if (state.status === "failed_terminal" || state.status === "failed_recoverable") return "fail";
  if (nextQuestion(state)) return "dispatch_tool";
  return "detect_conflicts";
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

function gateARoute(state: GraphState): string {
  if (state.gateAChoice === "needs_information") return "assess_gaps";
  return "supplier_research";
}

function gateBRoute(state: GraphState): string {
  if (state.gateBChoice === "revise_product") return "product_fact_gate";
  if (state.gateBChoice === "needs_information") return "commercial_check";
  return "content_handoff";
}

function contentReviewRoute(state: GraphState): string {
  if (state.lastEvent?.payloadJson && state.lastEvent.payloadJson.includes("request_revision")) return "content_skills";
  return "complete";
}

export function buildGraph(deps: GraphDeps, checkpointer: BaseCheckpointSaver): ResearchGraph {
  const nodes = makeNodes(deps);
  const g = new StateGraph(GraphStateAnnotation);

  const add = (key: string, fn: NodeFn) => (g as any).addNode(key, fn);

  add("load_context", nodes.load_context);
  add("validate_identity", nodes.validate_identity);
  add("assess_gaps", nodes.assess_gaps);
  add("build_plan", nodes.build_plan);
  add("dispatch_tool", nodes.dispatch_tool);
  add("validate_output", nodes.validate_output);
  add("merge_evidence", nodes.merge_evidence);
  add("detect_conflicts", nodes.detect_conflicts);
  add("revise_plan", nodes.revise_plan);
  add("synthesize_market", nodes.synthesize_market);
  add("gate_a", nodes.gate_a);
  add("supplier_research", nodes.supplier_research);
  add("product_fact_gate", nodes.product_fact_gate);
  add("commercial_check", nodes.commercial_check);
  add("gate_b", nodes.gate_b);
  add("content_handoff", nodes.content_handoff);
  add("content_skills", nodes.content_skills);
  add("content_review", nodes.content_review);
  add("complete", nodes.complete);
  add("fail", nodes.fail);
  add("cancel", nodes.cancel);

  const edge = (from: string, to: string) => (g as any).addEdge(from, to);
  const cond = (from: string, fn: (s: GraphState) => string, pathMap: string[]) => (g as any).addConditionalEdges(from, fn, pathMap);

  edge(START, "load_context");
  cond("load_context", terminalOr("validate_identity"), ["validate_identity", "fail", "cancel"]);
  cond("validate_identity", terminalOr("assess_gaps"), ["assess_gaps", "fail", "cancel"]);
  cond("assess_gaps", terminalOr("build_plan"), ["build_plan", "fail", "cancel"]);
  cond("build_plan", terminalOr("dispatch_tool"), ["dispatch_tool", "fail", "cancel"]);
  cond("dispatch_tool", terminalOr("validate_output"), ["validate_output", "fail", "cancel"]);
  cond("validate_output", terminalOr("merge_evidence"), ["merge_evidence", "fail", "cancel"]);
  cond("merge_evidence", mergeEvidenceRoute, ["dispatch_tool", "detect_conflicts", "fail", "cancel"]);
  cond("detect_conflicts", detectConflictsRoute, ["revise_plan", "synthesize_market", "fail", "cancel"]);
  cond("revise_plan", terminalOr("dispatch_tool"), ["dispatch_tool", "fail", "cancel"]);
  cond("synthesize_market", terminalOr("gate_a"), ["gate_a", "fail", "cancel"]);
  cond("gate_a", gateARoute, ["supplier_research", "assess_gaps", "cancel", "fail"]);
  cond("supplier_research", terminalOr("product_fact_gate"), ["product_fact_gate", "fail", "cancel"]);
  cond("product_fact_gate", terminalOr("commercial_check"), ["commercial_check", "fail", "cancel"]);
  cond("commercial_check", terminalOr("gate_b"), ["gate_b", "fail", "cancel"]);
  cond("gate_b", gateBRoute, ["content_handoff", "product_fact_gate", "commercial_check", "cancel", "fail"]);
  cond("content_handoff", terminalOr("content_skills"), ["content_skills", "fail", "cancel"]);
  cond("content_skills", terminalOr("content_review"), ["content_review", "fail", "cancel"]);
  cond("content_review", contentReviewRoute, ["complete", "content_skills", "cancel", "fail"]);
  edge("complete", END);
  edge("fail", END);
  edge("cancel", END);

  return (g as any).compile({ checkpointer }) as ResearchGraph;
}
// ---------------------------------------------------------------------------
// Projection: graph state -> ResearchRunState (stateJson)
// ---------------------------------------------------------------------------

export function projectState(
  state: GraphState,
  currentRevision: number,
  run: RunRow,
  checkpointId?: string,
  statusOverride?: ResearchRunStatus,
  currentNodeOverride?: ResearchRunNode,
  waitOverride?: ResearchRunWait | null,
): ResearchRunState {
  const now = new Date().toISOString();
  const nextRevision = currentRevision + 1;
  return {
    schemaVersion: RESEARCH_RUN_SCHEMA_VERSION,
    runId: state.runId,
    candidateId: state.candidateId,
    ownerScope: state.ownerScope,
    sandboxId: state.sandboxId ?? null,
    mode: state.mode,
    status: statusOverride ?? state.status,
    currentNode: currentNodeOverride ?? state.currentNode,
    revision: nextRevision,
    planRevision: state.planRevision,
    automaticPlanRevisionCount: state.automaticPlanRevisionCount,
    activeQuestionId: state.activeQuestionId ?? null,
    activeToolCallId: state.activeToolCallId ?? null,
    evidenceRevision: state.evidenceRevision,
    factRevision: state.factRevision ?? null,
    policyPackVersion: state.policyPackVersion ?? null,
    budget: state.budget,
    wait: waitOverride === undefined ? (state.wait ?? null) : waitOverride,
    checkpoint: {
      checkpointId: checkpointId ?? run.id,
      businessRevision: nextRevision,
      createdAt: now,
    },
    lastError: state.lastError ?? null,
    createdAt: toIso(run.createdAt),
    updatedAt: now,
    completedAt: state.status === "completed" ? now : null,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type RunStepResult = {
  status: ResearchRunStatus;
  currentNode: ResearchRunNode;
  wait: ResearchRunWait | null;
  lastError: ResearchRunError | null;
  completed: boolean;
  cancelled: boolean;
  run: RunRow;
  state: ResearchRunState;
  events: ResearchRunEvent[];
};

export type StartRunInput = {
  runId: string;
  candidateId: string;
  ownerScope: string;
  sandboxId: string | null;
  mode: "local_live" | "public_replay";
  budget?: ResearchBudget;
};

function initialInput(input: StartRunInput, budget: ResearchBudget): GraphState {
  return {
    runId: input.runId,
    candidateId: input.candidateId,
    ownerScope: input.ownerScope,
    sandboxId: input.sandboxId,
    mode: input.mode,
    status: "running",
    currentNode: "load_context",
    planRevision: 0,
    automaticPlanRevisionCount: 0,
    activeQuestionId: null,
    activeToolCallId: null,
    activeToolName: null,
    activeInputHash: null,
    activeToolResult: null,
    evidenceRevision: 0,
    factRevision: null,
    policyPackVersion: null,
    budget,
    wait: null,
    lastError: null,
    contextHash: "",
    candidateSnapshot: null,
    plan: null,
    questions: [],
    dispatchedQuestionIds: [],
    evidence: [],
    conflicts: [],
    facts: null,
    feasibility: null,
    content: null,
    handoff: null,
    lastValidation: null,
    lastEvent: null,
    retryMode: false,
      gateAChoice: null,
      gateBChoice: null,
      commercial: null,
      activeToolEnvelope: null,
      evidenceV2: [],
      report: null,
  };
}

/** 从已存在的 ResearchRunState 构建 graph 初始输入（startRun 用）。 */
function initialInputFromRun(state: ResearchRunState): GraphState {
  return {
    runId: state.runId,
    candidateId: state.candidateId,
    ownerScope: state.ownerScope ?? "",
    sandboxId: state.sandboxId ?? null,
    mode: state.mode,
    status: "running",
    currentNode: "load_context",
    planRevision: state.planRevision,
    automaticPlanRevisionCount: state.automaticPlanRevisionCount,
    activeQuestionId: null,
    activeToolCallId: null,
    activeToolName: null,
    activeInputHash: null,
    activeToolResult: null,
    evidenceRevision: state.evidenceRevision,
    factRevision: state.factRevision ?? null,
    policyPackVersion: state.policyPackVersion ?? null,
    budget: state.budget,
    wait: null,
    lastError: null,
    contextHash: "",
    candidateSnapshot: null,
    plan: null,
    questions: [],
    dispatchedQuestionIds: [],
    evidence: [],
    conflicts: [],
    facts: null,
    feasibility: null,
    content: null,
    handoff: null,
    lastValidation: null,
    lastEvent: null,
    retryMode: false,
      gateAChoice: null,
      gateBChoice: null,
      commercial: null,
      activeToolEnvelope: null,
      evidenceV2: [],
      report: null,
  };
}

export class ResearchRunRunner {
  private readonly deps: GraphDeps;

  constructor(deps: GraphDeps) {
    this.deps = deps;
  }

  async startRun(input: StartRunInput): Promise<RunStepResult> {
    const budget = input.budget ?? initialBudget();
    await this.deps.runStore.createRun({
      id: input.runId,
      candidateId: input.candidateId,
      ownerScope: input.ownerScope,
      sandboxId: input.sandboxId,
      mode: input.mode,
    });
    const config = this.configFor(input.runId);
    const state = initialInput(input, budget);
    this.enteredNodes.set(input.runId, new Set());
    try {
      const graph = this.compile(input.runId);
      return await this.drive(input.runId, graph, config, state);
    } finally {
      this.close(input.runId);
    }
  }

  /**
   * API 契约 startRun：驱动一个已存在的运行（draft/当前 checkpoint）到下一个等待点或终态。
   * 不创建运行；校验 graphVersion + expectedRevision + 可操作性。
   */
  async runExisting(runId: string, expectedRevision: number): Promise<RunStepResult> {
    await this.deps.runStore.assertGraphVersion(runId);
    const run = await this.deps.runStore.getRun(runId);
    if (!run) throw new RunStoreError("NOT_FOUND", `Run ${runId} not found`);
    if (isTerminalStatus(run.status as ResearchRunStatus)) {
      throw new RunStoreError("TERMINAL_FROZEN", `Run ${runId} is terminal (${run.status})`, run.revision);
    }
    if (run.revision !== expectedRevision) {
      throw new RunStoreError("REVISION_CONFLICT", `Run ${runId} revision ${run.revision} != expected ${expectedRevision}`, run.revision);
    }
    const state = this.deps.runStore.readState(run);
    if (!state) throw new RunStoreError("NOT_FOUND", `Run ${runId} has no persisted state`);
    const input = initialInputFromRun(state);
    const config = this.configFor(runId);
    this.enteredNodes.set(runId, new Set());
    try {
      const graph = this.compile(runId);
      return await this.drive(runId, graph, config, input);
    } finally {
      this.close(runId);
    }
  }

  async resumeRun(
    runId: string,
    payload: ResumePayload,
    expectedRevision: number,
  ): Promise<RunStepResult> {
    // resume gate: graphVersion + three-way consistency + expectedRevision + candidate/budget revalidation
    await this.deps.runStore.assertGraphVersion(runId);
    const run = await this.verifyConsistency(runId);
    if (run.status === "cancelled" || run.status === "completed" || run.status === "failed_terminal") {
      throw new RunStoreError("TERMINAL_FROZEN", `Run ${runId} is terminal (${run.status})`, run.revision);
    }
    if (run.revision !== expectedRevision) {
      throw new RunStoreError("REVISION_CONFLICT", `Run ${runId} revision ${run.revision} != expected ${expectedRevision}`, run.revision);
    }
    // candidate + budget revalidation (fail-closed)
    const state = await this.readCheckpointState(runId);
    const identity = await this.deps.domain.revalidateIdentity(ctxFromState(state));
    if (!identity.ok) {
      throw new RunStoreError("RESUME_GATE_FAILED", `identity revalidation failed: ${identity.reason ?? "unknown"}`, run.revision);
    }
    const budgetOk = await this.deps.domain.revalidateBudget({ budget: state.budget });
    if (!budgetOk.ok) {
      throw new RunStoreError("RESUME_GATE_FAILED", `budget revalidation failed: ${budgetOk.reason ?? "unknown"}`, run.revision);
    }
    const config = this.configFor(runId);
    if (!this.enteredNodes.has(runId)) this.enteredNodes.set(runId, new Set());
    try {
      const graph = this.compile(runId);
      // 显式 retry：置 retryMode，允许 journal recorded/failed 悬空条目重执行。
      if (payload.kind === "retry") {
        await graph.updateState(config, { retryMode: true } as never);
      }
      const input = new Command<ResumePayload>({ resume: payload });
      return await this.drive(runId, graph, config, input);
    } finally {
      this.close(runId);
    }
  }

  async cancelRun(runId: string, expectedRevision: number): Promise<RunRow> {
    return this.deps.runStore.cancel(runId, expectedRevision);
  }

  async getState(runId: string): Promise<GraphState | null> {
    return this.readCheckpointState(runId);
  }

  private configFor(runId: string) {
    return { configurable: { thread_id: runId } };
  }

  private compile(runId: string) {
    const handle = openCheckpoint(this.deps.checkpointPath(runId));
    this.checkpointHandles.set(runId, handle);
    return buildGraph(this.deps, handle.saver);
  }

  private close(runId: string) {
    const handle = this.checkpointHandles.get(runId);
    if (handle) {
      handle.close();
      this.checkpointHandles.delete(runId);
    }
  }

  private checkpointHandles = new Map<string, ReturnType<typeof openCheckpoint>>();
  private enteredNodes = new Map<string, Set<string>>();

  /**
   * P1-C 三方一致性 fail_closed（§7.3）：
   * - run 行缺失 → NOT_FOUND；
   * - checkpoint 引用未提交 revision（stateJson.checkpoint.businessRevision > 行 revision）→ 拒绝。
   * journal committed 但 checkpoint 缺失由幂等 journal（skip_duplicate）兜底，不重复副作用。
   */
  private async verifyConsistency(runId: string): Promise<RunRow> {
    const run = await this.deps.runStore.getRun(runId);
    if (!run) throw new RunStoreError("NOT_FOUND", `Run ${runId} not found`);
    const state = this.deps.runStore.readState(run);
    if (state && state.checkpoint && state.checkpoint.businessRevision > run.revision) {
      throw new RunStoreError(
        "RESUME_GATE_FAILED",
        `Run ${runId} checkpoint references uncommitted revision ${state.checkpoint.businessRevision} > row ${run.revision}`,
        run.revision,
      );
    }
    return run;
  }

  private async readCheckpointState(runId: string): Promise<GraphState> {
    const config = this.configFor(runId);
    const graph = this.compile(runId);
    try {
      const snapshot = await graph.getState(config);
      return snapshot.values as unknown as GraphState;
    } finally {
      this.close(runId);
    }
  }

  private async drive(
    runId: string,
    graph: ResearchGraph,
    config: Record<string, unknown>,
    input: any,
  ): Promise<RunStepResult> {
    const entered = this.enteredNodes.get(runId) ?? new Set<string>();
    let lastRun: RunRow | null = null;

    const stream = await graph.stream(input, { ...config, streamMode: "updates" });
    for await (const chunk of stream as AsyncIterable<Record<string, unknown>>) {
      if (chunk[INTERRUPT_KEY]) {
        const interruptValue = (chunk[INTERRUPT_KEY] as { value: InterruptValue }[])[0].value;
        lastRun = await this.persistInterrupt(runId, graph, config, interruptValue, entered);
        return this.toResult(lastRun, interruptValue);
      }
      const nodeName = Object.keys(chunk)[0];
      const update = chunk[nodeName] as Partial<GraphState>;
      lastRun = await this.persistNode(runId, graph, config, nodeName as ResearchRunNode, update, entered);
      if (lastRun.status === "cancelled" || lastRun.status === "completed" || lastRun.status === "failed_terminal" || lastRun.status === "failed_recoverable") {
        return this.toResult(lastRun, null);
      }
    }

    // Stream ended without interrupt / terminal -> read final state
    if (!lastRun) {
      const snapshot = await graph.getState(config);
      const values = snapshot.values as unknown as GraphState;
      lastRun = await this.persistFinal(runId, graph, config, values, entered);
    }
    return this.toResult(lastRun, null);
  }

  private async persistInterrupt(
    runId: string,
    graph: ResearchGraph,
    config: Record<string, unknown>,
    value: InterruptValue,
    entered: Set<string>,
  ): Promise<RunRow> {
    const snapshot = await graph.getState(config);
    const state = snapshot.values as unknown as GraphState;
    const node = value.node;
    entered.add(node);
    const events: Omit<ResearchRunEvent, "seq">[] = [];
    events.push(ev(node, "node_entered", {}));
    if (node === "build_plan" && value.plan) {
      events.push(ev("build_plan", "plan_created", { planRevision: value.plan.planRevision, questionCount: value.plan.questions.length }));
    }
    const status: ResearchRunStatus = value.kind === "budget" ? "paused_budget" : value.kind === "human_decision" ? "waiting_human" : value.kind === "authentication" ? "waiting_auth" : "waiting_input";
    const wait: ResearchRunWait = { kind: value.kind === "budget" ? "budget" : value.kind === "authentication" ? "authentication" : value.kind === "input" ? "input" : "human_decision", reasonCode: value.reasonCode, instructions: value.instructions, requestedAt: new Date().toISOString() };
    events.push(ev(node, "waiting_human", { reasonCode: value.reasonCode, kind: wait.kind }));
    return this.save(runId, state, { status, currentNode: node, wait }, events);
  }

  private async persistNode(
    runId: string,
    graph: ResearchGraph,
    config: Record<string, unknown>,
    node: ResearchRunNode,
    update: Partial<GraphState>,
    entered: Set<string>,
  ): Promise<RunRow> {
    const snapshot = await graph.getState(config);
    const state = snapshot.values as unknown as GraphState;
    const events: Omit<ResearchRunEvent, "seq">[] = [];
    if (!entered.has(node)) {
      events.push(ev(node, "node_entered", {}));
      entered.add(node);
    }
    if (update.lastEvent) {
      events.push(update.lastEvent);
    }
    if (node === "complete") {
      events.push(ev("complete", "completed", {}));
    }
    events.push(ev(node, "node_completed", {}));
    return this.save(runId, state, { status: state.status, currentNode: state.currentNode }, events);
  }

  private async persistFinal(
    runId: string,
    graph: ResearchGraph,
    config: Record<string, unknown>,
    state: GraphState,
    entered: Set<string>,
  ): Promise<RunRow> {
    const events: Omit<ResearchRunEvent, "seq">[] = [];
    if (!entered.has(state.currentNode)) {
      events.push(ev(state.currentNode, "node_entered", {}));
    }
    events.push(ev(state.currentNode, "node_completed", {}));
    return this.save(runId, state, { status: state.status, currentNode: state.currentNode }, events);
  }

  private async save(
    runId: string,
    state: GraphState,
    patch: { status: ResearchRunStatus; currentNode: ResearchRunNode; wait?: ResearchRunWait },
    events: Omit<ResearchRunEvent, "seq">[],
  ): Promise<RunRow> {
    const run = await this.deps.runStore.getRun(runId);
    if (!run) throw new RunStoreError("NOT_FOUND", `Run ${runId} not found`);
    const projected = projectState(state, run.revision, run, undefined, patch.status, patch.currentNode, patch.wait);
    const stateJson = JSON.stringify(projected);
    return this.deps.runStore.saveRun(runId, run.revision, {
      stateJson,
      status: patch.status,
      currentNode: patch.currentNode,
      planRevision: state.planRevision,
      ...(state.report ? { reportJson: JSON.stringify(state.report) } : {}),
      ...(state.commercial ? { commercialJson: JSON.stringify(state.commercial) } : {}),
      automaticPlanRevisionCount: state.automaticPlanRevisionCount,
      events,
    });
  }

  private toResult(run: RunRow, interruptValue: InterruptValue | null): RunStepResult {
    const state = this.deps.runStore.readState(run);
    const events = this.deps.runStore.readEvents(run);
    const fallback = this.emptyState(run);
    return {
      status: state?.status ?? fallback.status,
      currentNode: (state?.currentNode ?? fallback.currentNode) as ResearchRunNode,
      wait: state?.wait ?? null,
      lastError: state?.lastError ?? null,
      completed: state?.status === "completed",
      cancelled: state?.status === "cancelled",
      run,
      state: state ?? fallback,
      events,
    };
  }

  private emptyState(run: RunRow): ResearchRunState {
    const now = new Date().toISOString();
    const budget: ResearchBudget = {
      maxWallClockMs: 120_000,
      maxBrowserSteps: 100,
      maxLlmTokens: 100_000,
      maxImageCalls: 20,
      maxCost: 10,
      currency: "USD",
      usedBrowserSteps: 0,
      usedLlmTokens: 0,
      usedImageCalls: 0,
      usedCost: 0,
    };
    return {
      schemaVersion: RESEARCH_RUN_SCHEMA_VERSION,
      runId: run.id,
      candidateId: run.candidateId,
      ownerScope: run.ownerScope,
      sandboxId: run.sandboxId,
      mode: (run.mode === "public_replay" ? "public_replay" : "local_live"),
      status: (run.status as ResearchRunStatus) ?? "draft",
      currentNode: (run.currentNode as ResearchRunNode) ?? "load_context",
      revision: run.revision,
      planRevision: run.planRevision,
      automaticPlanRevisionCount: run.automaticPlanRevisionCount,
      activeQuestionId: null,
      activeToolCallId: null,
      evidenceRevision: 0,
      factRevision: null,
      policyPackVersion: null,
      budget,
      wait: null,
      checkpoint: null,
      lastError: null,
      createdAt: toIso(run.createdAt),
      updatedAt: toIso(run.updatedAt),
      completedAt: null,
    };
  }
}

export const INTERRUPT_KEY = "__interrupt__";
// ---------------------------------------------------------------------------
// API 契约（Lead 冻结）：GraphRunResult + startRun/resumeRun/cancelRun
// ---------------------------------------------------------------------------

export type GraphRunResult =
  | { ok: true; state: ResearchRunState; events: ResearchRunEvent[] }
  | {
      ok: false;
      code:
        | "REVISION_CONFLICT"
        | "RUN_NOT_FOUND"
        | "RUN_NOT_ACTIONABLE"
        | "GRAPH_VERSION_MISMATCH"
        | "CANDIDATE_INVALID"
        | "BUDGET_EXCEEDED"
        | "INTERNAL";
      latestRevision?: number;
      safeMessage?: string;
    };

function defaultDeps(): GraphDeps {
  return {
    domain: new DomainAdapter(prisma as unknown as DomainDb),
    tools: new FakeToolRegistry(),
    journal: createPrismaJournal() as unknown as SideEffectJournal,
    runStore: createPrismaRunStore() as unknown as ResearchRunStore,
    checkpointPath: (runId: string) => checkpointDbPath(runId),
    marketTools: { names: MARKET_TOOL_NAMES as readonly string[], execute: executeMarketTool },
  };
}

let depsFactory: () => GraphDeps = defaultDeps;

/** 测试专用：注入 deps 工厂（不在公开契约内；API 路由不依赖）。 */
export function setGraphDepsFactoryForTest(factory: () => GraphDeps): void {
  depsFactory = factory;
}

function toGraphRunResult(result: RunStepResult): GraphRunResult {
  return { ok: true, state: result.state, events: result.events };
}

function mapError(error: unknown): GraphRunResult {
  if (error instanceof RunStoreError) {
    if (error.code === "REVISION_CONFLICT") {
      return { ok: false, code: "REVISION_CONFLICT", latestRevision: error.latestRevision, safeMessage: error.message };
    }
    if (error.code === "NOT_FOUND") {
      return { ok: false, code: "RUN_NOT_FOUND", safeMessage: error.message };
    }
    if (error.code === "TERMINAL_FROZEN") {
      return { ok: false, code: "RUN_NOT_ACTIONABLE", latestRevision: error.latestRevision, safeMessage: error.message };
    }
    if (error.code === "GRAPH_VERSION_MISMATCH") {
      return { ok: false, code: "GRAPH_VERSION_MISMATCH", latestRevision: error.latestRevision, safeMessage: error.message };
    }
    if (error.code === "RESUME_GATE_FAILED") {
      const msg = error.message;
      const isBudget = /budget/i.test(msg);
      const isConsistency = /uncommitted|consistency/i.test(msg);
      return {
        ok: false,
        code: isBudget ? "BUDGET_EXCEEDED" : isConsistency ? "INTERNAL" : "CANDIDATE_INVALID",
        latestRevision: error.latestRevision,
        safeMessage: error.message,
      };
    }
    return { ok: false, code: "INTERNAL", latestRevision: error.latestRevision, safeMessage: error.message };
  }
  if (error instanceof CandidateNotFoundError) {
    return { ok: false, code: "CANDIDATE_INVALID", safeMessage: error.message };
  }
  if (error instanceof IdempotencyConflictError) {
    return { ok: false, code: "INTERNAL", safeMessage: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, code: "INTERNAL", safeMessage: message };
}

/** API 契约：驱动已存在的运行到下一个等待点或终态。 */
export async function startRun(runId: string, expectedRevision: number): Promise<GraphRunResult> {
  try {
    const runner = new ResearchRunRunner(depsFactory());
    const result = await runner.runExisting(runId, expectedRevision);
    return toGraphRunResult(result);
  } catch (error) {
    return mapError(error);
  }
}

/** API 契约：从当前中断处恢复运行。 */
export async function resumeRun(
  runId: string,
  expectedRevision: number,
  payload: ResumePayload,
): Promise<GraphRunResult> {
  try {
    const runner = new ResearchRunRunner(depsFactory());
    const result = await runner.resumeRun(runId, payload, expectedRevision);
    return toGraphRunResult(result);
  } catch (error) {
    return mapError(error);
  }
}

/** API 契约：取消运行（终态后不可再写）。 */
export async function cancelRun(
  runId: string,
  expectedRevision: number,
  reasonCode?: string,
): Promise<GraphRunResult> {
  try {
    const runner = new ResearchRunRunner(depsFactory());
    const row = await runner.cancelRun(runId, expectedRevision);
    const result: RunStepResult = {
      status: "cancelled",
      currentNode: "cancel",
      wait: null,
      lastError: null,
      completed: false,
      cancelled: true,
      run: row,
      state: runnerStateFromRow(row),
      events: row ? JSON.parse(row.eventsJson) : [],
    };
    return toGraphRunResult(result);
  } catch (error) {
    return mapError(error);
  }
}

function runnerStateFromRow(row: RunRow): ResearchRunState {
  const now = new Date().toISOString();
  return {
    schemaVersion: RESEARCH_RUN_SCHEMA_VERSION,
    runId: row.id,
    candidateId: row.candidateId,
    ownerScope: row.ownerScope,
    sandboxId: row.sandboxId,
    mode: (row.mode === "public_replay" ? "public_replay" : "local_live"),
    status: "cancelled",
    currentNode: "cancel",
    revision: row.revision,
    planRevision: row.planRevision,
    automaticPlanRevisionCount: row.automaticPlanRevisionCount,
    activeQuestionId: null,
    activeToolCallId: null,
    evidenceRevision: 0,
    factRevision: null,
    policyPackVersion: null,
    budget: {
      maxWallClockMs: 120_000,
      maxBrowserSteps: 100,
      maxLlmTokens: 100_000,
      maxImageCalls: 20,
      maxCost: 10,
      currency: "USD",
      usedBrowserSteps: 0,
      usedLlmTokens: 0,
      usedImageCalls: 0,
      usedCost: 0,
    },
    wait: null,
    checkpoint: null,
    lastError: null,
    createdAt: toIso(row.createdAt),
    updatedAt: now,
    completedAt: null,
  };
}