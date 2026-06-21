import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { checkAccessPassword } from "@/lib/server/accessPassword";

export const runtime = "nodejs";

/* ── Types ─────────────────────────────────────── */

type ApiResponse =
  | { ok: true; data: { id: string; title: string; type: string } }
  | { ok: false; error: { code: string; message: string } };

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

/* ── Helpers ───────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function workflowScoreFromRiskLevel(riskLevel: string): number {
  if (riskLevel === "green") return 85;
  if (riskLevel === "red") return 25;
  return 55; // yellow / unknown
}

/* ── POST handler ──────────────────────────────── */

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求格式不正确。" } }, 400);
  }

  if (!isRecord(body)) {
    return jsonResponse({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, 400);
  }

  // Access password
  const passwordResult = checkAccessPassword(request, body as Record<string, unknown>);
  if (passwordResult) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "访问密码错误或缺失。" } },
      { status: passwordResult.status },
    );
  }

  // Validate workflow result
  const workflowResult = body.workflowResult;
  if (!isRecord(workflowResult)) {
    return jsonResponse({ ok: false, error: { code: "missing_workflow_result", message: "请先完成一键分析后再保存。" } }, 400);
  }

  if (!workflowResult.ok) {
    return jsonResponse({ ok: false, error: { code: "workflow_not_ok", message: "工作流未成功完成，无法保存。请重新分析后再试。" } }, 400);
  }

  const finalReport = workflowResult.finalReport;
  if (!isRecord(finalReport)) {
    return jsonResponse({ ok: false, error: { code: "missing_final_report", message: "工作流结果缺少最终报告，无法保存。" } }, 400);
  }

  const productName = asString(workflowResult.productName);
  if (!productName) {
    return jsonResponse({ ok: false, error: { code: "missing_product_name", message: "工作流结果缺少商品名，无法保存。" } }, 400);
  }

  const finalVerdict = asString(finalReport.finalVerdict, "未评级");
  const riskLevel = asString(finalReport.riskLevel, "yellow");
  const score = workflowScoreFromRiskLevel(riskLevel);

  // Build a structured result for the task record
  const taskResult = {
    type: "workflow",
    workflowId: asString(workflowResult.workflowId),
    productName,
    status: asString(workflowResult.status),
    finalReport,
    steps: Array.isArray(workflowResult.steps) ? workflowResult.steps : [],
    costGuard: isRecord(workflowResult.costGuard) ? workflowResult.costGuard : {},
  };

  try {
    const record = await prisma.viralAnalysisRecord.create({
      data: {
        type: "workflow",
        title: `${productName} 一键分析`,
        platform: "manual",
        productUrl: null,
        materialText: productName,
        source: "ai",
        score,
        level: riskLevel,
        oneLineSummary: finalVerdict,
        resultJson: JSON.stringify(taskResult),
      },
    });

    return jsonResponse({
      ok: true,
      data: {
        id: record.id,
        title: record.title || productName,
        type: "workflow",
      },
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: {
        code: "database_error",
        message: error instanceof Error && error.message.includes("database")
          ? "数据库暂时不可用，请稍后重试。"
          : "保存任务失败，请稍后重试。",
      },
    }, 500);
  }
}
