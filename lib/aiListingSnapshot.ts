import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";

export type AiListingPackSnapshot = AiListingPackDraft & {
  savedAt: string;
  savedBy: "owner";
  snapshotType: "ai_listing_pack";
};

export type AiListingSaveErrorCode =
  | "invalid_ai_listing_pack"
  | "ai_listing_pack_already_exists"
  | "invalid_result_json";

export type AiListingSaveResult =
  | {
      ok: true;
      resultJson: Record<string, unknown>;
      snapshot: AiListingPackSnapshot;
    }
  | {
      ok: false;
      error: {
        code: AiListingSaveErrorCode;
        message: string;
      };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : null;
}

function isSupportedDraftSource(value: unknown): value is AiListingPackDraft["source"] {
  return value === "mock_ai_draft" || value === "real_ai_draft";
}

function toFilterableDraft(input: unknown): AiListingPackDraft | null {
  if (!isRecord(input)) return null;
  if (!isSupportedDraftSource(input.source)) return null;
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : null;
  if (!model) return null;
  if (input.source === "mock_ai_draft" && model !== "mock") return null;
  if (input.source === "real_ai_draft" && model === "mock") return null;
  if (input.humanReviewRequired !== true) return null;

  const version = typeof input.version === "number" && Number.isInteger(input.version) && input.version > 0
    ? input.version
    : null;
  const generatedAt = typeof input.generatedAt === "string" && !Number.isNaN(Date.parse(input.generatedAt))
    ? input.generatedAt
    : null;
  const description = typeof input.description === "string" && input.description.trim()
    ? input.description.trim()
    : null;

  const titles = stringArray(input.titles);
  const bullets = stringArray(input.bullets);
  const keywords = stringArray(input.keywords);
  const sellingPoints = stringArray(input.sellingPoints);
  const riskNotes = stringArray(input.riskNotes);
  const complianceWarnings = stringArray(input.complianceWarnings);
  const blockedClaims = stringArray(input.blockedClaims);
  const reviewChecklist = stringArray(input.reviewChecklist);

  if (
    !version ||
    !generatedAt ||
    !description ||
    !titles ||
    !bullets ||
    !keywords ||
    !sellingPoints ||
    !riskNotes ||
    !complianceWarnings ||
    !blockedClaims ||
    !reviewChecklist
  ) {
    return null;
  }

  return {
    source: input.source,
    version,
    generatedAt,
    model,
    humanReviewRequired: true,
    titles,
    bullets,
    description,
    keywords,
    sellingPoints,
    riskNotes,
    complianceWarnings,
    blockedClaims,
    reviewChecklist,
  };
}

export function parseTaskResultJson(value: unknown): { ok: true; data: Record<string, unknown> } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, data: {} };
  if (isRecord(value)) return { ok: true, data: { ...value } };
  if (typeof value !== "string") return { ok: false };

  try {
    const parsed = JSON.parse(value || "{}");
    return isRecord(parsed) ? { ok: true, data: parsed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export function sanitizeAiListingPackForSave(input: unknown): { ok: true; data: AiListingPackDraft } | { ok: false } {
  const draft = toFilterableDraft(input);
  if (!draft) return { ok: false };

  const filtered = filterListingClaims(draft);
  const validation = validateAiListingPackDraft(filtered.cleaned);
  if (!validation.ok) return { ok: false };

  return { ok: true, data: validation.data };
}

function getSnapshotVersion(existing: unknown, fallbackVersion: number, overwrite: boolean) {
  if (!overwrite || !isRecord(existing)) return fallbackVersion;
  const current = existing.version;
  return typeof current === "number" && Number.isInteger(current) && current > 0
    ? current + 1
    : fallbackVersion + 1;
}

export function buildAiListingPackSaveResult({
  resultJson,
  listingPack,
  overwrite = false,
  savedAt,
}: {
  resultJson: unknown;
  listingPack: unknown;
  overwrite?: boolean;
  savedAt: string;
}): AiListingSaveResult {
  const parsed = parseTaskResultJson(resultJson);
  if (!parsed.ok) {
    return {
      ok: false,
      error: { code: "invalid_result_json", message: "任务结果结构异常，无法保存。" },
    };
  }

  const cleaned = sanitizeAiListingPackForSave(listingPack);
  if (!cleaned.ok) {
    return {
      ok: false,
      error: { code: "invalid_ai_listing_pack", message: "草稿结构异常，无法保存。" },
    };
  }

  const existingSnapshot = parsed.data.aiListingPackSnapshot;
  if (existingSnapshot && !overwrite) {
    return {
      ok: false,
      error: { code: "ai_listing_pack_already_exists", message: "任务中已存在 AI Listing 草稿，请确认后再覆盖。" },
    };
  }

  const snapshot: AiListingPackSnapshot = {
    ...cleaned.data,
    version: getSnapshotVersion(existingSnapshot, cleaned.data.version, overwrite),
    savedAt,
    savedBy: "owner",
    snapshotType: "ai_listing_pack",
  };

  return {
    ok: true,
    resultJson: {
      ...parsed.data,
      aiListingPackSnapshot: snapshot,
    },
    snapshot,
  };
}
