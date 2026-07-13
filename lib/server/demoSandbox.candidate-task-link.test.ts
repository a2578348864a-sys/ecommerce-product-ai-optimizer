import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSandboxCandidate,
  createSandboxTaskAndLinkCandidate,
  deleteSandboxCandidate,
  deleteSandboxTask,
  listSandboxCandidates,
  listSandboxTasks,
  sandboxCandidateToListItem,
  saveDemoSandboxStore,
  SandboxCandidateTaskLinkError,
} from "@/lib/server/demoSandbox";
import {
  buildCandidateAnalysisContext,
  createCandidateAnalysisBindingHash,
} from "@/lib/server/candidateAnalysisContext";

const ROOT = mkdtempSync(join(tmpdir(), "candidate-task-link-"));
const STORE_PATH = join(ROOT, "sandbox.json");

beforeAll(() => {
  process.env.DEMO_SANDBOX_STORE_PATH = STORE_PATH;
});

afterAll(() => {
  delete process.env.DEMO_SANDBOX_STORE_PATH;
  rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  saveDemoSandboxStore({ version: 1, tasks: [], candidates: [] });
});

function taskInput() {
  return {
    type: "workflow",
    title: "Foldable Widget 一键分析",
    decisionStatus: "continue",
    resultJson: JSON.stringify({ candidateToTask: { candidateId: "placeholder" } }),
  };
}

function conversionGuard(candidate: {
  name: string;
  sourceMetaJson: string;
  analysisJson: string;
  link: string | null;
}) {
  const context = buildCandidateAnalysisContext(candidate);
  return {
    expectedProductName: candidate.name,
    expectedContextHash: createCandidateAnalysisBindingHash(candidate, context),
  };
}

function expectLinkError(action: () => unknown, code: string) {
  try {
    action();
    throw new Error("expected link error");
  } catch (error) {
    expect(error).toBeInstanceOf(SandboxCandidateTaskLinkError);
    expect(error).toMatchObject({ code });
  }
}

describe("Visitor Candidate → Task atomic link", () => {
  it("unlinks a Candidate when its Task is deleted so it can be converted again", () => {
    const candidate = createSandboxCandidate("visitor-a", {
      name: "Re-convertible Widget",
      status: "worth_analyzing",
    });
    const first = createSandboxTaskAndLinkCandidate(
      "visitor-a",
      candidate.id,
      taskInput(),
      conversionGuard(candidate),
    );

    expect(deleteSandboxTask("visitor-a", first.id)).toBe(true);
    const unlinked = listSandboxCandidates("visitor-a")[0];
    expect(unlinked.convertedTaskId).toBeNull();
    const second = createSandboxTaskAndLinkCandidate(
      "visitor-a",
      candidate.id,
      taskInput(),
      conversionGuard(unlinked),
    );
    expect(second.id).not.toBe(first.id);
  });

  it("makes a Candidate deletable after deleting its linked Task", () => {
    const candidate = createSandboxCandidate("visitor-a", {
      name: "Delete after Task",
      status: "worth_analyzing",
    });
    const task = createSandboxTaskAndLinkCandidate(
      "visitor-a", candidate.id, taskInput(), conversionGuard(candidate),
    );

    expect(deleteSandboxTask("visitor-a", task.id)).toBe(true);
    expect(deleteSandboxCandidate("visitor-a", candidate.id)).toBe("deleted");
  });

  it("does not unlink another Visitor's Candidate when a cross-scope Task delete is attempted", () => {
    const candidate = createSandboxCandidate("visitor-b", {
      name: "Visitor B linked product",
      status: "worth_analyzing",
    });
    const task = createSandboxTaskAndLinkCandidate(
      "visitor-b", candidate.id, taskInput(), conversionGuard(candidate),
    );

    expect(deleteSandboxTask("visitor-a", task.id)).toBe(false);
    expect(listSandboxCandidates("visitor-b")[0].convertedTaskId).toBe(task.id);
  });

  it("persists the Task and Candidate link in the same Store publication", () => {
    const candidate = createSandboxCandidate("visitor-a", {
      name: "Foldable Widget",
      status: "worth_analyzing",
    });

    const task = createSandboxTaskAndLinkCandidate(
      "visitor-a",
      candidate.id,
      taskInput(),
      conversionGuard(candidate),
    );

    expect(listSandboxTasks("visitor-a")).toHaveLength(1);
    const storedCandidate = listSandboxCandidates("visitor-a")[0];
    expect(storedCandidate.convertedTaskId).toBe(task.id);
    expect(storedCandidate.lastActionAt).toBe(task.createdAt);
    expect(sandboxCandidateToListItem(storedCandidate)).toMatchObject({
      convertedTaskId: task.id,
      lastActionAt: task.createdAt,
    });
  });

  it("rejects Visitor A converting Visitor B's Candidate without creating a Task", () => {
    const candidate = createSandboxCandidate("visitor-b", {
      name: "Visitor B Product",
      status: "worth_analyzing",
    });

    expectLinkError(
      () => createSandboxTaskAndLinkCandidate("visitor-a", candidate.id, taskInput(), conversionGuard(candidate)),
      "candidate_not_found",
    );
    expect(listSandboxTasks("visitor-a")).toHaveLength(0);
    expect(listSandboxTasks("visitor-b")).toHaveLength(0);
  });

  it("rejects a Candidate that left the analyzable queue", () => {
    const candidate = createSandboxCandidate("visitor-a", {
      name: "Abandoned Product",
      status: "rejected",
    });

    expectLinkError(
      () => createSandboxTaskAndLinkCandidate("visitor-a", candidate.id, taskInput(), conversionGuard(candidate)),
      "candidate_not_ready_for_conversion",
    );
    expect(listSandboxTasks("visitor-a")).toHaveLength(0);
  });

  it("rechecks the authoritative R2.2 gate inside the strict Visitor store write", () => {
    const candidate = createSandboxCandidate("visitor-a", {
      name: "Rejected by R2.2",
      status: "worth_analyzing",
      analysisJson: JSON.stringify({
        r22MarketDecision: {
          schemaVersion: "r22-market-decision-v1",
          evidenceVersion: "r22-evidence-semantics-v1",
          candidateId: "placeholder",
          asin: "B000000001",
          briefId: "A",
          frozenRank: 1,
          marketDecision: "market_reject",
          decisionReasons: ["confirmed_fatal_market_or_platform_risk"],
          supportingEvidenceRefs: ["fixture:risk"],
          opposingEvidenceRefs: [],
          marketMissingFields: [],
          dataCompleteness: 1,
          confidence: "high",
          stabilityStatus: "stable",
          ruleVersion: "r22-stage1-market-v1",
          inputHash: "a".repeat(64),
          createdAt: "2026-07-13T00:00:00.000Z",
        },
      }),
    });
    const analysis = JSON.parse(candidate.analysisJson);
    analysis.r22MarketDecision.candidateId = candidate.id;
    saveDemoSandboxStore({
      version: 1,
      tasks: [],
      candidates: [{ ...candidate, analysisJson: JSON.stringify(analysis) }],
    });
    const current = listSandboxCandidates("visitor-a")[0];
    expectLinkError(
      () => createSandboxTaskAndLinkCandidate("visitor-a", current.id, taskInput(), conversionGuard(current)),
      "candidate_r22_stage2_blocked",
    );
    expect(listSandboxTasks("visitor-a")).toHaveLength(0);
  });

  it("rejects replay after the Candidate already converted and creates no duplicate Task", () => {
    const candidate = createSandboxCandidate("visitor-a", {
      name: "One Task Only",
      status: "analyzed",
    });
    const guard = conversionGuard(candidate);
    const first = createSandboxTaskAndLinkCandidate("visitor-a", candidate.id, taskInput(), guard);

    expectLinkError(
      () => createSandboxTaskAndLinkCandidate("visitor-a", candidate.id, taskInput(), guard),
      "candidate_already_converted",
    );
    expect(listSandboxTasks("visitor-a").map((task) => task.id)).toEqual([first.id]);
  });

  it("rejects when the authoritative Candidate name changed after analysis", () => {
    const candidate = createSandboxCandidate("visitor-a", {
      name: "Current Product Name",
      status: "worth_analyzing",
    });
    const guard = {
      ...conversionGuard(candidate),
      expectedProductName: "Analyzed Product Name",
    };

    expectLinkError(
      () => createSandboxTaskAndLinkCandidate("visitor-a", candidate.id, taskInput(), guard),
      "candidate_changed_since_analysis",
    );
    expect(listSandboxTasks("visitor-a")).toHaveLength(0);
  });
});
