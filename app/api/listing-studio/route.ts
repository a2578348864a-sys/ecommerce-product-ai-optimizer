/**
 * Listing Studio API — standalone listing generation (no Task dependency).
 * Reuses the same aiListingGenerator core as the Task-based API.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, type DemoAccessSnapshot } from "@/lib/server/demoGuard";
import { isRealAiListingEnabled, isRealAiVisitorListingEnabled } from "@/lib/server/realAiListingGate";
import { generateRealStudioListing } from "@/lib/server/studioListingService";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import { buildMockAiListingDraft, validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";
import {
  parseStudioListingInput,
  type StudioListingPreferences,
} from "@/lib/studioListingInput";

export const runtime = "nodejs";

type ApiResponse =
  | {
      ok: true;
      data: {
        listingPack: AiListingPackDraft;
        meta: {
          mode: "mock" | "real";
          saved: false;
          duplicate: boolean;
          input: StudioListingPreferences;
        };
      };
      demoAccess?: DemoAccessSnapshot;
    }
  | { ok: false; error: { code: string; message: string } };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }
  if (!isRecord(body)) {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体必须是 JSON object。" } }, 400);
  }

  const auth = requireAuthenticated(request, body);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
  }

  const parsed = parseStudioListingInput(body);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const input = parsed.data;

  const context = {
    taskTitle: input.productName,
    productName: input.productName,
    decisionSummary: input.description || `${input.productName} product listing`,
    riskLevel: input.riskLevel,
    category: input.category || "General",
    sellingPoints: input.sellingPoints.length
      ? input.sellingPoints
      : input.preferences.differentiators.length
        ? input.preferences.differentiators.slice(0, 5)
        : [`${input.productName} product details require review`],
    studioPreferences: input.preferences,
  };

  const realMode = input.mode === "real";
  if (!realMode) {
    const mock = buildMockAiListingDraft({
      productName: context.productName,
      decisionSummary: context.decisionSummary,
      riskLevel: context.riskLevel,
      category: context.category,
      sellingPoints: context.sellingPoints,
      studioPreferences: context.studioPreferences,
    });
    const validated = validateAiListingPackDraft(filterListingClaims(mock).cleaned);
    if (!validated.ok) {
      return json({ ok: false, error: { code: "invalid_ai_listing_pack", message: "生成的 Listing 草稿结构无效。" } }, 500);
    }
    return json({
      ok: true,
      data: {
        listingPack: validated.data,
        meta: { mode: "mock", saved: false, duplicate: false, input: input.preferences },
      },
    });
  }

  if (!input.confirmRealAi) {
    return json({ ok: false, error: { code: "real_ai_confirmation_required", message: "Real AI generation requires explicit confirmation." } }, 400);
  }

  // V2 Final Integration（规格十四节）: 真实 Listing 生成已迁移到任务详情页的 Creative Handoff 链。
  // 此独立 Studio 的 real 模式绕过 Handoff Gate / Claim Evidence / Binding，一律返回已迁移错误。
  return json({
    ok: false,
    error: { code: "listing_studio_real_migrated", message: "真实 Listing 生成已迁移到任务详情页的创作交接流程，请在任务内生成。" },
  }, 422);
}
