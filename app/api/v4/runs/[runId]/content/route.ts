import { NextRequest, NextResponse } from "next/server";
import { requireV4Auth, jsonError, jsonOk, scopeMatches, v4DisabledResponse } from "@/lib/v4/apiHelpers";
import { ResearchRunStore, type ResearchRunDb } from "@/lib/v4/runStore";
import { prisma } from "@/lib/server/db";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";
import { generateListingDraft } from "@/lib/v4/content/listingSkill";
import { runComplianceGuard } from "@/lib/v4/content/complianceGuard";
import { imagePlan, type ImagePlan } from "@/lib/v4/content/imagePlan";
import { visualFactCheck, type VisualFactCheckResult } from "@/lib/v4/content/visualFactCheck";
import { checkPolicyPack, type PolicyPack } from "@/lib/v4/content/policyPack";
import { validateHandoff } from "@/lib/v4/content/handoff";
import type { ContentHandoff } from "@/lib/v4/content/handoff";

export const runtime = "nodejs";
export const maxDuration = 60;

export type ContentPackage = {
  handoff: ContentHandoff;
  listing: { draft: unknown; issues: unknown[]; blocked: boolean } | null;
  images: { plan: ImagePlan; checks: VisualFactCheckResult } | null;
  policy: { version: string; stale: boolean; message: string | null };
  generatedAt: string;
};

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
  if (!scopeMatches(gate.ctx, run.ownerScope, run.sandboxId)) return jsonError("run_not_found", "运行不存在。", 404);
  if (!run.contentJson) return jsonError("content_not_ready", "内容草稿尚未生成。", 404);
  let out: unknown; try { out = JSON.parse(run.contentJson); } catch { return jsonError("content_invalid", "数据损坏。", 500); }
  return jsonOk({ content: out });
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
  if (!scopeMatches(gate.ctx, run.ownerScope, run.sandboxId)) return jsonError("run_not_found", "运行不存在。", 404);

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return jsonError("invalid_json", "请求格式不正确。", 400); }
  const handoff = body.handoff as ContentHandoff;
  const facts = Array.isArray(body.facts) ? body.facts as Record<string, unknown>[] : [];
  if (!handoff || typeof handoff !== "object") return jsonError("invalid_handoff", "缺少 ContentHandoff。", 400);
  const handoffCheck = validateHandoff(handoff);
  if (!handoffCheck.ok) return jsonError("invalid_handoff", "ContentHandoff 校验失败：" + handoffCheck.reason, 400);

  // policy pack（fixture：Lead 收口后由 pack 注册表提供；此处用请求内 pack 或默认 US/home）
  const pack = body.policyPack as PolicyPack | undefined;
  const policy = checkPolicyPack(pack ?? null, new Date().toISOString());
  // P5-C 裁定：policy 过期 → 不生成可放行内容（blocked）
  if (!policy.ok) {
    return jsonError("policy_stale", policy.message, 409);
  }

  // Listing Skills + Compliance Guard（确定性；逐 claim factRefs / 关键词 evidenceRefs）
  const listingResult = generateListingDraft({ handoff, facts: facts as never });
  const guardResult = runComplianceGuard({ handoff, draft: listingResult.draft, facts: facts as never, policyPack: pack ?? null, now: new Date().toISOString() });
  const listing = {
    draft: listingResult.draft,
    issues: [...listingResult.issues, ...guardResult.issues],
    blocked: listingResult.blocked || guardResult.blocked,
  };

  // ImagePlan + Visual Fact Check（无真实参考图 → 不得 Final；视觉判定不作材质/尺寸证明）
  const plan = imagePlan(handoff, facts as never, Array.isArray(handoff.referenceImages) ? handoff.referenceImages : []);
  const checks = visualFactCheck(plan, facts as never, { assetRole: "main", observed: {} } as never);

  const pkg: ContentPackage = {
    handoff,
    listing,
    images: { plan, checks },
    policy: { version: pack?.version ?? "unknown", stale: false, message: null },
    generatedAt: new Date().toISOString(),
  };
  const current = await store.getRun(runId);
  if (!current) return jsonError("run_not_found", "运行不存在。", 404);
  await store.saveRun(runId, current.revision, { stateJson: current.stateJson, contentJson: JSON.stringify(pkg) });
  return jsonOk({ content: pkg }, 200);
}
