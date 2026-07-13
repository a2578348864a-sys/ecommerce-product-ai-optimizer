import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowInputHash,
  createWorkflowResultHash,
  createWorkflowRunProof,
  verifyWorkflowRunProof,
} from "@/lib/server/workflowRunProof";

const PASSWORD = "workflow-proof-test-password";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", PASSWORD);
});

function signedFixture(status: "completed" | "partial_failed" = "completed") {
  const input = {
    productName: "桌面手机支架",
    source: "opportunity" as const,
    candidateId: "candidate-001",
  };
  const result = {
    ok: true,
    workflowId: "wf-12345678-abcd-4321-abcd-123456789abc",
    runId: "wf-12345678-abcd-4321-abcd-123456789abc",
    input,
    productName: input.productName,
    status,
    finalReport: { finalVerdict: "建议补充证据后小单测试" },
  };
  const proof = createWorkflowRunProof({
    runId: result.runId,
    subject: "owner",
    candidateId: input.candidateId,
    inputHash: createWorkflowInputHash(input),
    resultHash: createWorkflowResultHash(result),
    status,
    now: 1_000_000,
  });
  return { input, result, proof };
}

describe("workflowRunProof", () => {
  it("creates a verifiable HMAC proof with all trust bindings", () => {
    const fixture = signedFixture();
    const verified = verifyWorkflowRunProof(fixture.proof, 1_000_001);

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload).toMatchObject({
      runId: fixture.result.runId,
      subject: "owner",
      candidateId: "candidate-001",
      inputHash: createWorkflowInputHash(fixture.input),
      resultHash: createWorkflowResultHash(fixture.result),
      status: "completed",
    });
  });

  it("rejects a modified signature", () => {
    const { proof } = signedFixture();
    const tampered = `${proof.slice(0, -1)}${proof.endsWith("a") ? "b" : "a"}`;
    expect(verifyWorkflowRunProof(tampered, 1_000_001)).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("produces a different result hash after workflowResult tampering", () => {
    const { result } = signedFixture();
    const originalHash = createWorkflowResultHash(result);
    const tamperedHash = createWorkflowResultHash({
      ...result,
      finalReport: { finalVerdict: "客户端伪造结论" },
    });
    expect(tamperedHash).not.toBe(originalHash);
  });

  it("binds the server-derived Candidate context hash into the workflow input hash", () => {
    const base = {
      productName: "桌面手机支架",
      source: "opportunity" as const,
      candidateId: "candidate-001",
    };

    const first = createWorkflowInputHash({ ...base, contextHash: "a".repeat(64) });
    const changed = createWorkflowInputHash({ ...base, contextHash: "b".repeat(64) });

    expect(first).not.toBe(changed);
  });

  it("keeps the legacy manual input hash stable when no context hash is present", () => {
    const manual = {
      productName: "手工商品",
      source: "manual" as const,
      candidateId: null,
    };

    expect(createWorkflowInputHash(manual)).toBe(createWorkflowInputHash({ ...manual, contextHash: undefined }));
  });

  it("ignores only the top-level proof field when hashing", () => {
    const { result } = signedFixture();
    expect(createWorkflowResultHash({ ...result, runProof: "transport-only" }))
      .toBe(createWorkflowResultHash(result));
    expect(createWorkflowResultHash({ ...result, finalReport: { runProof: "nested-data" } }))
      .not.toBe(createWorkflowResultHash(result));
  });

  it("expires proofs after the fixed TTL", () => {
    const { proof } = signedFixture("partial_failed");
    expect(verifyWorkflowRunProof(proof, 1_000_000 + 2 * 60 * 60 * 1000 + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
