import { NextRequest, NextResponse } from "next/server";
import { requireV4Auth, jsonError, jsonOk, scopeMatches, v4DisabledResponse } from "@/lib/v4/apiHelpers";
import { ResearchRunStore, type ResearchRunDb } from "@/lib/v4/runStore";
import { createPrismaFactStore, revokeFact } from "@/lib/v4/factStore";
import { prisma } from "@/lib/server/db";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";

export const runtime = "nodejs";

/** POST /api/v4/runs/[runId]/facts/[factKey]/revoke — 撤销当前确认（追加新 revision）。factKey = offerIdentity|variantKey|field。 */
export async function POST(request: NextRequest, context: { params: Promise<{ runId: string; factKey: string }> }) {
  if (!requireV4GraphEnabled().ok) return v4DisabledResponse();
  const params = await context.params;
  const runId = params.runId?.trim().slice(0, 128) ?? "";
  const factKey = params.factKey?.trim().slice(0, 256) ?? "";
  if (!runId || !factKey) return jsonError("invalid_id", "参数无效。", 400);

  const gate = requireV4Auth(request, {});
  if (gate instanceof NextResponse) return gate;

  const runStore = new ResearchRunStore(prisma as unknown as ResearchRunDb);
  const run = await runStore.getRun(runId);
  if (!run) return jsonError("run_not_found", "运行不存在。", 404);
  if (!scopeMatches(gate.ctx, run.ownerScope, run.sandboxId)) {
    return jsonError("run_not_found", "运行不存在。", 404);
  }
  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { /* 空 body 允许 */ }
  const [offerIdentity, variantKey, field] = factKey.split("|").map((s) => s.slice(0, 128));
  if (!offerIdentity || !variantKey || !field) return jsonError("invalid_fact_key", "事实键格式无效。", 400);
  const actor = gate.ctx.mode === "demo" ? gate.ctx.demoAccessId : "owner";
  const record = await revokeFact(createPrismaFactStore(), {
    runId, offerIdentity, variantKey, field, actor,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : "",
  });
  if (!record) return jsonError("fact_not_found", "该事实不存在。", 404);
  return jsonOk({ fact: record }, 201);
}
