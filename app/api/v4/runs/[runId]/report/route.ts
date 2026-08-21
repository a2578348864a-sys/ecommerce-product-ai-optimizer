import { NextRequest, NextResponse } from "next/server";
import { requireV4Auth, jsonError, jsonOk, scopeMatches, v4DisabledResponse } from "@/lib/v4/apiHelpers";
import { ResearchRunStore, type ResearchRunDb } from "@/lib/v4/runStore";
import { prisma } from "@/lib/server/db";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  if (!requireV4GraphEnabled().ok) return v4DisabledResponse();
  const params = await context.params;
  const runId = params.runId?.trim().slice(0, 128) ?? "";
  if (!runId) return jsonError("invalid_id", "运行标识无效。", 400);

  const gate = requireV4Auth(request, {});
  if (gate instanceof NextResponse) return gate;

  const store = new ResearchRunStore(prisma as unknown as ResearchRunDb);
  const run = await store.getRun(runId);
  if (!run) return jsonError("run_not_found", "运行不存在。", 404);
  if (!scopeMatches(gate.ctx, run.ownerScope, run.sandboxId)) {
    return jsonError("run_not_found", "运行不存在。", 404);
  }
  if (!run.reportJson) return jsonError("report_not_ready", "市场报告尚未生成。", 404);
  let report: unknown;
  try { report = JSON.parse(run.reportJson); } catch { return jsonError("report_invalid", "报告数据损坏。", 500); }
  return jsonOk({ report });
}
