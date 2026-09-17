import { describe, expect, it } from "vitest";
import { verifyCandidateBinding } from "./candidateBindingVerification";

const taskId = "task-1";
const candidateId = "candidate-1";

function result(overrides: Record<string, unknown> = {}) {
  return {
    candidateToTask: { candidateId },
    candidateAnalysisContext: { facts: { asin: "B00063QBL8" } },
    researchRecord: { candidateId },
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: candidateId,
    convertedTaskId: taskId,
    sourceMetaJson: JSON.stringify({ asin: "B00063QBL8", marketplace: "US" }),
    ...overrides,
  };
}

describe("candidate binding verification", () => {
  it("verifies a matching Candidate → Task → ASIN relation", () => {
    expect(verifyCandidateBinding({ taskId, result: result(), candidate: candidate() })).toMatchObject({
      status: "verified",
      candidateId,
      asin: "B00063QBL8",
    });
  });

  it("fails closed when the candidate is linked to another task", () => {
    expect(verifyCandidateBinding({ taskId, result: result(), candidate: candidate({ convertedTaskId: "task-2" }) })).toMatchObject({
      status: "invalid",
      reason: "candidate_task_mismatch",
    });
  });

  it("fails closed when Candidate and task ASINs conflict", () => {
    expect(verifyCandidateBinding({
      taskId,
      result: result(),
      candidate: candidate({ sourceMetaJson: JSON.stringify({ asin: "B00063QBL9" }) }),
    })).toMatchObject({ status: "invalid", reason: "asin_conflict" });
  });

  it("fails closed when the persisted Candidate is missing", () => {
    expect(verifyCandidateBinding({ taskId, result: result(), candidate: null })).toMatchObject({
      status: "invalid",
      reason: "candidate_missing",
    });
  });

  it("rejects a conflicting persisted review evidence ASIN", () => {
    expect(verifyCandidateBinding({
      taskId,
      result: result({ reviewEvidence: { dataset: { reviews: [{ productAsin: "B00063QBL9" }] } } }),
      candidate: candidate(),
    })).toMatchObject({ status: "invalid", reason: "evidence_asin_conflict" });
  });

  it("does not mutate the binding inputs", () => {
    const input = { taskId, result: result(), candidate: candidate() };
    const before = JSON.stringify(input);
    verifyCandidateBinding(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
