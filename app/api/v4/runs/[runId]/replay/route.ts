import { NextRequest, NextResponse } from "next/server";
import { requireV4OwnerAuth, jsonError, jsonOk, v4DisabledResponse } from "@/lib/v4/apiHelpers";
import { ResearchRunStore, type ResearchRunDb } from "@/lib/v4/runStore";
import { prisma } from "@/lib/server/db";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";
import { exportReplayBundle } from "@/lib/v4/replay/exporter";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/v4/runs/[runId]/replay — Owner 导出预览（脱敏 bundle + redactionReport + hash；不落盘）。 */
export async function POST(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  if (!requireV4GraphEnabled().ok) return v4DisabledResponse();
  const params = await context.params;
  const runId = params.runId?.trim().slice(0, 128) ?? "";
  if (!runId) return jsonError("invalid_id", "运行标识无效。", 400);
  const gate = requireV4OwnerAuth(request, {});
  if (gate instanceof NextResponse) return gate;

  const store = new ResearchRunStore(prisma as unknown as ResearchRunDb);
  const run = await store.getRun(runId);
  if (!run) return jsonError("run_not_found", "运行不存在。", 404);
  if (run.ownerScope !== "owner") return jsonError("run_not_found", "运行不存在。", 404);
  if (run.status !== "completed") return jsonError("run_not_completed", "仅已完成运行可导出。", 409);

  const result = await exportReplayBundle({ run, now: () => new Date().toISOString() });
  if (!result.ok) return jsonError("export_failed", result.reason, 400);
  return jsonOk({ bundle: result.bundle, redactionReport: result.bundle.redactionReport }, 200);
}
