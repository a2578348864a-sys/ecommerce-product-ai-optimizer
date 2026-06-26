import { NextRequest, NextResponse } from "next/server";
import { checkAccessPassword, getAccessContext } from "@/lib/server/accessPassword";
import { requireOwnerOnly, requireAuthenticated } from "@/lib/server/demoGuard";
import {
  listSandboxCandidates,
  createSandboxCandidate,
  sandboxCandidateToListItem,
} from "@/lib/server/demoSandbox";
import {
  isValidCandidateStatus,
  listCandidates,
  upsertCandidates,
} from "@/lib/server/opportunityCandidateService";

export const runtime = "nodejs";

type ApiResponse =
  | { ok: true; items: unknown[]; total: number; hasMore: boolean; nextOffset: number | null }
  | { ok: true; items: unknown[]; created: number; updated: number; isSandbox?: boolean; sourceMode?: string }
  | { ok: false; error: { code: string; message: string } };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/* ── GET ──────────────────────────────────────── */

export async function GET(request: NextRequest) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  const status = asString(request.nextUrl.searchParams.get("status")) || undefined;
  const q = asString(request.nextUrl.searchParams.get("q")) || undefined;
  const sort = asString(request.nextUrl.searchParams.get("sort")) || undefined;
  const limit = Number(request.nextUrl.searchParams.get("limit")) || 50;
  const offset = Number(request.nextUrl.searchParams.get("offset")) || 0;

  try {
    const result = await listCandidates({ status, q, sort, limit, offset });
    let items = result.items as Record<string, unknown>[];

    // Demo-Sandbox.1-C: merge sandbox candidates for demo
    const ctx = getAccessContext(request);
    if (ctx && ctx.mode === "demo") {
      const sandboxCands = listSandboxCandidates(ctx.demoAccessId);
      const sandboxItems = sandboxCands.map((c) => sandboxCandidateToListItem(c)) as unknown as Record<string, unknown>[];
      items = [...sandboxItems, ...items.map((item) => ({ ...item, sourceMode: "official_readonly", isSandbox: false, canEdit: false, canDelete: false }))];
    }

    return json({ ok: true, items, total: result.total, hasMore: result.hasMore, nextOffset: result.nextOffset });
  } catch (error) {
    return json({
      ok: false,
      error: {
        code: "server_error",
        message: error instanceof Error && error.message.includes("database")
          ? "数据库暂时不可用，请稍后重试。"
          : "候选池读取失败，请稍后重试。",
      },
    }, 500);
  }
}

/* ── POST ─────────────────────────────────────── */

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }

  if (!isRecord(body)) {
    return json({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, 400);
  }

  const auth = requireAuthenticated(request, body);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  // Support both single item and items array
  const rawItems = Array.isArray(body.items) ? body.items : isRecord(body) && body.name ? [body] : [];
  if (rawItems.length === 0) {
    return json({ ok: false, error: { code: "invalid_payload", message: "请提供至少一个候选品。" } }, 400);
  }

  // Demo-Sandbox.1-C: Demo writes to sandbox
  if (auth.context.mode === "demo") {
    let created = 0;
    for (const item of rawItems.filter(isRecord)) {
      createSandboxCandidate(auth.context.demoAccessId, {
        name: asString(item.name),
        rawInput: asString(item.rawInput),
        link: item.link ? asString(item.link) || null : null,
        score: typeof item.score === "number" ? item.score : undefined,
        source: asString(item.source) || "访客输入",
        keyword: asString(item.keyword),
        riskLevel: asString(item.riskLevel),
        riskLabel: asString(item.riskLabel),
        summaryLabel: asString(item.summaryLabel),
        status: asString(item.status) || "pending",
        sourceMetaJson: typeof item.sourceMetaJson === "string" ? item.sourceMetaJson : undefined,
        analysisJson: typeof item.analysisJson === "string" ? item.analysisJson : undefined,
      });
      created++;
    }
    return json({ ok: true, items: [], created, updated: 0, isSandbox: true, sourceMode: "demo_sandbox" });
  }

  const inputs = rawItems.filter(isRecord).map((item) => ({
    name: asString(item.name),
    rawInput: asString(item.rawInput),
    link: item.link ? asString(item.link) || null : undefined,
    score: typeof item.score === "number" ? item.score : undefined,
    source: asString(item.source),
    keyword: asString(item.keyword),
    riskLevel: asString(item.riskLevel),
    riskLabel: asString(item.riskLabel),
    summaryLabel: asString(item.summaryLabel),
    status: isValidCandidateStatus(item.status) ? item.status : undefined,
    sourceMetaJson: asString(item.sourceMetaJson),
    analysisJson: asString(item.analysisJson),
    convertedTaskId: item.convertedTaskId ? asString(item.convertedTaskId) || null : undefined,
  })).filter((item) => item.name.length > 0);

  if (inputs.length === 0) {
    return json({ ok: false, error: { code: "invalid_payload", message: "候选品名称为空。" } }, 400);
  }

  try {
    const result = await upsertCandidates(inputs);
    return json({ ok: true, items: result.items, created: result.created, updated: result.updated });
  } catch (error) {
    return json({
      ok: false,
      error: {
        code: "server_error",
        message: error instanceof Error && error.message.includes("database")
          ? "数据库暂时不可用，请稍后重试。"
          : "候选品保存失败，请稍后重试。",
      },
    }, 500);
  }
}
