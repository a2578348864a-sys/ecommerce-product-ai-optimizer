import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import {
  requireAuthenticated,
  requireOwnerOnly,
} from "@/lib/server/demoGuard";
import { getSandboxTask, isSandboxTaskId } from "@/lib/server/demoSandbox";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import { buildMockAiListingDraft, validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";

export const runtime = "nodejs";

type ApiErrorCode =
  | "unauthorized"
  | "task_not_found"
  | "missing_task_context"
  | "handoff_required"
  | "invalid_ai_listing_pack"
  | "ai_listing_generation_failed"
  | "invalid_json";

type TaskContextRecord = {
  title: string | null;
  materialText: string;
  level: string;
  oneLineSummary: string;
  resultJson: string;
};

type ApiResponse =
  | {
      ok: true;
      data: {
        listingPack: AiListingPackDraft;
        meta: {
          mode: "mock" | "real";
          saved: false;
          nextStep: "review_before_save";
        };
      };
    }
  | { ok: false; error: { code: ApiErrorCode | string; message: string } };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function parseOptionalBody(request: NextRequest) {
  const raw = await request.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  return isRecord(parsed) ? parsed : {};
}

function getGenerationMode(bodyRecord: Record<string, unknown>) {
  return bodyRecord.mode === "real" ? "real" : "mock";
}

function getNestedRecord(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function getProductName(record: TaskContextRecord) {
  const result = parseJsonObject(record.resultJson);
  const summary = getNestedRecord(result, "summary");
  return text(result.productName)
    || text(summary.productName)
    || text(record.title)
    || text(record.materialText);
}

function buildContext(record: TaskContextRecord) {
  const result = parseJsonObject(record.resultJson);
  const finalReport = getNestedRecord(result, "finalReport");
  const sourceMeta = getNestedRecord(result, "sourceMeta");
  const listingPackSnapshot = getNestedRecord(result, "listingPackSnapshot");
  const listingPack = getNestedRecord(listingPackSnapshot, "pack");

  const productName = getProductName(record);
  const sellingPoints = [
    ...stringArray(finalReport.sellingPoints),
    ...stringArray(result.sellingPoints),
    ...stringArray(listingPack.sellingPoints),
  ];

  return {
    taskTitle: record.title,
    productName,
    decisionSummary: text(finalReport.finalVerdict) || text(record.oneLineSummary),
    riskLevel: text(finalReport.riskLevel) || text(record.level),
    category: text(sourceMeta.category) || text(result.category),
    sellingPoints,
  };
}

async function loadTaskForGenerate(
  request: NextRequest,
  id: string,
  bodyRecord: Record<string, unknown>,
) {
  if (isSandboxTaskId(id)) {
    const auth = requireAuthenticated(request, bodyRecord);
    if (!auth.ok) return { ok: false as const, response: json({ ok: false, error: { code: auth.status === 401 ? "unauthorized" : auth.code, message: auth.message } }, auth.status) };
    if (auth.context.mode !== "demo") {
      return { ok: false as const, response: json({ ok: false, error: { code: "task_not_found", message: "Task not found." } }, 404) };
    }
    const sandboxTask = getSandboxTask(auth.context.demoAccessId, id);
    if (!sandboxTask) {
      return { ok: false as const, response: json({ ok: false, error: { code: "task_not_found", message: "Task not found." } }, 404) };
    }
    return {
      ok: true as const,
      accessContext: auth.context,
      task: {
        title: sandboxTask.title,
        materialText: sandboxTask.materialText,
        level: sandboxTask.level,
        oneLineSummary: sandboxTask.oneLineSummary,
        resultJson: sandboxTask.resultJson,
      },
    };
  }

  const auth = requireOwnerOnly(request, bodyRecord);
  if (!auth.ok) {
    const code = auth.status === 401 ? "unauthorized" : auth.code;
    const message = auth.status === 401 ? "Please unlock the workspace first." : auth.message;
    return { ok: false as const, response: json({ ok: false, error: { code, message } }, auth.status) };
  }

  const task = await prisma.viralAnalysisRecord.findUnique({
    where: { id },
    select: {
      title: true,
      materialText: true,
      level: true,
      oneLineSummary: true,
      resultJson: true,
    },
  });

  if (!task) {
    return { ok: false as const, response: json({ ok: false, error: { code: "task_not_found", message: "Task not found." } }, 404) };
  }

  return { ok: true as const, accessContext: auth.context, task };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id?: string }> },
) {
  const id = text((await params).id);
  if (!id) {
    return json({
      ok: false,
      error: { code: "missing_task_context", message: "Missing task id." },
    }, 400);
  }

  let bodyRecord: Record<string, unknown>;
  try {
    bodyRecord = await parseOptionalBody(request);
  } catch {
    return json({
      ok: false,
      error: { code: "invalid_json", message: "Request body must be valid JSON." },
    }, 400);
  }

  try {
    const realMode = getGenerationMode(bodyRecord) === "real";
    // PR2-2 Final-Fix (BLOCKER-1): real 模式一律拒绝 — 统一走 Handoff 链（Mock Provider），
    // 防止旧路径调用真实 AI Provider 绕过证据验证。所有 Listing 生成必须基于 active Handoff。
    if (realMode) {
      return json({
        ok: false,
        error: {
          code: "handoff_required",
          message: "Listing 生成必须基于已确认的创作交接（Creative Handoff）。请使用「创作交接」区域生成 Listing。",
        },
      }, 422);
    }

    const loaded = await loadTaskForGenerate(request, id, bodyRecord);
    if (!loaded.ok) return loaded.response;

    // PR2-2 Final-Fix (BLOCKER-1): 旧路径封堵 — 所有 Listing 生成必须经过 Creative Handoff Gate。
    // 无 active Handoff（含 legacy/无研究记录/stale/revoked/blocking）一律拒绝，返回 handoff_required。
    // 统一链：active Handoff → Listing Input → Generation → Schema → Claim Filter → Binding → Writer
    const gate = await checkCreativeHandoffGate(id, loaded.accessContext);
    const handoff = gate.currentHandoff ?? null;
    const gateOk = gate.allowed && !!handoff && handoff.controlState === "active" && gate.reason !== "blocking_issue_present";
    if (!gateOk) {
      return json({
        ok: false,
        error: {
          code: "handoff_required",
          message: "Listing 生成必须基于已确认的创作交接（Creative Handoff）。请使用「创作交接」区域生成 Listing。",
        },
      }, 422);
    }

    const context = buildContext(loaded.task);
    if (!text(context.productName)) {
      return json({
        ok: false,
        error: { code: "missing_task_context", message: "Task context is not enough to generate a listing draft." },
      }, 400);
    }

    const draft = buildMockAiListingDraft(context);
    const { cleaned } = filterListingClaims(draft);
    const validation = validateAiListingPackDraft(cleaned);

    if (!validation.ok) {
      return json({
        ok: false,
        error: { code: "invalid_ai_listing_pack", message: "Generated listing draft has invalid structure." },
      }, 500);
    }

    return json({
      ok: true,
      data: {
        listingPack: validation.data,
        meta: {
          mode: "mock",
          saved: false,
          nextStep: "review_before_save",
        },
      },
    });
  } catch {
    return json({
      ok: false,
      error: { code: "ai_listing_generation_failed", message: "Listing draft generation failed." },
    }, 500);
  }
}
