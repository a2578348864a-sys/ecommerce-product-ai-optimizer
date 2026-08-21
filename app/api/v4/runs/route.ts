import { NextRequest, NextResponse } from "next/server";
import { requireV4Auth, jsonError, jsonOk, scopeForContext } from "@/lib/v4/apiHelpers";
import { getAuthoritativeCandidate } from "@/lib/server/candidateAuthority";
import { ResearchRunStore, type ResearchRunDb, listRuns } from "@/lib/v4/runStore";
import { prisma } from "@/lib/server/db";
import { startRun } from "@/lib/v4/graph";

export const runtime = "nodejs";
export const maxDuration = 120;

const REQUEST_BODY_LIMIT_BYTES = 8 * 1024;

export async function GET(request: NextRequest) {
  const gate = requireV4Auth(request, {});
  if (gate instanceof NextResponse) return gate;
  const { ownerScope, sandboxId } = scopeForContext(gate.ctx);
  const runs = await listRuns({ ownerScope, sandboxId });
  return jsonOk({ runs });
}

export async function POST(request: NextRequest) {
  const gate = requireV4Auth(request, {});
  if (gate instanceof NextResponse) return gate;
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
  const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim().slice(0, 128) : "";
  if (!candidateId) return jsonError("candidate_required", "缺少候选商品。", 400);

  // 候选身份权威校验（owner/demo 沙箱双路径，P1_CONTRACT §3）
  const candidate = await getAuthoritativeCandidate(gate.ctx, candidateId);
  if (!candidate) return jsonError("candidate_invalid", "候选商品不存在或不可访问。", 404);

  const { ownerScope, sandboxId } = scopeForContext(gate.ctx);
  const store = new ResearchRunStore(prisma as unknown as ResearchRunDb);
  const runId = crypto.randomUUID();
  try {
    await store.createRun({ id: runId, candidateId, ownerScope, sandboxId, mode: "local_live" });
  } catch (error) {
    console.error("v4 createRun failed", error);
    return jsonError("internal_error", "创建运行失败。", 500);
  }
  const result = await startRun(runId, 0);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: { code: result.code, message: result.safeMessage ?? "启动失败。", latestRevision: result.latestRevision } },
      { status: result.code === "REVISION_CONFLICT" ? 409 : 400 },
    );
  }
  return jsonOk({ run: result.state, events: result.events }, 201);
}
