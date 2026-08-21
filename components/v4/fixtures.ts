import type {
  ResearchBudget,
  ResearchRunEvent,
  ResearchRunState,
  ResearchRunWait,
} from "@/lib/v4/contracts";
import type { RunSummary } from "./api";

export function makeBudget(overrides: Partial<ResearchBudget> = {}): ResearchBudget {
  return {
    maxWallClockMs: 600000,
    maxBrowserSteps: 100,
    maxLlmTokens: 200000,
    maxImageCalls: 20,
    maxCost: 10,
    currency: "CNY",
    usedBrowserSteps: 5,
    usedLlmTokens: 10000,
    usedImageCalls: 1,
    usedCost: 2.5,
    ...overrides,
  };
}

export function makeWait(overrides: Partial<ResearchRunWait> = {}): ResearchRunWait {
  return {
    kind: "human_decision",
    reasonCode: "GATE_A_REQUIRED",
    instructions: "请确认是否继续供应链验证。",
    requestedAt: "2026-01-01T00:02:00.000Z",
    ...overrides,
  };
}

export function makeRun(overrides: Partial<ResearchRunState> = {}): ResearchRunState {
  return {
    schemaVersion: "researchRun.v4",
    runId: "run_1",
    candidateId: "cand_1",
    mode: "local_live",
    status: "running",
    currentNode: "dispatch_tool",
    revision: 3,
    planRevision: 1,
    automaticPlanRevisionCount: 0,
    evidenceRevision: 2,
    budget: makeBudget(),
    wait: null,
    checkpoint: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<ResearchRunEvent> = {}): ResearchRunEvent {
  return {
    seq: 1,
    type: "node_entered",
    node: "load_context",
    payloadJson: "{}",
    createdAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

export function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run_1",
    candidateId: "cand_1",
    status: "running",
    currentNode: "dispatch_tool",
    revision: 3,
    budget: { usedCost: 2.5 },
    updatedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}
