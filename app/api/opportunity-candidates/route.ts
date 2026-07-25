import { NextRequest, NextResponse } from "next/server";
import { checkAccessPassword, getAccessContext } from "@/lib/server/accessPassword";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import {
  saveSignedSandboxCandidates,
  sandboxCandidateToListItem,
} from "@/lib/server/demoSandbox";
import {
  saveSignedCandidates,
} from "@/lib/server/opportunityCandidateService";
import {
  CandidateSourceSaveError,
  preflightCandidateSaveBatch,
  type CandidateSourceSaveErrorCode,
} from "@/lib/server/candidateSourceSave";
import { toPublicOpportunityCandidate } from "@/lib/server/candidateEvidenceReview";
import { createScopedOpportunityStore } from "@/lib/server/opportunityStore";
import { LegacyCandidateWriteError } from "@/lib/server/legacyCandidateWriteTypes";

export const runtime = "nodejs";

type ApiResponse =
  | { ok: true; items: unknown[]; total: number; hasMore: boolean; nextOffset: number | null }
  | { ok: true; items: unknown[]; created: number; updated: number; unchanged?: number; isSandbox?: boolean; sourceMode?: string }
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

const CANDIDATE_SAVE_CODES = new Set<CandidateSourceSaveErrorCode>([
  "invalid_payload",
  "candidate_batch_invalid",
  "source_proof_invalid",
  "candidate_source_conflict",
]);

const LEGACY_WRITE_CODES = new Set([
  "candidate_source_conflict",
  "candidate_legacy_overwrite_blocked",
  "candidate_identity_ambiguous",
]);

function candidateSaveErrorCode(error: unknown): CandidateSourceSaveErrorCode | null {
  if (error instanceof CandidateSourceSaveError) return error.code;
  if (isRecord(error) && typeof error.code === "string" && CANDIDATE_SAVE_CODES.has(error.code as CandidateSourceSaveErrorCode)) {
    return error.code as CandidateSourceSaveErrorCode;
  }
  return null;
}

function candidateSaveErrorResponse(error: unknown) {
  const code = candidateSaveErrorCode(error);
  if (!code) return null;
  const status = code === "invalid_payload" ? 400 : 409;
  const message = code === "candidate_source_conflict"
    ? "候选品已存在不同来源记录，请检查候选池后重试。"
    : code === "source_proof_invalid"
      ? "来源证明无效或已过期，请重新抓取。"
      : code === "candidate_batch_invalid"
        ? "候选批次不完整或无效，请重新抓取。"
        : "候选品请求无效。";
  return json({ ok: false, error: { code, message } }, status);
}

function legacyWriteErrorResponse(error: unknown) {
  if (error instanceof LegacyCandidateWriteError) {
    const code = error.code;
    if (LEGACY_WRITE_CODES.has(code)) {
      const status = code === "candidate_batch_invalid" ? 400 : 409;
      const messages: Record<string, string> = {
        candidate_source_conflict: "Legacy Candidate 批次包含重复身份。",
        candidate_legacy_overwrite_blocked: "未验证来源不能覆盖已验证或已推进的 Candidate。",
        candidate_identity_ambiguous: "候选池已有重复身份，无法安全写入。",
      };
      return json({ ok: false, error: { code, message: messages[code] ?? code } }, status);
    }
  }
  if (error instanceof CandidateSourceSaveError) {
    return candidateSaveErrorResponse(error);
  }
  return null;
}

/* ── GET ──────────────────────────────────────── */

export async function GET(request: NextRequest) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  const ctx = getAccessContext(request);
  if (!ctx) {
    return json({ ok: false, error: { code: "invalid_access", message: "请先登录后再操作。" } }, 401);
  }

  const status = asString(request.nextUrl.searchParams.get("status")) || undefined;
  const q = asString(request.nextUrl.searchParams.get("q")) || undefined;
  const sort = asString(request.nextUrl.searchParams.get("sort")) || undefined;
  const limit = Number(request.nextUrl.searchParams.get("limit")) || 50;
  const offset = Number(request.nextUrl.searchParams.get("offset")) || 0;

  try {
    const store = createScopedOpportunityStore(ctx);
    const result = await store.candidates.list({ status, q, sort, limit, offset });
    return json({
      ok: true,
      items: result.items.map(toPublicOpportunityCandidate),
      total: result.total,
      hasMore: result.hasMore,
      nextOffset: result.nextOffset,
    });
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

  let preflight;
  try {
    preflight = preflightCandidateSaveBatch(rawItems, auth.context);
  } catch (error) {
    return candidateSaveErrorResponse(error) ?? json({
      ok: false,
      error: { code: "server_error", message: "候选品保存失败，请稍后重试。" },
    }, 500);
  }

  if (preflight.mode === "signed_source_v2") {
    try {
      if (auth.context.mode === "demo") {
        const result = saveSignedSandboxCandidates(auth.context.demoAccessId, preflight.items);
        return json({
          ok: true,
          items: result.items.map((item) => toPublicOpportunityCandidate(sandboxCandidateToListItem(item))),
          created: result.created,
          updated: 0,
          unchanged: result.unchanged,
          isSandbox: true,
          sourceMode: "signed_source_v2",
        });
      }

      const result = await saveSignedCandidates(preflight.items);
      return json({
        ok: true,
        items: result.items.map(toPublicOpportunityCandidate),
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        sourceMode: "signed_source_v2",
      });
    } catch (error) {
      return candidateSaveErrorResponse(error) ?? json({
        ok: false,
        error: { code: "server_error", message: "候选品保存失败，请稍后重试。" },
      }, 500);
    }
  }

  // Legacy path — A2-2A: wired through A2-1 target write service
  try {
    const store = createScopedOpportunityStore(auth.context);
    const writeStore = store.candidates;
    if (!writeStore.saveLegacyCandidates) {
      return json({ ok: false, error: { code: "server_error", message: "写入服务不可用。" } }, 500);
    }
    const result = await writeStore.saveLegacyCandidates(preflight.items);

    // Fetch persisted items for response projection
    const persistedIds = result.items
      .filter((item) => item.candidateId)
      .map((item) => item.candidateId!);
    const persistedMap = new Map<string, Parameters<typeof toPublicOpportunityCandidate>[0]>();
    if (persistedIds.length > 0) {
      const readStore = createScopedOpportunityStore(auth.context);
      for (const id of persistedIds) {
        const candidate = await readStore.candidates.getAuthoritative(id);
        if (candidate) persistedMap.set(id, candidate);
      }
    }

    const items = result.items.map((ri) => {
      if (ri.candidateId && persistedMap.has(ri.candidateId)) {
        return toPublicOpportunityCandidate(persistedMap.get(ri.candidateId)!);
      }
      if (ri.candidateId) {
        return { id: ri.candidateId, decision: ri.decision };
      }
      return { decision: ri.decision, identityKey: ri.identityKey };
    });

    const isSandbox = auth.context.mode === "demo";
    return json({
      ok: true,
      items,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      ...(isSandbox ? { isSandbox: true } : {}),
      sourceMode: "legacy_unverified",
    });
  } catch (error) {
    return legacyWriteErrorResponse(error) ?? json({
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
