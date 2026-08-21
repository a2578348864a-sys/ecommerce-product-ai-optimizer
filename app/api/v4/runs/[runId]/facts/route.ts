import { NextRequest, NextResponse } from "next/server";
import { requireV4Auth, jsonError, jsonOk, scopeMatches, v4DisabledResponse } from "@/lib/v4/apiHelpers";
import { ResearchRunStore, type ResearchRunDb } from "@/lib/v4/runStore";
import { appendFact, createPrismaFactStore, revokeFact, validateFactConfirmation } from "@/lib/v4/factStore";
import { prisma } from "@/lib/server/db";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";

export const runtime = "nodejs";

/** POST /api/v4/runs/[runId]/facts — 逐项事实确认/reject/unknown/conflict；POST .../[factKey]/revoke — 撤销。 */
export async function POST(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  if (!requireV4GraphEnabled().ok) return v4DisabledResponse();
  const params = await context.params;
  const runId = params.runId?.trim().slice(0, 128) ?? "";
  if (!runId) return jsonError("invalid_id", "运行标识无效。", 400);

  const gate = requireV4Auth(request, {});
  if (gate instanceof NextResponse) return gate;

  const runStore = new ResearchRunStore(prisma as unknown as ResearchRunDb);
  const run = await runStore.getRun(runId);
  if (!run) return jsonError("run_not_found", "运行不存在。", 404);
  if (!scopeMatches(gate.ctx, run.ownerScope, run.sandboxId)) {
    return jsonError("run_not_found", "运行不存在。", 404);
  }

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return jsonError("invalid_json", "请求格式不正确。", 400); }
  const offerIdentity = typeof body.offerIdentity === "string" ? body.offerIdentity.slice(0, 128) : "";
  const variantKey = typeof body.variantKey === "string" ? body.variantKey.slice(0, 128) : "";
  const field = typeof body.field === "string" ? body.field.slice(0, 64) : "";
  const value = typeof body.value === "string" ? body.value.slice(0, 2000) : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!offerIdentity || !variantKey || !field || !["confirmed", "rejected", "unknown", "conflict"].includes(status)) {
    return jsonError("invalid_input", "缺少 offerIdentity/variantKey/field/status。", 400);
  }
  const actor = gate.ctx.mode === "demo" ? gate.ctx.demoAccessId : "owner";
  const candidateId = run.candidateId;
  const input = {
    runId, candidateId, offerIdentity, variantKey, field, value,
    status: status as "confirmed" | "rejected" | "unknown" | "conflict",
    confirmationMethod: typeof body.confirmationMethod === "string" ? body.confirmationMethod.slice(0, 32) : null,
    claimRefs: Array.isArray(body.claimRefs) ? body.claimRefs.filter((x): x is string => typeof x === "string").slice(0, 50) : [],
    documentRefs: Array.isArray(body.documentRefs) ? body.documentRefs.filter((x): x is string => typeof x === "string").slice(0, 50) : [],
    actor,
    detail: typeof body.detail === "object" && body.detail !== null ? body.detail as Record<string, unknown> : {},
  };
  // P3-C 加固（provenance）：claimRefs 必须能在本 run 的持久化证据/事件中找到（防页面 304 宣传/竞品值伪造引用）。
  const claimRefs = input.claimRefs;
  const provenanceBlob = (run.stateJson + run.eventsJson);
  const missingRefs = claimRefs.filter((ref) => !provenanceBlob.includes(ref));
  if (missingRefs.length > 0) {
    return jsonError("fact_provenance_failed", "引用不属于本运行：" + missingRefs.join(","), 400);
  }
  const v = validateFactConfirmation(input);
  if (!v.ok) return jsonError("fact_validation_failed", v.reason, 400);

  const record = await appendFact(createPrismaFactStore(), input);
  return jsonOk({ fact: record }, 201);
}
