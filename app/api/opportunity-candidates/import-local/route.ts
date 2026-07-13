import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { saveLegacySandboxCandidates } from "@/lib/server/demoSandbox";
import { saveLegacyCandidates } from "@/lib/server/opportunityCandidateService";
import {
  CandidateSourceSaveError,
  preflightCandidateSaveBatch,
  type CandidateSourceSaveErrorCode,
} from "@/lib/server/candidateSourceSave";

export const runtime = "nodejs";

type ApiResponse =
  | { ok: true; imported: number; skipped: number; isSandbox?: boolean; sourceMode?: string }
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

function sanitizeLocalDraft(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    name: asString(value.name),
    rawInput: asString(value.rawInput, asString(value.name)),
    link: value.link === null ? null : asString(value.link) || null,
    score: typeof value.score === "number" ? value.score : Number(value.score),
    source: asString(value.source, "本浏览器导入"),
    keyword: asString(value.keyword),
    riskLevel: asString(value.riskLevel),
    riskLabel: asString(value.riskLabel),
    summaryLabel: asString(value.summaryLabel),
  };
}

function candidateSaveErrorCode(error: unknown): CandidateSourceSaveErrorCode | null {
  if (error instanceof CandidateSourceSaveError) return error.code;
  if (!isRecord(error) || typeof error.code !== "string") return null;
  return ["invalid_payload", "candidate_batch_invalid", "source_proof_invalid", "candidate_source_conflict"].includes(error.code)
    ? error.code as CandidateSourceSaveErrorCode
    : null;
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

  const auth = requireAuthenticated(request, body);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return json({ ok: false, error: { code: "invalid_payload", message: "请提供要导入的候选品列表。" } }, 400);
  }

  try {
    if (auth.context.mode === "demo" && rawItems.length > 20) {
      return json({ ok: false, error: { code: "import_limit_exceeded", message: "访客体验模式最多一次导入 20 条候选。" } }, 400);
    }
    const preflight = preflightCandidateSaveBatch(
      rawItems.map(sanitizeLocalDraft),
      auth.context,
    );
    if (preflight.mode !== "legacy_unverified") {
      return json({ ok: false, error: { code: "invalid_payload", message: "本地草稿只能按未验证来源导入。" } }, 400);
    }

    if (auth.context.mode === "demo") {
      const result = saveLegacySandboxCandidates(auth.context.demoAccessId, preflight.items);
      return json({
        ok: true,
        imported: result.created,
        skipped: 0,
        isSandbox: true,
        sourceMode: "demo_sandbox",
      });
    }

    const result = await saveLegacyCandidates(preflight.items);
    return json({ ok: true, imported: result.created + result.updated, skipped: 0 });
  } catch (error) {
    const code = candidateSaveErrorCode(error);
    if (code) {
      const status = code === "candidate_source_conflict" ? 409 : 400;
      const message = code === "candidate_source_conflict"
        ? "候选品与已有已验证来源冲突，请检查候选池后重试。"
        : "本地候选批次无效，请检查后重试。";
      return json({ ok: false, error: { code, message } }, status);
    }
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
