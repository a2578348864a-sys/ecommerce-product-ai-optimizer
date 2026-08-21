import { NextRequest, NextResponse } from "next/server";
import { requireV4Auth, jsonError, jsonOk, scopeMatches, v4DisabledResponse } from "@/lib/v4/apiHelpers";
import { ResearchRunStore, type ResearchRunDb } from "@/lib/v4/runStore";
import { prisma } from "@/lib/server/db";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";

export const runtime = "nodejs";

/** POST /api/v4/runs/[runId]/content/review — 内容人工审核（不自动发布）。choice: approve_export | request_revision | reject_asset */
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
  if (!scopeMatches(gate.ctx, run.ownerScope, run.sandboxId)) return jsonError("run_not_found", "运行不存在。", 404);

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return jsonError("invalid_json", "请求格式不正确。", 400); }
  const choice = typeof body.choice === "string" ? body.choice : "";
  if (!["approve_export", "request_revision", "reject_asset"].includes(choice)) {
    return jsonError("invalid_choice", "无效审核选项。", 400);
  }
  const actor = gate.ctx.mode === "demo" ? gate.ctx.demoAccessId : "owner";
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";
  const current = await store.getRun(runId);
  if (!current) return jsonError("run_not_found", "运行不存在。", 404);
  const content = current.contentJson ? JSON.parse(current.contentJson) : {};
  // P5-C 裁定：已阻断资产不得 approve_export
  if (choice === "approve_export") {
    const listing = (content as { listing?: { blocked?: boolean } }).listing;
    const images = (content as { images?: { checks?: { checks?: { pass?: boolean }[]; overallStatus?: string } } }).images;
    const visualBlocked = images?.checks?.overallStatus === "blocked" || (images?.checks?.checks?.some((chk) => chk.pass === false) ?? false);
    const blocked = listing?.blocked === true || visualBlocked;
    if (blocked) {
      return jsonError("content_blocked", "存在阻断项（Listing blocked 或视觉检查失败），不可导出。", 409);
    }
  }
  const updated = { ...(content as Record<string, unknown>), review: { choice, note, actor, at: new Date().toISOString() } };
  await store.saveRun(runId, current.revision, { stateJson: current.stateJson, contentJson: JSON.stringify(updated) });
  return jsonOk({ review: updated.review }, 200);
}
