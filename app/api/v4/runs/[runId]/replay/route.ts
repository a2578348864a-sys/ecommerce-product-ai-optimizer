import { NextRequest, NextResponse } from "next/server";
import { requireV4OwnerAuth, jsonError, jsonOk, v4DisabledResponse } from "@/lib/v4/apiHelpers";
import { ResearchRunStore, type ResearchRunDb } from "@/lib/v4/runStore";
import { prisma } from "@/lib/server/db";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";
import { exportReplayBundle } from "@/lib/v4/replay/exporter";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BUNDLES_DIR = "data/replay-bundles";

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

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

  const result = await exportReplayBundle({
    sourceRunId: run.id,
    runStatus: run.status,
    capturedAt: run.updatedAt instanceof Date ? run.updatedAt.toISOString() : String(run.updatedAt),
    data: {
      candidate: { id: run.candidateId },
      report: safeParse(run.reportJson),
      commercial: safeParse(run.commercialJson),
      content: safeParse(run.contentJson),
      events: safeParse(run.eventsJson),
    },
  });
  if (!result.ok) return jsonError("export_failed", result.reason, 400);
  // 审批落盘：仅当 bundle 可发布（scanOk）且 Owner 显式 approve
  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { /* 无 body = 仅预览 */ }
  if (body.approve === true) {
    if (!result.bundle.redactionReport.scanOk) return jsonError("redaction_scan_failed", "脱敏扫描未通过，不可发布。", 409);
    mkdirSync(BUNDLES_DIR, { recursive: true });
    const file = join(BUNDLES_DIR, result.bundle.bundleId + ".json");
    writeFileSync(file, JSON.stringify(result.bundle), "utf8");
    return jsonOk({ bundle: result.bundle, redactionReport: result.bundle.redactionReport, published: true }, 200);
  }
  return jsonOk({ bundle: result.bundle, redactionReport: result.bundle.redactionReport, published: false }, 200);
}
