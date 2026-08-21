import { NextRequest, NextResponse } from "next/server";
import { requireV4Auth, jsonError, jsonOk, scopeMatches, v4DisabledResponse } from "@/lib/v4/apiHelpers";
import { ResearchRunStore, type ResearchRunDb } from "@/lib/v4/runStore";
import { prisma } from "@/lib/server/db";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";
import { calcCommercial } from "@/lib/v4/calculator/calc";
import type { CalcInput, CalcOutput } from "@/lib/v4/calculator/contract";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_RULES = {
  version: "calc-commercial.v1",
  marketplace: "US",
  category: "home",
  reviewedAt: new Date().toISOString(),
  sourceUrl: "https://sellercentral.amazon.com/help/hub/reference/external/G201074110",
  stale: false,
};

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  if (!requireV4GraphEnabled().ok) return v4DisabledResponse();
  const params = await context.params;
  const runId = params.runId?.trim().slice(0, 128) ?? "";
  if (!runId) return jsonError("invalid_id", "运行标识无效。", 400);
  const gate = requireV4Auth(request, {});
  if (gate instanceof NextResponse) return gate;
  const runStore = new ResearchRunStore(prisma as unknown as ResearchRunDb);
  const run = await runStore.getRun(runId);
  if (!run) return jsonError("run_not_found", "运行不存在。", 404);
  if (!scopeMatches(gate.ctx, run.ownerScope, run.sandboxId)) return jsonError("run_not_found", "运行不存在。", 404);
  if (!run.commercialJson) return jsonError("commercial_not_ready", "商业计算尚未生成。", 404);
  let out: unknown; try { out = JSON.parse(run.commercialJson); } catch { return jsonError("commercial_invalid", "数据损坏。", 500); }
  return jsonOk({ commercial: out });
}

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
  if (!scopeMatches(gate.ctx, run.ownerScope, run.sandboxId)) return jsonError("run_not_found", "运行不存在。", 404);

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return jsonError("invalid_json", "请求格式不正确。", 400); }
  const input = body.input as CalcInput;
  if (!input || typeof input !== "object") return jsonError("invalid_input", "缺少计算输入。", 400);
  const result = calcCommercial(input, { now: new Date().toISOString(), rulesMeta: DEFAULT_RULES });
  if (!result.ok) {
    return jsonError(result.code.toLowerCase(), result.message, result.code === "RULES_STALE" ? 409 : 400);
  }
  // persist output on the run row
  const current = await runStore.getRun(runId);
  if (!current) return jsonError("run_not_found", "运行不存在。", 404);
  const output = result.output as CalcOutput;
  const saved = await runStore.saveRun(runId, current.revision, {
    stateJson: current.stateJson,
    commercialJson: JSON.stringify(output),
  });
  void saved;
  return jsonOk({ commercial: output }, 200);
}
