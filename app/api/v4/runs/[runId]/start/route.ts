import { NextRequest, NextResponse } from "next/server";
import { requireV4Auth, jsonError, scopeMatches, v4DisabledResponse, graphResultResponse } from "@/lib/v4/apiHelpers";
import { ResearchRunStore, type ResearchRunDb } from "@/lib/v4/runStore";
import { prisma } from "@/lib/server/db";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";
import { startRun, resumeRun, cancelRun } from "@/lib/v4/graph";
import type { ResumePayload } from "@/lib/v4/contracts";

export const runtime = "nodejs";
export const maxDuration = 120;

const REQUEST_BODY_LIMIT_BYTES = 16 * 1024;

function normalizeResumePayload(raw: unknown): ResumePayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "human_decision" && (r.decision === "continue" || r.decision === "stop")) {
    return { kind: "human_decision", decision: r.decision, note: typeof r.note === "string" ? r.note.slice(0, 2000) : undefined };
  }
  if (r.kind === "input" && typeof r.value === "string" && r.value.length > 0 && r.value.length <= 2000) {
    return { kind: "input", value: r.value };
  }
  if (r.kind === "retry") return { kind: "retry" };
  return null;
}

export async function POST(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
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

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonError("body_too_large", "请求体过大。", 413);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("invalid_json", "请求格式不正确。", 400);
  }
  const expectedRevision = typeof body.expectedRevision === "number" && Number.isInteger(body.expectedRevision)
    ? body.expectedRevision
    : -1;
  if (expectedRevision < 0) return jsonError("invalid_revision", "缺少 expectedRevision。", 400);


  const result = await startRun(runId, expectedRevision);

  return graphResultResponse(result);
}
