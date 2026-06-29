import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import {
  consumeDemoAiCalls,
  ensureDemoAiQuota,
  requireAuthenticated,
  requireOwnerOnly,
  type DemoAccessSnapshot,
} from "@/lib/server/demoGuard";
import { generateRealAiListingDraft } from "@/lib/server/aiListingGenerator";
import { isRealAiListingEnabled } from "@/lib/server/realAiListingGate";
import { getSandboxTask, isSandboxTaskId } from "@/lib/server/demoSandbox";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import { buildMockAiListingDraft, validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";

export const runtime = "nodejs";

type ApiErrorCode =
  | "unauthorized"
  | "task_not_found"
  | "missing_task_context"
  | "real_ai_confirmation_required"
  | "real_ai_disabled"
  | "ai_timeout"
  | "ai_json_parse_failed"
  | "ai_schema_invalid"
  | "ai_provider_error"
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
      demoAccess?: DemoAccessSnapshot;
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

function guardRealAiRequest(bodyRecord: Record<string, unknown>) {
  if (bodyRecord.confirmRealAi !== true) {
    return json({
      ok: false,
      error: {
        code: "real_ai_confirmation_required",
        message: "Real AI generation was not confirmed.",
      },
    }, 400);
  }

  if (!isRealAiListingEnabled()) {
    return json({
      ok: false,
      error: {
        code: "real_ai_disabled",
        message: "Real AI listing generation is disabled.",
      },
    }, 403);
  }

  return null;
}

function realAiErrorStatus(code: string) {
  if (
    code === "ai_timeout"
    || code === "ai_json_parse_failed"
    || code === "ai_schema_invalid"
    || code === "ai_provider_error"
  ) {
    return 502;
  }
  return 500;
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
    if (realMode) {
      const guarded = guardRealAiRequest(bodyRecord);
      if (guarded) return guarded;
    }

    const loaded = await loadTaskForGenerate(request, id, bodyRecord);
    if (!loaded.ok) return loaded.response;

    const context = buildContext(loaded.task);
    if (!text(context.productName)) {
      return json({
        ok: false,
        error: { code: "missing_task_context", message: "Task context is not enough to generate a listing draft." },
      }, 400);
    }

    if (realMode) {
      if (loaded.accessContext.mode === "demo") {
        const quota = ensureDemoAiQuota(loaded.accessContext, 1);
        if (!quota.ok) {
          return json({ ok: false, error: { code: quota.code, message: quota.message } }, quota.status);
        }
      }

      const generated = await generateRealAiListingDraft(context);
      if (!generated.ok) {
        return json({
          ok: false,
          error: { code: generated.error.code, message: generated.error.message },
        }, realAiErrorStatus(generated.error.code));
      }

      const demoAccess = loaded.accessContext.mode === "demo"
        ? consumeDemoAiCalls(loaded.accessContext, 1)
        : null;

      return json({
        ok: true,
        data: {
          listingPack: generated.data,
          meta: {
            mode: "real",
            saved: false,
            nextStep: "review_before_save",
          },
        },
        ...(demoAccess ? { demoAccess } : {}),
      });
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
