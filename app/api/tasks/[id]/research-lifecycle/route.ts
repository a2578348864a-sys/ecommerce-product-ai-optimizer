import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { getSandboxTask, isSandboxTaskId } from "@/lib/server/demoSandbox";
import { prisma } from "@/lib/server/db";
import {
  getResearchLifecycleState,
  type ResearchLifecycleSnapshot,
} from "@/lib/server/researchLifecycleReader";
import { readCandidateBindingVerification } from "@/lib/server/candidateBindingVerification";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id?: string }> };

type ApiResponse =
  | { ok: true; data: ResearchLifecycleSnapshot }
  | { ok: false; error: { code: string; message: string } };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function notFound() {
  return json({
    ok: false,
    error: { code: "not_found", message: "任务不存在。" },
  }, 404);
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) {
    return json({
      ok: false,
      error: { code: auth.code, message: auth.message },
    }, auth.status);
  }

  const { id: rawId } = await context.params;
  const taskId = typeof rawId === "string" ? rawId.trim() : "";
  if (!taskId) {
    return json({
      ok: false,
      error: { code: "invalid_task_id", message: "缺少有效 task id。" },
    }, 400);
  }

  try {
    if (isSandboxTaskId(taskId)) {
      if (auth.context.mode !== "demo") return notFound();
      const task = getSandboxTask(auth.context.demoAccessId, taskId);
      if (!task) return notFound();

      const result = safeParseJson(task.resultJson);
      const binding = await readCandidateBindingVerification(auth.context, taskId, result);

      const snapshot = getResearchLifecycleState({
        result,
        decisionStatus: task.decisionStatus,
        type: task.type,
        candidateBindingValid: binding?.status === "verified" ? true : binding?.status === "invalid" ? false : undefined,
      });
      return json({ ok: true, data: snapshot });
    }

    // Demo credentials may read only sandbox tasks. Do not disclose owner task existence.
    if (auth.context.mode === "demo") return notFound();

    const task = await prisma.viralAnalysisRecord.findFirst({
      where: { id: taskId },
      select: { type: true, decisionStatus: true, resultJson: true },
    });
    if (!task) return notFound();

    const result = safeParseJson(task.resultJson);
    const binding = await readCandidateBindingVerification(auth.context, taskId, result);

    const snapshot = getResearchLifecycleState({
      result,
      decisionStatus: task.decisionStatus,
      type: task.type,
      candidateBindingValid: binding?.status === "verified" ? true : binding?.status === "invalid" ? false : undefined,
    });
    return json({ ok: true, data: snapshot });
  } catch {
    return json({
      ok: false,
      error: { code: "server_error", message: "研究生命周期读取失败，请稍后重试。" },
    }, 500);
  }
}
