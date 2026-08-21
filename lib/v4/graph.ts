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
  type ResearchBudget,
  type ResearchRunError,
  type ResearchRunEvent,
  type ResearchRunNode,
  type ResearchRunState,
  type ResearchRunStatus,
  type ResearchRunWait,
  type ResumePayload,
} from "@/lib/v4/contracts";
import { DomainAdapter, type CandidateSnapshot } from "@/lib/v4/domain";
import { FakeToolRegistry, type ConflictItem, type ContentDraft, type EvidenceItem, type FeasibilitySnapshot, type ResearchPlan, type ResearchQuestion, type ToolResult } from "@/lib/v4/fakeTools";
import { ResearchRunStore, type RunRow, RunStoreError } from "@/lib/v4/runStore";
import { SideEffectJournal, buildIdempotencyKey, sha256, stableStringify } from "@/lib/v4/journal";
import { openCheckpoint } from "@/lib/v4/checkpoint";

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
};

export function initialBudget(): ResearchBudget {
  return {
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
    const toolResult = deps.tools.tool({ toolName: question.toolName, questionId: question.questionId, inputHash: question.inputHash });
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
      activeToolName: question.toolName,
      activeInputHash: question.inputHash,
      activeToolResult: toolResult,
      dispatchedQuestionIds: [...state.dispatchedQuestionIds, question.questionId],
      budget: budget.budget,
      lastEvent: ev("dispatch_tool", "tool_dispatched", { toolName: question.toolName, questionId: question.questionId, inputHash: question.inputHash }),
    };
  };

  const validateOutput: NodeFn = async (state) => {
    const validation = deps.tools.validate({ toolResult: state.activeToolResult ?? { toolName: "unknown", outputHash: "", payload: {}, ok: false }, questionId: state.activeQuestionId ?? "" });
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

  const mergeEvidence: NodeFn = async (state) => {
    const toolResult = state.activeToolResult;
    if (!toolResult) {
      return failState("merge_evidence", { code: "UNKNOWN_RECOVERABLE", recoverable: true, safeMessage: "no tool result" });
    }
    const questionId = state.activeQuestionId ?? "";
    const inputHash = state.activeInputHash ?? "";
    const toolName = state.activeToolName ?? "";
    const idemKey = buildIdempotencyKey({ runId: state.runId, questionId, toolName, inputHash });
    const decision = await deps.journal.resolve({ runId: state.runId, idempotencyKey: idemKey, inputHash, action: toolName });
    if (decision.kind === "conflict") {
      return failState("merge_evidence", { code: "SCHEMA_INVALID", recoverable: true, safeMessage: "idempotency conflict" });
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
    const evidenceItem = deps.tools.evidence({ toolResult, questionId });
    await deps.journal.commit({ runId: state.runId, idempotencyKey: idemKey });
    const evidenceRevision = state.evidenceRevision + 1;
    return {
      status: "running",
      currentNode: "merge_evidence",
      evidence: [evidenceItem],
      evidenceRevision,
      activeQuestionId: null,
      activeToolResult: null,
      lastEvent: ev("merge_evidence", "evidence_merged", { evidenceRevision, count: state.evidence.length + 1 }),
    };
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
    return { status: "running", currentNode: "synthesize_market" };
  };

  const gateA: NodeFn = async (state) => {
    const decision = interrupt<InterruptValue, ResumePayload>({ kind: "human_decision", reasonCode: "GATE_A", node: "gate_a", instructions: "Review market synthesis and decide whether to continue." } satisfies InterruptValue);
    const human = decision as HumanDecisionPayload;
    if (human.kind !== "human_decision" || human.decision === "stop") {
      return { status: "cancelled", currentNode: "cancel", wait: null, lastEvent: ev("gate_a", "human_decision", { decision: "stop" }) };
    }
    return { status: "running", currentNode: "gate_a", wait: null, lastEvent: ev("gate_a", "human_decision", { decision: "continue" }) };
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
    const feasibility = deps.tools.feasibility({ facts: state.facts ?? {}, budgetInputHash: String(state.budget.usedCost) });
    return { status: "running", currentNode: "commercial_check", feasibility };
  };

  const gateB: NodeFn = async (state) => {
    const decision = interrupt<InterruptValue, ResumePayload>({ kind: "human_decision", reasonCode: "GATE_B", node: "gate_b", instructions: "Review commercial feasibility and decide whether to continue." } satisfies InterruptValue);
    const human = decision as HumanDecisionPayload;
    if (human.kind !== "human_decision" || human.decision === "stop") {
      return { status: "cancelled", currentNode: "cancel", wait: null, lastEvent: ev("gate_b", "human_decision", { decision: "stop" }) };
    }
    return { status: "running", currentNode: "gate_b", wait: null, lastEvent: ev("gate_b", "human_decision", { decision: "continue" }) };
  };

  const contentHandoff: NodeFn = async (state) => {
    const handoff = { factRevision: state.factRevision ?? 0, policyPackVersion: "policy.v1" };
    return { status: "running", currentNode: "content_handoff", handoff, policyPackVersion: "policy.v1" };
  };

  const contentSkills: NodeFn = async (state) => {
    const draft = deps.tools.content({ handoff: state.handoff ?? { factRevision: 0, policyPackVersion: "policy.v1" } });
    const budget = consumeBudget(state.budget, { browserSteps: 0, llmTokens: 100, cost: 0.1 });
    if (budget.over) {
      interrupt<InterruptValue, ResumePayload>({ kind: "budget", reasonCode: "BUDGET_EXCEEDED", node: "content_skills" } satisfies InterruptValue);
      return { status: "paused_budget", currentNode: "content_skills", budget: budget.budget, wait: { kind: "budget", reasonCode: "BUDGET_EXCEEDED", requestedAt: new Date().toISOString() } };
    }
    return { status: "running", currentNode: "content_skills", content: draft, budget: budget.budget, lastEvent: ev("content_skills", "tool_dispatched", { toolName: "content_skills" }) };
  };

  const contentReview: NodeFn = async (state) => {
    const decision = interrupt<InterruptValue, ResumePayload>({ kind: "human_decision", reasonCode: "CONTENT_REVIEW", node: "content_review", instructions: "Review the content draft before completion." } satisfies InterruptValue);
    const human = decision as HumanDecisionPayload;
    if (human.kind !== "human_decision" || human.decision === "stop") {
      return { status: "cancelled", currentNode: "cancel", wait: null, lastEvent: ev("content_review", "human_decision", { decision: "stop" }) };
    }
    return { status: "running", currentNode: "content_review", wait: null, lastEvent: ev("content_review", "human_decision", { decision: "continue" }) };
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
  cond("gate_a", terminalOr("supplier_research"), ["supplier_research", "fail", "cancel"]);
  cond("supplier_research", terminalOr("product_fact_gate"), ["product_fact_gate", "fail", "cancel"]);
  cond("product_fact_gate", terminalOr("commercial_check"), ["commercial_check", "fail", "cancel"]);
  cond("commercial_check", terminalOr("gate_b"), ["gate_b", "fail", "cancel"]);
  cond("gate_b", terminalOr("content_handoff"), ["content_handoff", "fail", "cancel"]);
  cond("content_handoff", terminalOr("content_skills"), ["content_skills", "fail", "cancel"]);
  cond("content_skills", terminalOr("content_review"), ["content_review", "fail", "cancel"]);
  cond("content_review", terminalOr("complete"), ["complete", "fail", "cancel"]);
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
    checkpoint: checkpointId
      ? { checkpointId, businessRevision: nextRevision, createdAt: now }
      : null,
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

  async resumeRun(
    runId: string,
    payload: ResumePayload,
    expectedRevision: number,
  ): Promise<RunStepResult> {
    // resume gate: graphVersion + expectedRevision + candidate/budget revalidation
    await this.deps.runStore.assertGraphVersion(runId);
    const run = await this.deps.runStore.getRun(runId);
    if (!run) throw new RunStoreError("NOT_FOUND", `Run ${runId} not found`);
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
      automaticPlanRevisionCount: state.automaticPlanRevisionCount,
      events,
    });
  }

  private toResult(run: RunRow, interruptValue: InterruptValue | null): RunStepResult {
    const state = this.deps.runStore.readState(run);
    return {
      status: state?.status ?? "draft",
      currentNode: (state?.currentNode ?? "load_context") as ResearchRunNode,
      wait: state?.wait ?? null,
      lastError: state?.lastError ?? null,
      completed: state?.status === "completed",
      cancelled: state?.status === "cancelled",
      run,
    };
  }
}

export const INTERRUPT_KEY = "__interrupt__";