import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  requireAuthenticated,
  reserveDemoAiJob,
  markDemoAiJobProviderCallStarted,
  settleDemoAiJob,
  type DemoAccessSnapshot,
  type DemoAiJobQuotaReservation,
} from "@/lib/server/demoGuard";
import {
  getAuthoritativeCandidate,
  type AuthoritativeCandidate,
} from "@/lib/server/candidateAuthority";
import {
  buildCandidateAnalysisContext,
  createCandidateAnalysisBindingHash,
  formatCandidateAnalysisPromptContext,
} from "@/lib/server/candidateAnalysisContext";
import { isCandidateReadyForAgent } from "@/lib/opportunityCandidatePool";
import {
  buildR22PendingCommercialRunSnapshot,
  type R22CommercialRunSnapshot,
} from "@/lib/r22CommercialValidation";
import {
  parseR22MarketDecisionFromAnalysisJson,
  type R22MarketDecisionSnapshot,
} from "@/lib/r22DecisionModel";
import {
  buildWorkflowRunSubject,
  createWorkflowInputHash,
  createWorkflowResultHash,
  createWorkflowRunProof,
  normalizeWorkflowRunInput,
  type WorkflowRunInput,
} from "@/lib/server/workflowRunProof";
import {
  evaluateCandidateResearchEligibility,
} from "@/lib/server/candidateResearchEligibility";
import {
  runSourcingStep,
  runRiskStep,
  runSummaryStep,
  runListingStep,
  PRODUCT_ANALYSIS_AI_TIMEOUT_MS,
  type SourcingStepOutput,
  type RiskStepOutput,
  type SummaryStepOutput,
  type ListingStepOutput,
  type StepStatus,
} from "@/lib/workflows/productAnalysis";

/* ── Config ────────────────────────────────────── */

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_PRODUCT_NAME_LENGTH = 120;
const JOB_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* ── Types ─────────────────────────────────────── */

type WorkflowStepKey = "normalize" | "sourcing" | "risk" | "summary" | "listing" | "report";

type WorkflowStep = {
  key: WorkflowStepKey;
  label: string;
  status: StepStatus;
  summary: string;
  warnings: string[];
  startedAt: string | null;
  finishedAt: string | null;
};

type FinalReport = {
  finalVerdict: string;
  riskLevel: "green" | "yellow" | "red";
  beginnerFit: string;
  canTestSmallBatch: boolean;
  mustCheckBeforeListing: string[];
  nextSteps: string[];
  manualReviewChecklist: string[];
};

type WorkflowResult = {
  ok: boolean;
  workflowId: string;
  runId: string;
  input: WorkflowRunInput;
  productName: string;
  status: "completed" | "partial_failed" | "failed";
  steps: WorkflowStep[];
  sourcing: SourcingStepOutput | null;
  risk: RiskStepOutput | null;
  summary: SummaryStepOutput | null;
  listing: ListingStepOutput | null;
  finalReport: FinalReport | null;
  costGuard: {
    aiStepsRequested: number;
    aiStepsCompleted: number;
    fallbackSteps: number;
    providerCallsPlanned: number;
    providerCallsStarted: number;
    providerCallsCompleted: number;
    providerCallsFailed: number;
    quotaMetric: "ai_jobs_v1";
  };
  warnings: string[];
  r22CommercialValidation?: R22CommercialRunSnapshot;
  researchMode?: "market_research_only";
  promotionEligible?: false;
  aiJob?: {
    jobType: "product_research";
    jobRequestId: string;
    status: "committed" | "refunded";
    quotaMetric: "ai_jobs_v1";
    providerCallsPlanned: number;
    providerCallsStarted: number;
    providerCallsCompleted: number;
    providerCallsFailed: number;
  };
};

/* ── Helpers ───────────────────────────────────── */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function makeWorkflowId(): string {
  return `wf-${randomUUID()}`;
}

function stepResult(
  key: WorkflowStepKey,
  label: string,
  status: StepStatus,
  summary: string,
  warnings: string[] = [],
  startedAt: string | null = null,
  finishedAt: string | null = null,
): WorkflowStep {
  return { key, label, status, summary, warnings, startedAt, finishedAt };
}

/* ── Final report builder ──────────────────────── */

function buildFinalReport(
  sourcing: SourcingStepOutput | null,
  risk: RiskStepOutput | null,
  summary: SummaryStepOutput | null,
  options: { researchOnly?: boolean } = {},
): FinalReport {
  const finalVerdict = summary?.verdict || "可做但需控制成本";
  const riskLevel: "green" | "yellow" | "red" = risk?.overallLevel || "yellow";

  let beginnerFit = "需人工判断";
  if (sourcing?.beginnerFit === "high" && risk?.overallLevel === "green") beginnerFit = "适合新手小单测试";
  else if (risk?.overallLevel === "red") beginnerFit = "新手不建议";
  else if (sourcing?.beginnerFit === "low" || sourcing?.suggestedEntryLevel === "experienced") beginnerFit = "建议有经验运营操作";
  else beginnerFit = "可谨慎尝试";

  const canTestSmallBatch =
    riskLevel !== "red" &&
    (sourcing?.feasibility !== "low") &&
    (!summary?.downgraded || summary?.verdict !== "暂不建议做");

  const mustCheckBeforeListing: string[] = [];
  if (risk?.overallLevel === "red") mustCheckBeforeListing.push("高风险品类：需完成所有合规检查后再上架");
  if (sourcing?.complianceBarrier === "high") mustCheckBeforeListing.push("合规门槛高：确认认证文件和平台资质要求");
  if (risk?.blacklistMatches?.length) mustCheckBeforeListing.push(`命中高风险标签：${risk.blacklistMatches.join("、")}，需确认平台规则`);
  if (summary?.downgraded) mustCheckBeforeListing.push("系统已自动降级结论，人工复核后再决定是否推进");
  mustCheckBeforeListing.push("所有 listing 文案和合规声明需人工复核后使用");

  const nextSteps: string[] = [];
  if (canTestSmallBatch) {
    nextSteps.push("联系 2-3 家供应商对比样品和报价");
    nextSteps.push("完成利润测算（采购成本+头程+佣金+退货）");
    nextSteps.push("小单测试（10-30 件），验证转化率和售后率");
  } else {
    nextSteps.push("先完成合规和认证评估再推进");
    nextSteps.push("向供应商索取检测报告和认证文件");
  }
  if (sourcing?.complianceBarrier === "high") nextSteps.push("确认目标平台的资质审核要求和类目限制");
  nextSteps.push("将分析结果保存到任务中心，标记决策状态");

  const manualReviewChecklist = [
    "是否涉及品牌、外观、图片、专利侵权风险",
    "是否涉及儿童、食品接触、带电、带磁、液体等高风险品类",
    "目标平台规则是否允许销售该类商品",
    "是否需要 CPC/ASTM/FDA/FCC/CE 等认证，能否从供应商获取合规文件",
    "成本、运费、平台佣金、退货和售后费用是否可控",
    "供应商资质、MOQ、样品质量和交期是否已核实",
    "AI 结论仅作辅助参考，不作为最终采购或经营决策依据",
  ];

  if (options.researchOnly) {
    return {
      finalVerdict: "仅供市场研究，等待人工核验",
      riskLevel,
      beginnerFit: "尚未形成商业判断",
      canTestSmallBatch: false,
      mustCheckBeforeListing: [
        "不得把本次 ProductBatch 研究视为商业晋级、采购或上架依据",
        ...mustCheckBeforeListing,
      ],
      nextSteps: [
        "核对 SellerSprite 第三方估算口径、缺失字段和冲突信号",
        "补充公开市场、供应链与合规证据后由人工决定是否继续",
        "在研究历史中保存本次证据与人工确认记录",
      ],
      manualReviewChecklist,
    };
  }

  return { finalVerdict, riskLevel, beginnerFit, canTestSmallBatch, mustCheckBeforeListing, nextSteps, manualReviewChecklist };
}

/* ── POST handler ──────────────────────────────── */

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: { code: "invalid_json", message: "请求格式不正确。" } }, { status: 400 });
  }

  if (!isPlainObject(body)) {
    return NextResponse.json({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, { status: 400 });
  }

  // Demo-Login.1-E: Authenticate (Owner or Demo)
  const authResult = requireAuthenticated(request, body as Record<string, unknown>);
  if (!authResult.ok) {
    return NextResponse.json(
      { ok: false, error: { code: authResult.code, message: authResult.message } },
      { status: authResult.status },
    );
  }
  const accessCtx = authResult.context;
  let demoScreen: DemoAccessSnapshot | null = null;

  // Reject batch before string normalization
  if (Array.isArray(body.productName) || (body.products && Array.isArray(body.products))) {
    return NextResponse.json({ ok: false, error: { code: "batch_not_supported", message: "当前只支持单品工作流，暂不支持批量输入。" } }, { status: 400 });
  }

  const sourceRaw = asString(body.source);
  const candidateId = asString(body.candidateId).slice(0, 80) || null;
  const source: WorkflowRunInput["source"] = candidateId
    ? "opportunity"
    : sourceRaw === "opportunity" || sourceRaw === "task"
      ? sourceRaw
      : "manual";
  if (source === "opportunity" && !candidateId) {
    return NextResponse.json(
      { ok: false, error: { code: "candidate_id_required", message: "请从候选品池选择商品后进入 Agent。" } },
      { status: 400 },
    );
  }
  const clientProductName = asString(body.productName).slice(0, MAX_PRODUCT_NAME_LENGTH).trim();
  let productName = clientProductName;
  let candidateForAnalysis: AuthoritativeCandidate | null = null;
  let r22MarketDecision: R22MarketDecisionSnapshot | null = null;
  let productBatchResearchMode = false;
  if (candidateId) {
    const candidate = await getAuthoritativeCandidate(accessCtx, candidateId);
    if (!candidate) {
      return NextResponse.json(
        { ok: false, error: { code: "candidate_not_found", message: "候选商品不存在或不属于当前访问主体。" } },
        { status: 404 },
      );
    }
    if (!isCandidateReadyForAgent(candidate.status)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "candidate_not_ready",
            message: candidate.status === "rejected"
              ? "该候选已放弃，请先恢复并重新选择后再分析。"
              : "该候选尚未进入待分析队列，请先在候选品池中确认。",
          },
        },
        { status: 409 },
      );
    }
    const researchEligibility = await evaluateCandidateResearchEligibility(accessCtx, candidate);
    if (!researchEligibility.allowed) {
      const productBatch = researchEligibility.originKind === "seller_sprite_product_batch";
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: productBatch
              ? "candidate_product_batch_research_blocked"
              : "candidate_r22_stage2_blocked",
            message: productBatch
              ? "该 ProductBatch Candidate 的来源或状态已变化，不能进入商品研究。"
              : "该候选未通过 R2.2 市场晋级门禁，不能进入商业深挖。",
            reasons: researchEligibility.reasons,
          },
        },
        { status: 409 },
      );
    }
    productBatchResearchMode = researchEligibility.originKind === "seller_sprite_product_batch";
    r22MarketDecision = productBatchResearchMode
      ? null
      : parseR22MarketDecisionFromAnalysisJson(candidate.analysisJson);
    productName = candidate.name.trim().slice(0, MAX_PRODUCT_NAME_LENGTH);
    candidateForAnalysis = candidate;
  }
  if (!productName) {
    return NextResponse.json({ ok: false, error: { code: "missing_product_name", message: "请填写商品名称。" } }, { status: 400 });
  }
  if (productName.length < 2) {
    return NextResponse.json({ ok: false, error: { code: "product_name_too_short", message: "商品名称至少需要 2 个字符。" } }, { status: 400 });
  }
  const candidateAnalysisContext = candidateForAnalysis
    ? buildCandidateAnalysisContext(candidateForAnalysis)
    : null;
  const analysisDescription = candidateAnalysisContext
    ? formatCandidateAnalysisPromptContext(candidateAnalysisContext)
    : productName;
  const candidateContextHash = candidateForAnalysis && candidateAnalysisContext
    ? createCandidateAnalysisBindingHash(candidateForAnalysis, candidateAnalysisContext)
    : null;
  const workflowInput = normalizeWorkflowRunInput({
    productName,
    source,
    candidateId,
    ...(candidateContextHash
      ? { contextHash: candidateContextHash }
      : {}),
  });
  const options = isPlainObject(body.options) ? body.options : {};
  const runSourcing = options.runSourcing !== false;
  const runRisk = options.runRisk !== false;
  const runSummary = options.runSummary !== false;
  const runListing = options.runListing !== false;
  const plannedAiCalls = [runSourcing, runRisk, runSummary, runListing].filter(Boolean).length;
  if (plannedAiCalls === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "no_ai_steps_requested", message: "请至少选择一个 AI 分析步骤。" } },
      { status: 400 },
    );
  }
  const jobRequestId = asString(body.jobRequestId).slice(0, 128);
  if (accessCtx.mode === "demo" && !JOB_REQUEST_ID_PATTERN.test(jobRequestId)) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_ai_job_request", message: "AI 作业请求标识无效，请重新发起。" } },
      { status: 400 },
    );
  }
  let quotaReservation: DemoAiJobQuotaReservation | null = null;
  if (accessCtx.mode === "demo" && plannedAiCalls > 0) {
    const quota = reserveDemoAiJob(accessCtx, {
      jobType: "product_research",
      jobRequestId,
      providerCallsPlanned: plannedAiCalls,
      leaseMs: plannedAiCalls * PRODUCT_ANALYSIS_AI_TIMEOUT_MS + 60_000,
    });
    if (!quota.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: quota.code, message: quota.message },
          ...(quota.snapshot ? { demoAccess: quota.snapshot } : {}),
        },
        { status: quota.status },
      );
    }
    quotaReservation = quota.reservation;
    if (quotaReservation?.duplicate) {
      if (quotaReservation.status === "reserved") {
        return NextResponse.json({
          ok: false,
          error: {
            code: "ai_job_in_progress",
            message: "同一商品研究作业正在执行，请勿重复提交。",
          },
          ...(quota.snapshot ? { demoAccess: quota.snapshot } : {}),
        }, { status: 409 });
      }
      return NextResponse.json({
        ok: true,
        idempotentReplay: true,
        aiJob: {
          jobType: quotaReservation.jobType,
          jobRequestId: quotaReservation.jobRequestId,
          status: quotaReservation.status,
          providerCallsPlanned: quotaReservation.providerCallsPlanned,
          providerCallsStarted: quotaReservation.providerCallsStarted ?? 0,
          providerCallsCompleted: quotaReservation.providerCallsCompleted ?? 0,
          providerCallsFailed: quotaReservation.providerCallsFailed ?? 0,
          quotaMetric: quotaReservation.quotaMetric,
        },
        ...(quota.snapshot ? { demoAccess: quota.snapshot } : {}),
      }, { status: 200 });
    }
  }

  const workflowId = makeWorkflowId();
  const runCreatedAt = new Date().toISOString();
  const r22CommercialValidation = r22MarketDecision
    ? buildR22PendingCommercialRunSnapshot(r22MarketDecision, workflowId, runCreatedAt)
    : null;
  const steps: WorkflowStep[] = [];
  const warnings: string[] = [];
  let aiStepsRequested = 0;
  let aiStepsCompleted = 0;
  let fallbackSteps = 0;
  let providerCallStartedCount = 0;
  let providerCallsCompleted = 0;
  const persistProviderCallStart = async () => {
    const nextStartedCount = providerCallStartedCount + 1;
    const marked = markDemoAiJobProviderCallStarted(accessCtx, quotaReservation, nextStartedCount);
    if (!marked.ok) throw new Error(marked.code);
    providerCallStartedCount = nextStartedCount;
  };

  const settleUnexpectedFailure = (error: unknown) => {
    if (accessCtx.mode === "demo" && quotaReservation) {
      const settlement = settleDemoAiJob(accessCtx, quotaReservation, {
        providerCallsStarted: providerCallStartedCount,
        providerCallsCompleted,
        providerCallsFailed: providerCallStartedCount - providerCallsCompleted,
      });
      if (!settlement.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: { code: settlement.code, message: settlement.message },
            ...(settlement.snapshot ? { demoAccess: settlement.snapshot } : {}),
          },
          { status: settlement.status },
        );
      }
      demoScreen = settlement.snapshot;
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "pipeline_error",
          message: error instanceof Error ? error.message : "商品分析流程异常。",
        },
        ...(demoScreen ? { demoAccess: demoScreen } : {}),
      },
      { status: 500 },
    );
  };

  // Step 0: Normalize
  steps.push(stepResult("normalize", "标准化输入", "completed", `商品名：${productName}，来源：${source}`, [], new Date().toISOString(), new Date().toISOString()));

  // Step 1: Sourcing
  let sourcingResult: SourcingStepOutput | null = null;
  if (runSourcing) {
    aiStepsRequested++;
    const startedAt = new Date().toISOString();
    const providerCallsBeforeStep = providerCallStartedCount;
    let result;
    try {
      result = await runSourcingStep(productName, analysisDescription, {
        onProviderCallStart: persistProviderCallStart,
      });
    } catch (error) {
      return settleUnexpectedFailure(error);
    }
    sourcingResult = result.data;
    if (providerCallStartedCount > providerCallsBeforeStep && result.status === "completed") {
      providerCallsCompleted++;
    }
    if (result.status === "completed") {
      aiStepsCompleted++;
    } else {
      fallbackSteps++;
    }
    steps.push(stepResult("sourcing", "货源判断", result.status, sourcingResult.summary, result.warnings, startedAt, new Date().toISOString()));
  } else {
    steps.push(stepResult("sourcing", "货源判断", "fallback", "已跳过（options.runSourcing=false）"));
  }

  // Step 2: Risk
  let riskResult: RiskStepOutput | null = null;
  if (runRisk) {
    aiStepsRequested++;
    const startedAt = new Date().toISOString();
    const providerCallsBeforeStep = providerCallStartedCount;
    let result;
    try {
      result = await runRiskStep(productName, analysisDescription, {
        onProviderCallStart: persistProviderCallStart,
      });
    } catch (error) {
      return settleUnexpectedFailure(error);
    }
    riskResult = result.data;
    if (providerCallStartedCount > providerCallsBeforeStep && result.status === "completed") {
      providerCallsCompleted++;
    }
    if (result.status === "completed") {
      aiStepsCompleted++;
    } else {
      fallbackSteps++;
    }
    steps.push(stepResult("risk", "风险排查", result.status, riskResult.summary, result.warnings, startedAt, new Date().toISOString()));
  } else {
    steps.push(stepResult("risk", "风险排查", "fallback", "已跳过（options.runRisk=false）"));
  }

  // Step 3: Summary
  let summaryResult: SummaryStepOutput | null = null;
  if (runSummary) {
    aiStepsRequested++;
    const startedAt = new Date().toISOString();
    const providerCallsBeforeStep = providerCallStartedCount;
    let result;
    try {
      result = await runSummaryStep(productName, analysisDescription, sourcingResult, riskResult, {
        onProviderCallStart: persistProviderCallStart,
      });
    } catch (error) {
      return settleUnexpectedFailure(error);
    }
    summaryResult = result.data;
    if (providerCallStartedCount > providerCallsBeforeStep && result.status === "completed") {
      providerCallsCompleted++;
    }
    if (result.status === "completed") {
      aiStepsCompleted++;
    } else {
      fallbackSteps++;
    }
    steps.push(stepResult("summary", "小白结论", result.status, summaryResult.summary, result.warnings, startedAt, new Date().toISOString()));
  } else {
    steps.push(stepResult("summary", "小白结论", "fallback", "已跳过（options.runSummary=false）"));
  }

  // Step 4: Listing
  let listingResult: ListingStepOutput | null = null;
  if (runListing) {
    aiStepsRequested++;
    const startedAt = new Date().toISOString();
    const providerCallsBeforeStep = providerCallStartedCount;
    let result;
    try {
      result = await runListingStep(productName, summaryResult, {
        onProviderCallStart: persistProviderCallStart,
      });
    } catch (error) {
      return settleUnexpectedFailure(error);
    }
    listingResult = result.data;
    if (providerCallStartedCount > providerCallsBeforeStep && result.status === "completed") {
      providerCallsCompleted++;
    }
    if (result.status === "completed") {
      aiStepsCompleted++;
    } else {
      fallbackSteps++;
    }
    steps.push(stepResult("listing", "上架文案/关键词", result.status, listingResult.title, result.warnings, startedAt, new Date().toISOString()));
  } else {
    steps.push(stepResult("listing", "上架文案/关键词", "fallback", "已跳过（options.runListing=false）"));
  }

  if (accessCtx.mode === "demo" && quotaReservation) {
    const settlement = settleDemoAiJob(accessCtx, quotaReservation, {
      providerCallsStarted: providerCallStartedCount,
      providerCallsCompleted,
      providerCallsFailed: providerCallStartedCount - providerCallsCompleted,
    });
    if (!settlement.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: settlement.code, message: settlement.message },
          ...(settlement.snapshot ? { demoAccess: settlement.snapshot } : {}),
        },
        { status: settlement.status },
      );
    }
    demoScreen = settlement.snapshot;
  }

  // Step 5: Final Report
  const reportStartedAt = new Date().toISOString();
  const finalReport = buildFinalReport(sourcingResult, riskResult, summaryResult, {
    researchOnly: productBatchResearchMode,
  });
  steps.push(stepResult("report", "生成最终报告", "completed", `最终结论：${finalReport.finalVerdict}，风险等级：${finalReport.riskLevel}`, [], reportStartedAt, new Date().toISOString()));

  // Overall status
  let overallStatus: "completed" | "partial_failed" | "failed" = "completed";
  if (fallbackSteps === aiStepsRequested && aiStepsRequested > 0) {
    overallStatus = "failed";
    warnings.push("所有 AI 步骤均失败，请检查 AI 服务配置后重试。");
  } else if (fallbackSteps > 0) {
    overallStatus = "partial_failed";
    warnings.push(`${fallbackSteps} 个步骤使用了兜底结果。`);
  }

  const result: WorkflowResult = {
    ok: true,
    workflowId,
    runId: workflowId,
    input: workflowInput,
    productName,
    status: overallStatus,
    steps,
    sourcing: sourcingResult,
    risk: riskResult,
    summary: summaryResult,
    listing: listingResult,
    finalReport,
    costGuard: {
      aiStepsRequested,
      aiStepsCompleted,
      fallbackSteps,
      providerCallsPlanned: plannedAiCalls,
      providerCallsStarted: providerCallStartedCount,
      providerCallsCompleted,
      providerCallsFailed: providerCallStartedCount - providerCallsCompleted,
      quotaMetric: "ai_jobs_v1",
    },
    warnings,
    ...(r22CommercialValidation ? { r22CommercialValidation } : {}),
    ...(productBatchResearchMode ? {
      researchMode: "market_research_only" as const,
      promotionEligible: false as const,
    } : {}),
    ...(quotaReservation ? {
      aiJob: {
        jobType: "product_research" as const,
        jobRequestId: quotaReservation.jobRequestId,
        status: (providerCallStartedCount > 0 ? "committed" : "refunded") as "committed" | "refunded",
        quotaMetric: "ai_jobs_v1" as const,
        providerCallsPlanned: plannedAiCalls,
        providerCallsStarted: providerCallStartedCount,
        providerCallsCompleted,
        providerCallsFailed: providerCallStartedCount - providerCallsCompleted,
      },
    } : {}),
    // Demo-Login.1-E: include latest demo snapshot for Banner update
    ...(demoScreen ? { demoAccess: demoScreen } : {}),
  };

  try {
    const runProof = createWorkflowRunProof({
      runId: workflowId,
      subject: buildWorkflowRunSubject(accessCtx),
      candidateId,
      inputHash: createWorkflowInputHash(workflowInput),
      resultHash: createWorkflowResultHash(result),
      status: overallStatus,
    });
    return NextResponse.json({ ...result, runProof }, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "run_proof_unavailable", message: "分析结果暂时无法生成可信凭证，请稍后重试。" },
        ...(demoScreen ? { demoAccess: demoScreen } : {}),
      },
      { status: 500 },
    );
  }
}
