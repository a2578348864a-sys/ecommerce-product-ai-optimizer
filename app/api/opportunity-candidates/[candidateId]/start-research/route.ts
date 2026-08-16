import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { createOrGetResearchTask, StartResearchError } from "@/lib/server/startResearchTask";

export const runtime = "nodejs";

/**
 * F1：开始研究（create or get Research Task）。
 * 幂等：候选已转任务 → 返回既有 taskId（continue）。
 * 前端收到 taskId 后直接 redirect /tasks/[taskId]（Research Workbench）。
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ candidateId: string }> },
) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: { code: auth.code, message: auth.message } },
      { status: auth.status },
    );
  }
  const { candidateId } = await context.params;
  try {
    const result = await createOrGetResearchTask(auth.context, candidateId);
    return NextResponse.json({ ok: true, data: result }, { status: 200 });
  } catch (error) {
    if (error instanceof StartResearchError) {
      return NextResponse.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { ok: false, error: { code: "start_research_failed", message: "开始研究失败，请稍后重试。" } },
      { status: 500 },
    );
  }
}
