import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowInputHash,
  createWorkflowResultHash,
  createWorkflowRunProof,
  type WorkflowRunStatus,
} from "@/lib/server/workflowRunProof";
import {
  buildCandidateAnalysisContext,
  createCandidateAnalysisBindingHash,
} from "@/lib/server/candidateAnalysisContext";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeRuleAssessmentV1,
  normalizeSourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import { buildWorkflowBatchSavePayload } from "@/components/cross-border/workflowBatchRunCache";
import { buildR22PendingCommercialRunSnapshot } from "@/lib/r22CommercialValidation";
import { parseR22MarketDecisionFromAnalysisJson } from "@/lib/r22DecisionModel";

const authState: {
  context: { mode: "owner" } | { mode: "demo"; demoAccessId: string };
} = { context: { mode: "owner" } };

const mocks = vi.hoisted(() => ({
  prismaCreate: vi.fn(),
  candidateFindUnique: vi.fn(),
  ownerTransaction: vi.fn(),
  txTaskCreate: vi.fn(),
  txCandidateFindUnique: vi.fn(),
  txCandidateUpdateMany: vi.fn(),
  createSandboxTask: vi.fn(),
  createSandboxTaskAndLinkCandidate: vi.fn(),
  getSandboxCandidate: vi.fn(),
  SandboxCandidateTaskLinkError: class SandboxCandidateTaskLinkError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = "SandboxCandidateTaskLinkError";
    }
  },
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => ({ ok: true, context: authState.context }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    $transaction: mocks.ownerTransaction,
    viralAnalysisRecord: { create: mocks.prismaCreate },
    opportunityCandidate: { findUnique: mocks.candidateFindUnique },
  },
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  createSandboxTask: mocks.createSandboxTask,
  createSandboxTaskAndLinkCandidate: mocks.createSandboxTaskAndLinkCandidate,
  SandboxCandidateTaskLinkError: mocks.SandboxCandidateTaskLinkError,
  sandboxTaskToDetail: vi.fn(),
  isSandboxCandidateId: (candidateId: string) => candidateId.startsWith("sandbox_candidate_"),
  getSandboxCandidate: mocks.getSandboxCandidate,
}));

import { POST } from "./route";

const PASSWORD = "workflow-save-proof-test-password";
const RUN_ID = "wf-12345678-abcd-4321-abcd-123456789abc";

function authoritativeCandidate(id = "candidate-a") {
  return {
    id,
    name: "桌面手机支架",
    rawInput: "原始桌面手机支架",
    link: "https://example.com/authoritative-item?token=private-value",
    score: 88,
    source: "服务端候选池",
    keyword: "phone stand",
    riskLevel: "yellow",
    riskLabel: "中风险",
    summaryLabel: "服务端候选摘要",
    status: "worth_analyzing",
    sourceMetaJson: JSON.stringify({
      candidateType: "product_candidate",
      evidenceSnapshot: {
        version: 1,
        sourceType: "web",
        sourceName: "server source",
        sourceUrl: "https://example.com/authoritative-item",
        evidenceItems: ["product_page"],
        extractionSignals: [],
        qualityScore: 88,
        confidence: "high",
        riskFlags: [],
        decision: "recommended",
        decisionReason: "server evidence",
        nextAction: "manual review",
        generatedAt: "2026-07-11T00:00:00.000Z",
      },
    }),
    analysisJson: "{}",
  };
}

function verifiedAuthoritativeCandidate(id = "candidate-a") {
  const sourceEvidence = normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: "save-context-001",
    origin: "public_url",
    capturedAt: "2026-07-12T01:00:00.000Z",
    submittedUrl: "https://example.com/product?token=secret",
    finalUrl: "https://example.com/product",
    candidateUrl: "https://example.com/product",
    sourceRelation: "document",
    sourceHost: "example.com",
    sourceType: "html",
    transportSecurity: "https",
    retrieval: { status: "retrieved", httpStatus: 200, contentType: "text/html", robots: "allowed", redirectCount: 0 },
    observations: {
      title: "桌面手机支架",
      categoryHint: "桌面配件",
      signalText: "页面展示折叠结构与便携特征",
      priceText: "US$ 12.00",
      hasImage: true,
    },
    extractionSignals: ["product_page"],
  });
  const ruleAssessment = normalizeRuleAssessmentV1({
    version: "candidate-rule-v1",
    algorithm: "radar-score-v1",
    evidenceHash: createEvidenceHash(sourceEvidence),
    computedAt: "2026-07-12T01:01:00.000Z",
    candidateType: "product_candidate",
    scores: { demandSignal: 80, supplyEase: 70, risk: 30, beginnerFit: 75, final: 74 },
    riskFlags: ["manual_price_check"],
    reasons: ["公开页面存在商品信号"],
    queueSuggestion: "review",
  });
  return {
    ...authoritativeCandidate(id),
    link: sourceEvidence.candidateUrl ?? "https://example.com/product",
    sourceMetaJson: JSON.stringify({
      version: "candidate-source-meta-v2",
      integrity: "signed_source_v2",
      evidenceHash: createEvidenceHash(sourceEvidence),
      sourceEvidence,
      proof: {
        issuedAt: "2026-07-12T01:01:00.000Z",
        expiresAt: "2026-07-12T03:01:00.000Z",
        sourceType: sourceEvidence.sourceType,
        internal: "must-not-leak",
      },
    }),
    analysisJson: JSON.stringify({
      version: "candidate-analysis-v2",
      integrity: "signed_source_v2",
      assessmentHash: createAssessmentHash(ruleAssessment),
      ruleAssessment,
    }),
  };
}

function r22Candidate(
  decision: "market_shortlisted" | "market_watch" | "market_reject" | "insufficient_market_data" = "market_shortlisted",
) {
  const candidate = verifiedAuthoritativeCandidate();
  const analysis = JSON.parse(candidate.analysisJson);
  return {
    ...candidate,
    analysisJson: JSON.stringify({
      ...analysis,
      r22MarketDecision: {
        schemaVersion: "r22-market-decision-v1",
        evidenceVersion: "r22-evidence-semantics-v1",
        candidateId: candidate.id,
        asin: "B000000001",
        briefId: "A",
        frozenRank: 1,
        marketDecision: decision,
        decisionReasons: ["fixture"],
        supportingEvidenceRefs: ["fixture:market"],
        opposingEvidenceRefs: [],
        marketMissingFields: decision === "insufficient_market_data" ? ["priceUsd"] : [],
        dataCompleteness: decision === "insufficient_market_data" ? 0.9 : 1,
        confidence: decision === "insufficient_market_data" ? "low" : "high",
        stabilityStatus: "stable",
        ruleVersion: "r22-stage1-market-v1",
        inputHash: "a".repeat(64),
        createdAt: "2026-07-13T00:00:00.000Z",
      },
    }),
  };
}

function createRequest(body: unknown) {
  return {
    method: "POST",
    url: "http://localhost:3000/api/workflows/product-analysis/save-task",
    nextUrl: new URL("http://localhost:3000/api/workflows/product-analysis/save-task"),
    headers: new Headers(),
    json: async () => body,
  };
}

function signedBody(input: {
  status?: WorkflowRunStatus;
  subject?: string;
  candidateId?: string | null;
  candidate?: ReturnType<typeof authoritativeCandidate>;
  omitR22CommercialValidation?: boolean;
  zeroRequestedSteps?: boolean;
}) {
  const status = input.status ?? "completed";
  const candidateId = input.candidateId ?? null;
  const candidate = candidateId ? (input.candidate ?? authoritativeCandidate(candidateId)) : null;
  const runInput = {
    productName: "桌面手机支架",
    source: candidateId ? "opportunity" as const : "manual" as const,
    candidateId,
    ...(candidate ? {
      contextHash: createCandidateAnalysisBindingHash(candidate, buildCandidateAnalysisContext(candidate)),
    } : {}),
  };
  const workflowResult = {
    ok: true,
    workflowId: RUN_ID,
    runId: RUN_ID,
    input: runInput,
    productName: runInput.productName,
    status,
    steps: [],
    costGuard: input.zeroRequestedSteps
      ? { aiStepsRequested: 0, aiStepsCompleted: 0, fallbackSteps: 0 }
      : { aiStepsRequested: 1, aiStepsCompleted: 1, fallbackSteps: 0 },
    finalReport: {
      finalVerdict: "建议补齐证据后小单测试",
      riskLevel: "yellow",
      beginnerFit: "需人工复核",
      canTestSmallBatch: true,
      mustCheckBeforeListing: [],
      nextSteps: [],
      manualReviewChecklist: [],
    },
    ...(!input.omitR22CommercialValidation && candidate
      ? (() => {
          const snapshot = parseR22MarketDecisionFromAnalysisJson(candidate.analysisJson);
          return snapshot && (snapshot.marketDecision === "market_shortlisted" || snapshot.marketDecision === "market_watch")
            ? { r22CommercialValidation: buildR22PendingCommercialRunSnapshot(
                snapshot, RUN_ID, "2026-07-13T00:01:00.000Z",
              ) }
            : {};
        })()
      : {}),
  };
  const runProof = createWorkflowRunProof({
    runId: RUN_ID,
    subject: input.subject ?? "owner",
    candidateId,
    inputHash: createWorkflowInputHash(runInput),
    resultHash: createWorkflowResultHash(workflowResult),
    status,
  });
  return {
    workflowResult: { ...workflowResult, runProof },
    runProof,
    ...(candidateId ? {
      sourceMeta: {
        source: "opportunity",
        candidateId,
        opportunityTitle: runInput.productName,
        importedAt: "2026-07-11T00:00:00.000Z",
      },
    } : {}),
    reviewState: {
      sourcingReviewed: true,
      riskReviewed: true,
      summaryReviewed: true,
      listingReviewed: true,
    },
    decisionStatus: "continue",
    humanConfirmed: true,
    humanDecision: {
      status: "continue",
      reason: "人工确认继续",
      nextAction: "进入下一步",
    },
  };
}

async function responseJson(response: Response) {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", PASSWORD);
  authState.context = { mode: "owner" };
  vi.clearAllMocks();
  mocks.prismaCreate.mockResolvedValue({ id: "task-owner-001", title: "桌面手机支架 一键分析" });
  mocks.txTaskCreate.mockResolvedValue({ id: "task-owner-001", title: "桌面手机支架 一键分析" });
  mocks.txCandidateFindUnique.mockResolvedValue({
    ...authoritativeCandidate(),
    convertedTaskId: null,
  });
  mocks.txCandidateUpdateMany.mockResolvedValue({ count: 1 });
  mocks.ownerTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    viralAnalysisRecord: { create: mocks.txTaskCreate },
    opportunityCandidate: {
      findUnique: mocks.txCandidateFindUnique,
      updateMany: mocks.txCandidateUpdateMany,
    },
  }));
  mocks.createSandboxTask.mockReturnValue({ id: "sandbox_task_001", title: "桌面手机支架 一键分析" });
  mocks.createSandboxTaskAndLinkCandidate.mockReturnValue({
    id: "sandbox_task_linked_001",
    title: "桌面手机支架 一键分析",
  });
  mocks.candidateFindUnique.mockResolvedValue(authoritativeCandidate());
});

describe("save-task runProof trust boundary", () => {
  it("independently rejects a signed workflow snapshot with zero requested AI steps", async () => {
    const result = await responseJson(await POST(createRequest(signedBody({
      zeroRequestedSteps: true,
    })) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("no_ai_steps_requested");
    expect(mocks.prismaCreate).not.toHaveBeenCalled();
  });

  it("persists a run-bound R2.2 not-evaluated commercial snapshot without claiming profit", async () => {
    const candidate = r22Candidate();
    mocks.candidateFindUnique.mockResolvedValue(candidate);
    mocks.txCandidateFindUnique.mockResolvedValue({ ...candidate, convertedTaskId: null });

    const result = await responseJson(await POST(createRequest(signedBody({
      candidateId: candidate.id, candidate,
    })) as never));

    expect(result.status).toBe(200);
    const saved = JSON.parse(mocks.txTaskCreate.mock.calls[0][0].data.resultJson);
    expect(saved.r22CommercialValidation).toMatchObject({
      runId: RUN_ID,
      candidateId: candidate.id,
      commercialEvidenceStatus: "supplier_confirmation_required",
      commercialDecision: "not_evaluated",
      profitScenario: null,
    });
  });

  it("rejects an R2.2 save when its signed workflow omits the commercial run snapshot", async () => {
    const candidate = r22Candidate();
    mocks.candidateFindUnique.mockResolvedValue(candidate);
    mocks.txCandidateFindUnique.mockResolvedValue({ ...candidate, convertedTaskId: null });
    const result = await responseJson(await POST(createRequest(signedBody({
      candidateId: candidate.id, candidate, omitR22CommercialValidation: true,
    })) as never));
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_r22_commercial_snapshot_invalid");
    expect(mocks.ownerTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["runId", "wf-old-stage2-run"],
    ["candidateId", "candidate-other"],
    ["stage1InputHash", "b".repeat(64)],
  ])("rejects a signed R2.2 commercial snapshot with wrong %s binding", async (field, value) => {
    const candidate = r22Candidate();
    mocks.candidateFindUnique.mockResolvedValue(candidate);
    mocks.txCandidateFindUnique.mockResolvedValue({ ...candidate, convertedTaskId: null });
    const body = signedBody({ candidateId: candidate.id, candidate });
    body.workflowResult.r22CommercialValidation = {
      ...body.workflowResult.r22CommercialValidation!,
      [field]: value,
    };
    const proof = createWorkflowRunProof({
      runId: RUN_ID,
      subject: "owner",
      candidateId: candidate.id,
      inputHash: createWorkflowInputHash(body.workflowResult.input),
      resultHash: createWorkflowResultHash(body.workflowResult),
      status: "completed",
    });
    body.runProof = proof;
    body.workflowResult.runProof = proof;
    const result = await responseJson(await POST(createRequest(body) as never));
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_r22_commercial_snapshot_invalid");
    expect(mocks.ownerTransaction).not.toHaveBeenCalled();
  });

  it("rejects a post-analysis R2.2 downgrade before the Owner transaction writes a Task", async () => {
    const candidate = r22Candidate();
    const downgraded = r22Candidate("market_reject");
    mocks.candidateFindUnique.mockResolvedValue(candidate);
    mocks.txCandidateFindUnique.mockResolvedValue({ ...downgraded, convertedTaskId: null });
    const result = await responseJson(await POST(createRequest(signedBody({
      candidateId: candidate.id, candidate,
    })) as never));
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_r22_stage2_blocked");
    expect(mocks.txTaskCreate).not.toHaveBeenCalled();
  });
  it("creates the Owner Task and Candidate link inside one Prisma transaction", async () => {
    const result = await responseJson(await POST(createRequest(signedBody({ candidateId: "candidate-a" })) as never));

    expect(result.status).toBe(200);
    expect(mocks.ownerTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.prismaCreate).not.toHaveBeenCalled();
    expect(mocks.txTaskCreate).toHaveBeenCalledTimes(1);
    expect(mocks.txCandidateUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "candidate-a",
        convertedTaskId: null,
        status: { in: ["worth_analyzing", "analyzed"] },
      },
      data: {
        convertedTaskId: "task-owner-001",
        lastActionAt: expect.any(Date),
      },
    });
  });

  it("rejects an Owner Candidate that already converted before creating another Task", async () => {
    mocks.txCandidateFindUnique.mockResolvedValueOnce({
      id: "candidate-a",
      status: "analyzed",
      convertedTaskId: "task-existing",
    });

    const result = await responseJson(await POST(createRequest(signedBody({ candidateId: "candidate-a" })) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_already_converted");
    expect(mocks.txTaskCreate).not.toHaveBeenCalled();
  });

  it("rejects when an Owner Candidate is deleted before the transaction starts", async () => {
    mocks.txCandidateFindUnique.mockResolvedValueOnce(null);

    const result = await responseJson(await POST(createRequest(signedBody({ candidateId: "candidate-a" })) as never));

    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe("candidate_not_found");
    expect(mocks.txTaskCreate).not.toHaveBeenCalled();
  });

  it("rejects an Owner Candidate whose status changed before transaction commit", async () => {
    mocks.txCandidateFindUnique.mockResolvedValueOnce({
      id: "candidate-a",
      status: "rejected",
      convertedTaskId: null,
    });

    const result = await responseJson(await POST(createRequest(signedBody({ candidateId: "candidate-a" })) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_not_ready_for_conversion");
    expect(mocks.txTaskCreate).not.toHaveBeenCalled();
  });

  it("fails closed when the Owner conditional Candidate update loses a race", async () => {
    mocks.txCandidateUpdateMany.mockResolvedValueOnce({ count: 0 });

    const result = await responseJson(await POST(createRequest(signedBody({ candidateId: "candidate-a" })) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_conversion_conflict");
    expect(mocks.txTaskCreate).toHaveBeenCalledTimes(1);
    expect(mocks.ownerTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns a generic failure when the Owner transaction cannot update the Candidate", async () => {
    mocks.txCandidateUpdateMany.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await responseJson(await POST(createRequest(signedBody({ candidateId: "candidate-a" })) as never));

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe("database_error");
    expect(mocks.ownerTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.prismaCreate).not.toHaveBeenCalled();
  });

  it("rejects when the Candidate name changes inside the Owner transaction", async () => {
    mocks.txCandidateFindUnique.mockResolvedValueOnce({
      ...authoritativeCandidate(),
      name: "事务内已改名商品",
      convertedTaskId: null,
    });

    const result = await responseJson(await POST(createRequest(signedBody({ candidateId: "candidate-a" })) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_changed_since_analysis");
    expect(mocks.txTaskCreate).not.toHaveBeenCalled();
  });

  it("rejects when signed Evidence changes inside the Owner transaction", async () => {
    const original = verifiedAuthoritativeCandidate();
    mocks.candidateFindUnique.mockResolvedValue(original);
    mocks.txCandidateFindUnique.mockResolvedValueOnce({
      ...original,
      analysisJson: "{",
      convertedTaskId: null,
    });

    const result = await responseJson(await POST(createRequest(signedBody({
      candidateId: "candidate-a",
      candidate: original,
    })) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_context_changed_since_analysis");
    expect(mocks.txTaskCreate).not.toHaveBeenCalled();
  });

  it("rejects a client-modified workflowResult", async () => {
    const body = signedBody({});
    body.workflowResult.finalReport.finalVerdict = "客户端伪造的正常结论";

    const result = await responseJson(await POST(createRequest(body) as never));
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("run_proof_mismatch");
    expect(mocks.prismaCreate).not.toHaveBeenCalled();
  });

  it("rejects candidateId that differs from the signed analysis input", async () => {
    const body = signedBody({ candidateId: "candidate-a" });
    if (!body.sourceMeta) throw new Error("test fixture missing sourceMeta");
    body.sourceMeta.candidateId = "candidate-b";

    const result = await responseJson(await POST(createRequest(body) as never));
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_binding_mismatch");
    expect(mocks.prismaCreate).not.toHaveBeenCalled();
  });

  it("requires explicit completed human review before a Candidate can create a Task", async () => {
    const body = signedBody({ candidateId: "candidate-a" });
    body.humanConfirmed = false;

    const result = await responseJson(await POST(createRequest(body) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_human_confirmation_required");
    expect(mocks.prismaCreate).not.toHaveBeenCalled();
  });

  it("rejects Candidate conversion when any review item is incomplete", async () => {
    const body = signedBody({ candidateId: "candidate-a" });
    body.reviewState.riskReviewed = false;

    const result = await responseJson(await POST(createRequest(body) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_human_confirmation_required");
    expect(mocks.prismaCreate).not.toHaveBeenCalled();
  });

  it("rebuilds Candidate source metadata from authoritative server data", async () => {
    const body = signedBody({ candidateId: "candidate-a" });
    if (!body.sourceMeta) throw new Error("test fixture missing sourceMeta");
    body.sourceMeta.opportunityTitle = "客户端伪造标题";

    const result = await responseJson(await POST(createRequest(body) as never));

    expect(result.status).toBe(200);
    const savedResult = JSON.parse(mocks.txTaskCreate.mock.calls[0][0].data.resultJson);
    expect(savedResult.sourceMeta).toMatchObject({
      candidateId: "candidate-a",
      opportunityTitle: "桌面手机支架",
      opportunitySource: "服务端候选池",
      sourceUrl: expect.stringContaining("%5Bredacted%5D"),
      candidateSnapshot: {
        version: 1,
        id: "candidate-a",
        name: "桌面手机支架",
        status: "worth_analyzing",
      },
    });
    expect(savedResult.sourceMeta.opportunityTitle).not.toBe("客户端伪造标题");
    expect(JSON.stringify(savedResult.sourceMeta)).not.toContain("private-value");
    expect(savedResult.candidateToTask).toMatchObject({
      candidateId: "candidate-a",
      analysisRunId: RUN_ID,
      confirmation: "human_review",
    });
    expect(savedResult.status).toBe("completed");
    expect(savedResult.humanDecision.status).toBe("continue");
    expect(savedResult.productLifecycle).toBeDefined();
  });

  it("rejects a Candidate that changed after the signed analysis", async () => {
    const body = signedBody({ candidateId: "candidate-a" });
    mocks.candidateFindUnique.mockResolvedValueOnce({
      ...authoritativeCandidate(),
      name: "分析后改名的商品",
    });

    const result = await responseJson(await POST(createRequest(body) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_changed_since_analysis");
    expect(mocks.prismaCreate).not.toHaveBeenCalled();
  });

  it("rejects saving when the Candidate evidence context changed after analysis", async () => {
    const original = verifiedAuthoritativeCandidate();
    const body = signedBody({ candidateId: "candidate-a", candidate: original });
    mocks.candidateFindUnique.mockResolvedValueOnce({
      ...original,
      analysisJson: "{",
    });

    const result = await responseJson(await POST(createRequest(body) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_context_changed_since_analysis");
    expect(mocks.prismaCreate).not.toHaveBeenCalled();
  });

  it("persists only the server-recomputed safe Candidate analysis context", async () => {
    const candidate = verifiedAuthoritativeCandidate();
    mocks.candidateFindUnique.mockResolvedValueOnce(candidate);
    mocks.txCandidateFindUnique.mockResolvedValueOnce({ ...candidate, convertedTaskId: null });
    const body = signedBody({ candidateId: "candidate-a", candidate });

    const result = await responseJson(await POST(createRequest(body) as never));

    expect(result.status).toBe(200);
    const savedResult = JSON.parse(mocks.txTaskCreate.mock.calls[0][0].data.resultJson);
    expect(savedResult.candidateAnalysisContext).toMatchObject({
      version: "candidate-analysis-context-v1",
      integrity: "verified_public",
      facts: { title: "桌面手机支架", sourceHost: "example.com" },
      assessment: { candidateType: "product_candidate", queueSuggestion: "review" },
    });
    const serialized = JSON.stringify(savedResult.candidateAnalysisContext);
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("proof");
    expect(serialized).not.toContain("must-not-leak");
  });

  it("saves a Visitor Candidate only from that Visitor's sandbox", async () => {
    authState.context = { mode: "demo", demoAccessId: "visitor-a" };
    mocks.getSandboxCandidate.mockImplementation((demoAccessId: string, candidateId: string) => (
      demoAccessId === "visitor-a" && candidateId === "sandbox_candidate_a"
        ? authoritativeCandidate(candidateId)
        : null
    ));

    const result = await responseJson(await POST(createRequest(signedBody({
      subject: "demo:visitor-a",
      candidateId: "sandbox_candidate_a",
    })) as never));

    expect(result.status).toBe(200);
    expect(mocks.createSandboxTaskAndLinkCandidate).toHaveBeenCalledTimes(1);
    expect(mocks.createSandboxTaskAndLinkCandidate.mock.calls[0].slice(0, 2)).toEqual([
      "visitor-a",
      "sandbox_candidate_a",
    ]);
    expect(mocks.createSandboxTaskAndLinkCandidate.mock.calls[0][3]).toMatchObject({
      expectedProductName: "桌面手机支架",
      expectedContextHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(mocks.createSandboxTask).not.toHaveBeenCalled();
    expect(mocks.candidateFindUnique).not.toHaveBeenCalled();
    const savedResult = JSON.parse(mocks.createSandboxTaskAndLinkCandidate.mock.calls[0][2].resultJson);
    expect(savedResult.sourceMeta.candidateId).toBe("sandbox_candidate_a");
  });

  it("maps a repeated Visitor Candidate conversion to 409 without a manual fallback write", async () => {
    authState.context = { mode: "demo", demoAccessId: "visitor-a" };
    mocks.getSandboxCandidate.mockReturnValue(authoritativeCandidate("sandbox_candidate_a"));
    mocks.createSandboxTaskAndLinkCandidate.mockImplementationOnce(() => {
      throw new mocks.SandboxCandidateTaskLinkError(
        "candidate_already_converted",
        "该候选已经转为任务，不能重复创建。",
      );
    });

    const result = await responseJson(await POST(createRequest(signedBody({
      subject: "demo:visitor-a",
      candidateId: "sandbox_candidate_a",
    })) as never));

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("candidate_already_converted");
    expect(mocks.createSandboxTask).not.toHaveBeenCalled();
  });

  it("rejects Visitor A when the Candidate belongs to Visitor B", async () => {
    authState.context = { mode: "demo", demoAccessId: "visitor-a" };
    mocks.getSandboxCandidate.mockReturnValue(null);

    const result = await responseJson(await POST(createRequest(signedBody({
      subject: "demo:visitor-a",
      candidateId: "sandbox_candidate_b",
    })) as never));

    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe("candidate_not_found");
    expect(mocks.createSandboxTask).not.toHaveBeenCalled();
  });

  it.each(["failed", "blocked", "insufficient_evidence"] as const)(
    "rejects signed %s analysis instead of creating a normal task",
    async (status) => {
      const result = await responseJson(await POST(createRequest(signedBody({ status })) as never));
      expect(result.status).toBe(409);
      expect(result.body.error.code).toBe("workflow_status_not_savable");
      expect(mocks.prismaCreate).not.toHaveBeenCalled();
    },
  );

  it("forces partial_failed into need_info even when the client requests continue", async () => {
    const result = await responseJson(await POST(createRequest(signedBody({ status: "partial_failed" })) as never));

    expect(result.status).toBe(200);
    const createData = mocks.prismaCreate.mock.calls[0][0].data;
    expect(createData.decisionStatus).toBe("need_info");
    const savedResult = JSON.parse(createData.resultJson);
    expect(savedResult.status).toBe("partial_failed");
    expect(savedResult.humanDecision.status).toBe("need_info");
    expect(savedResult.humanDecision.nextAction).toContain("不得进入正常推进流程");
  });

  it("keeps a completed Owner flow saveable", async () => {
    const result = await responseJson(await POST(createRequest(signedBody({})) as never));
    expect(result.status).toBe(200);
    expect(mocks.prismaCreate).toHaveBeenCalledTimes(1);
    expect(mocks.ownerTransaction).not.toHaveBeenCalled();
  });

  it("accepts a Batch save payload that carries the server proof at top level", async () => {
    const trusted = signedBody({});
    const payload = buildWorkflowBatchSavePayload({
      accessPassword: "test-access",
      workflowResult: trusted.workflowResult,
      reviewState: trusted.reviewState,
      batchMeta: {
        batchId: "batch-proof-001",
        batchName: "批量分析",
        batchIndex: 1,
        batchTotal: 1,
        source: "workflow_batch_mvp",
      },
    });

    expect(payload).not.toBeNull();
    const result = await responseJson(await POST(createRequest(payload) as never));
    expect(result.status).toBe(200);
    expect(mocks.prismaCreate).toHaveBeenCalledTimes(1);
  });

  it("allows a Visitor proof only in the same Visitor sandbox", async () => {
    authState.context = { mode: "demo", demoAccessId: "visitor-a" };
    const result = await responseJson(await POST(createRequest(signedBody({ subject: "demo:visitor-a" })) as never));

    expect(result.status).toBe(200);
    expect(mocks.createSandboxTask).toHaveBeenCalledTimes(1);
    expect(mocks.prismaCreate).not.toHaveBeenCalled();
  });

  it("rejects Visitor A proof when Visitor B tries to save it", async () => {
    authState.context = { mode: "demo", demoAccessId: "visitor-b" };
    const result = await responseJson(await POST(createRequest(signedBody({ subject: "demo:visitor-a" })) as never));

    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe("run_subject_mismatch");
    expect(mocks.createSandboxTask).not.toHaveBeenCalled();
  });
});
