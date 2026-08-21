/**
 * Public Replay 演示沙盒选择（门禁 6，最小接口）。
 * GET /api/replay/demo-choice?bundleId=… → 该访客 sandbox 的选择
 * POST { bundleId, gateId, decision, note? } → 保存（upsert by bundleId+gateId）
 * DELETE ?bundleId=… → 重置该案例选择
 *
 * 安全边界：只允许已认证访客（guest cookie 身份）；仅写入其自身 sandbox 文件；
 * 绝不读取/修改母案例 bundle；非 demo 上下文 403。
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import {
  getDemoChoices,
  saveDemoChoice,
  resetDemoChoices,
  type ReplayDemoChoice,
} from "@/lib/server/replayDemoChoices";

export const runtime = "nodejs";

const BASE = process.cwd();

const GATE_DECISIONS = new Set([
  "continue",
  "stop",
  "continue_sourcing",
  "needs_information",
  "abandon",
  "content_ready",
  "revise_product",
  "approve_export",
  "request_revision",
  "reject_asset",
]);

function error(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  const gate = requireAuthenticated(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: { code: gate.code, message: gate.message } }, { status: gate.status });
  if (gate.context.mode !== "demo") return error("demo_only", "该接口仅公开演示访客使用。", 403);
  const bundleId = (request.nextUrl?.searchParams.get("bundleId") ?? "").trim();
  if (!bundleId) return error("invalid_bundle", "缺少 bundleId。", 400);
  const demoAccessId = gate.context.demoAccessId ?? "";
  return NextResponse.json({ ok: true, choices: getDemoChoices(BASE, demoAccessId, bundleId) });
}

export async function POST(request: NextRequest) {
  const gate = requireAuthenticated(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: { code: gate.code, message: gate.message } }, { status: gate.status });
  if (gate.context.mode !== "demo") return error("demo_only", "该接口仅公开演示访客使用。", 403);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error("invalid_json", "请求格式不正确。", 400);
  }
  const bundleId = typeof body.bundleId === "string" ? body.bundleId.trim() : "";
  const gateId = typeof body.gateId === "string" ? body.gateId.trim() : "";
  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  if (!bundleId || !gateId || !decision) return error("invalid_choice", "参数不完整。", 400);
  if (!GATE_DECISIONS.has(decision)) return error("invalid_decision", "决策值无效。", 400);
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";
  const demoAccessId = gate.context.demoAccessId ?? "";
  const choice: ReplayDemoChoice = { bundleId, gateId, decision, note: note || undefined, at: new Date().toISOString() };
  return NextResponse.json({ ok: true, choices: saveDemoChoice(BASE, demoAccessId, choice) });
}

export async function DELETE(request: NextRequest) {
  const gate = requireAuthenticated(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: { code: gate.code, message: gate.message } }, { status: gate.status });
  if (gate.context.mode !== "demo") return error("demo_only", "该接口仅公开演示访客使用。", 403);
  const bundleId = (request.nextUrl?.searchParams.get("bundleId") ?? "").trim();
  if (!bundleId) return error("invalid_bundle", "缺少 bundleId。", 400);
  const demoAccessId = gate.context.demoAccessId ?? "";
  return NextResponse.json({ ok: true, choices: resetDemoChoices(BASE, demoAccessId, bundleId) });
}
