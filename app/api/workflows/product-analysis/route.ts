import { NextRequest, NextResponse } from "next/server";
import { checkAccessPassword } from "@/lib/server/accessPassword";
import {
  runSourcingStep,
  runRiskStep,
  runSummaryStep,
  runListingStep,
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
  };
  warnings: string[];
};

/* ── Helpers ───────────────────────────────────── */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function makeWorkflowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `wf-${crypto.randomUUID()}`;
  }
  return `wf-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
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

  // Access password
  const passwordResult = checkAccessPassword(request, body as Record<string, unknown>);
  if (passwordResult) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "访问密码错误或缺失。" } },
      { status: passwordResult.status },
    );
  }

  // Reject batch before string normalization
  if (Array.isArray(body.productName) || (body.products && Array.isArray(body.products))) {
    return NextResponse.json({ ok: false, error: { code: "batch_not_supported", message: "当前只支持单品工作流，暂不支持批量输入。" } }, { status: 400 });
  }

  // Validate productName
  const productNameRaw = asString(body.productName).slice(0, MAX_PRODUCT_NAME_LENGTH).trim();
  if (!productNameRaw) {
    return NextResponse.json({ ok: false, error: { code: "missing_product_name", message: "请填写商品名称。" } }, { status: 400 });
  }
  if (productNameRaw.length < 2) {
    return NextResponse.json({ ok: false, error: { code: "product_name_too_short", message: "商品名称至少需要 2 个字符。" } }, { status: 400 });
  }

  const productName = productNameRaw;
  const source = ["manual", "opportunity", "task"].includes(asString(body.source)) ? asString(body.source) : "manual";
  const options = isPlainObject(body.options) ? body.options : {};
  const runSourcing = options.runSourcing !== false;
  const runRisk = options.runRisk !== false;
  const runSummary = options.runSummary !== false;
  const runListing = options.runListing !== false;

  const workflowId = makeWorkflowId();
  const steps: WorkflowStep[] = [];
  const warnings: string[] = [];
  let aiStepsRequested = 0;
  let aiStepsCompleted = 0;
  let fallbackSteps = 0;

  // Step 0: Normalize
  steps.push(stepResult("normalize", "标准化输入", "completed", `商品名：${productName}，来源：${source}`, [], new Date().toISOString(), new Date().toISOString()));

  // Step 1: Sourcing
  let sourcingResult: SourcingStepOutput | null = null;
  if (runSourcing) {
    aiStepsRequested++;
    const startedAt = new Date().toISOString();
    const result = await runSourcingStep(productName, productName);
    sourcingResult = result.data;
    if (result.status === "completed") aiStepsCompleted++;
    else fallbackSteps++;
    steps.push(stepResult("sourcing", "货源判断", result.status, sourcingResult.summary, result.warnings, startedAt, new Date().toISOString()));
  } else {
    steps.push(stepResult("sourcing", "货源判断", "fallback", "已跳过（options.runSourcing=false）"));
  }

  // Step 2: Risk
  let riskResult: RiskStepOutput | null = null;
  if (runRisk) {
    aiStepsRequested++;
    const startedAt = new Date().toISOString();
    const result = await runRiskStep(productName, productName);
    riskResult = result.data;
    if (result.status === "completed") aiStepsCompleted++;
    else fallbackSteps++;
    steps.push(stepResult("risk", "风险排查", result.status, riskResult.summary, result.warnings, startedAt, new Date().toISOString()));
  } else {
    steps.push(stepResult("risk", "风险排查", "fallback", "已跳过（options.runRisk=false）"));
  }

  // Step 3: Summary
  let summaryResult: SummaryStepOutput | null = null;
  if (runSummary) {
    aiStepsRequested++;
    const startedAt = new Date().toISOString();
    const result = await runSummaryStep(productName, productName, sourcingResult, riskResult);
    summaryResult = result.data;
    if (result.status === "completed") aiStepsCompleted++;
    else fallbackSteps++;
    steps.push(stepResult("summary", "小白结论", result.status, summaryResult.summary, result.warnings, startedAt, new Date().toISOString()));
  } else {
    steps.push(stepResult("summary", "小白结论", "fallback", "已跳过（options.runSummary=false）"));
  }

  // Step 4: Listing
  let listingResult: ListingStepOutput | null = null;
  if (runListing) {
    aiStepsRequested++;
    const startedAt = new Date().toISOString();
    const result = await runListingStep(productName, summaryResult);
    listingResult = result.data;
    if (result.status === "completed") aiStepsCompleted++;
    else fallbackSteps++;
    steps.push(stepResult("listing", "上架文案/关键词", result.status, listingResult.title, result.warnings, startedAt, new Date().toISOString()));
  } else {
    steps.push(stepResult("listing", "上架文案/关键词", "fallback", "已跳过（options.runListing=false）"));
  }

  // Step 5: Final Report
  const reportStartedAt = new Date().toISOString();
  const finalReport = buildFinalReport(sourcingResult, riskResult, summaryResult);
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
    productName,
    status: overallStatus,
    steps,
    sourcing: sourcingResult,
    risk: riskResult,
    summary: summaryResult,
    listing: listingResult,
    finalReport,
    costGuard: { aiStepsRequested, aiStepsCompleted, fallbackSteps },
    warnings,
  };

  return NextResponse.json(result, { status: 200 });
}
