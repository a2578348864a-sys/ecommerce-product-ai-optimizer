import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireOwnerOnly } from "@/lib/server/demoGuard";
import { isRealAiListingEnabled } from "@/lib/server/realAiListingGate";
import { buildMockAiListingDraft, validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";

export const runtime = "nodejs";

type ApiErrorCode =
  | "unauthorized"
  | "task_not_found"
  | "missing_task_context"
  | "real_ai_confirmation_required"
  | "real_ai_disabled"
  | "real_ai_not_implemented"
  | "invalid_ai_listing_pack"
  | "ai_listing_generation_failed"
  | "invalid_json";

type ApiResponse =
  | {
    ok: true;
    data: {
      listingPack: ReturnType<typeof buildMockAiListingDraft>;
      meta: {
        mode: "mock";
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

function realAiListingNotImplemented() {
  return json({
    ok: false,
    error: {
      code: "real_ai_not_implemented",
      message: "真实 AI Listing 草稿生成尚未接入，本阶段不会调用真实 AI。",
    },
  }, 501);
}

function guardRealAiRequest(bodyRecord: Record<string, unknown>) {
  if (bodyRecord.confirmRealAi !== true) {
    return json({
      ok: false,
      error: {
        code: "real_ai_confirmation_required",
        message: "本次真实 AI 调用未确认，不会生成。",
      },
    }, 400);
  }

  if (!isRealAiListingEnabled()) {
    return json({
      ok: false,
      error: {
        code: "real_ai_disabled",
        message: "真实 AI Listing 生成暂未开启。",
      },
    }, 403);
  }

  return null;
}

function getNestedRecord(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function getProductName(record: {
  title: string | null;
  materialText: string;
  resultJson: string;
}) {
  const result = parseJsonObject(record.resultJson);
  const summary = getNestedRecord(result, "summary");
  return text(result.productName)
    || text(summary.productName)
    || text(record.title)
    || text(record.materialText);
}

function buildContext(record: {
  title: string | null;
  materialText: string;
  level: string;
  oneLineSummary: string;
  resultJson: string;
}) {
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id?: string }> },
) {
  const id = text((await params).id);
  if (!id) {
    return json({
      ok: false,
      error: { code: "missing_task_context", message: "当前任务信息不足，无法生成 Listing 草稿。" },
    }, 400);
  }

  let bodyRecord: Record<string, unknown>;
  try {
    bodyRecord = await parseOptionalBody(request);
  } catch {
    return json({
      ok: false,
      error: { code: "invalid_json", message: "请求体不是合法 JSON。" },
    }, 400);
  }

  const auth = requireOwnerOnly(request, bodyRecord);
  if (!auth.ok) {
    const code = auth.status === 401 ? "unauthorized" : auth.code;
    const message = auth.status === 401 ? "请先回首页解锁工作台。" : auth.message;
    return json({ ok: false, error: { code, message } }, auth.status);
  }

  if (getGenerationMode(bodyRecord) === "real") {
    const guarded = guardRealAiRequest(bodyRecord);
    if (guarded) return guarded;

    // Core-4-AI.8 only installs the safety shell. Future real AI output must
    // flow through the same claim filter and schema validation used by mock.
    return realAiListingNotImplemented();
  }

  try {
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
      return json({
        ok: false,
        error: { code: "task_not_found", message: "当前任务不存在或已被删除。" },
      }, 404);
    }

    const context = buildContext(task);
    if (!text(context.productName)) {
      return json({
        ok: false,
        error: { code: "missing_task_context", message: "当前任务信息不足，无法生成 Listing 草稿。" },
      }, 400);
    }

    const draft = buildMockAiListingDraft(context);
    const { cleaned } = filterListingClaims(draft);
    const validation = validateAiListingPackDraft(cleaned);

    if (!validation.ok) {
      return json({
        ok: false,
        error: { code: "invalid_ai_listing_pack", message: "生成结果结构异常，请稍后重试。" },
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
      error: { code: "ai_listing_generation_failed", message: "Listing 草稿生成失败，请稍后重试。" },
    }, 500);
  }
}
