import { NextRequest, NextResponse } from "next/server";
import { requireOwnerOnly } from "@/lib/server/demoGuard";
import { importLocalCandidates, isValidCandidateStatus, type CandidateInput } from "@/lib/server/opportunityCandidateService";

export const runtime = "nodejs";

type ApiResponse =
  | { ok: true; imported: number; skipped: number }
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

  const auth = requireOwnerOnly(request, body);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return json({ ok: false, error: { code: "invalid_payload", message: "请提供要导入的候选品列表。" } }, 400);
  }

  const inputs: CandidateInput[] = rawItems.filter(isRecord).map((item) => {
    const statusRaw = asString(item.candidateStatus || item.status, "pending");
    return {
      name: asString(item.name),
      rawInput: asString(item.rawInput, asString(item.name)),
      link: item.link ? asString(item.link) || null : undefined,
      score: typeof item.score === "number" ? item.score : (typeof item.score === "string" ? Number(item.score) : undefined),
      source: asString(item.source, "本浏览器导入"),
      keyword: asString(item.keyword),
      riskLevel: asString(item.riskLevel),
      riskLabel: asString(item.riskLabel),
      summaryLabel: asString(item.summaryLabel),
      status: isValidCandidateStatus(statusRaw) ? statusRaw : "pending",
    };
  }).filter((item) => item.name.length > 0);

  if (inputs.length === 0) {
    return json({ ok: false, error: { code: "invalid_payload", message: "没有可导入的有效候选品。" } }, 400);
  }

  try {
    const result = await importLocalCandidates(inputs);
    return json({ ok: true, imported: result.imported, skipped: result.skipped });
  } catch (error) {
    return json({
      ok: false,
      error: {
        code: "server_error",
        message: error instanceof Error && error.message.includes("database")
          ? "数据库暂时不可用。"
          : "导入失败，请稍后重试。",
      },
    }, 500);
  }
}
