/**
 * Public Replay 演示沙盒选择（门禁 6，最小接口；契约以 UI 面板为准：整包表单）。
 * GET    /api/replay/demo-choice?bundleId=… → { ok, choice }（无则 null）
 * POST   /api/replay/demo-choice?bundleId=… body { gateA?, gateB?, note? } → 保存（upsert）
 * DELETE /api/replay/demo-choice?bundleId=… → 重置该案例选择
 *
 * 安全边界：仅已认证访客（guest cookie）；仅写自身 sandbox 文件；绝不读取/修改母案例 bundle；非 demo 上下文 403。
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { getDemoChoice, saveDemoChoice, resetDemoChoice, type ReplayDemoChoice } from "@/lib/server/replayDemoChoices";

export const runtime = "nodejs";

const BASE = process.cwd();

const GATE_A_VALUES = new Set(["continue_sourcing", "needs_information", "abandon"]);
const GATE_B_VALUES = new Set(["content_ready", "revise_product", "request_revision", "reject_asset"]);

function error(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

type GateResult =
  | { ok: true; context: { mode: string; demoAccessId?: string } }
  | { ok: false; status: number; code: string; message: string };

function gate(req: NextRequest): GateResult {
  const g = requireAuthenticated(req);
  if (!g.ok) return { ok: false, status: g.status, code: g.code, message: g.message };
  if (g.context.mode !== "demo") return { ok: false, status: 403, code: "demo_only", message: "该接口仅公开演示访客使用。" };
  return g;
}

export async function GET(request: NextRequest) {
  const g = gate(request);
  if (!g.ok) return NextResponse.json({ ok: false, error: { code: g.code, message: g.message } }, { status: g.status });
  const bundleId = (request.nextUrl?.searchParams.get("bundleId") ?? "").trim();
  if (!bundleId) return error("invalid_bundle", "缺少 bundleId。", 400);
  const demoAccessId = String(g.context.demoAccessId ?? "");
  const choice = getDemoChoice(BASE, demoAccessId, bundleId);
  // 平铺返回（panel 契约：直接 { gateA, gateB, note }）。
  return NextResponse.json({ ok: true, ...(choice ?? {}) });
}

export async function POST(request: NextRequest) {
  const g = gate(request);
  if (!g.ok) return NextResponse.json({ ok: false, error: { code: g.code, message: g.message } }, { status: g.status });
  const bundleId = (request.nextUrl?.searchParams.get("bundleId") ?? "").trim();
  if (!bundleId) return error("invalid_bundle", "缺少 bundleId。", 400);
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return error("invalid_json", "请求格式不正确。", 400); }
  const gateA = typeof body.gateA === "string" ? body.gateA.trim() : "";
  const gateB = typeof body.gateB === "string" ? body.gateB.trim() : "";
  if (gateA && !GATE_A_VALUES.has(gateA)) return error("invalid_decision", "Gate A 决策值无效。", 400);
  if (gateB && !GATE_B_VALUES.has(gateB)) return error("invalid_decision", "Gate B 决策值无效。", 400);
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";
  const demoAccessId = g.context.demoAccessId ?? "";
  const choice: ReplayDemoChoice = { bundleId, gateA: gateA || undefined, gateB: gateB || undefined, note: note || undefined, at: new Date().toISOString() };
  saveDemoChoice(BASE, demoAccessId, choice);
  return NextResponse.json({ ok: true, ...(getDemoChoice(BASE, demoAccessId, bundleId) ?? choice) });
}

export async function DELETE(request: NextRequest) {
  const g = gate(request);
  if (!g.ok) return NextResponse.json({ ok: false, error: { code: g.code, message: g.message } }, { status: g.status });
  const bundleId = (request.nextUrl?.searchParams.get("bundleId") ?? "").trim();
  if (!bundleId) return error("invalid_bundle", "缺少 bundleId。", 400);
  const demoAccessId = g.context.demoAccessId ?? "";
  resetDemoChoice(BASE, demoAccessId, bundleId);
  return NextResponse.json({ ok: true });
}
