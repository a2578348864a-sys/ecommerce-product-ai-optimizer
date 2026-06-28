import "server-only";

import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";

export type RealAiListingContext = {
  taskTitle: string | null;
  productName: string;
  decisionSummary: string;
  riskLevel: string;
  category: string;
  sellingPoints: string[];
};

export type RealAiListingClientInput = {
  context: RealAiListingContext;
};

export type RealAiListingClient = (input: RealAiListingClientInput) => Promise<unknown>;

export type RealAiListingErrorCode =
  | "ai_timeout"
  | "ai_json_parse_failed"
  | "ai_schema_invalid"
  | "ai_provider_error";

export type RealAiListingGenerateResult =
  | { ok: true; data: AiListingPackDraft }
  | { ok: false; error: { code: RealAiListingErrorCode; message: string } };

let injectedClientForTests: RealAiListingClient | null = null;

export function setRealAiListingClientForTests(client: RealAiListingClient | null) {
  injectedClientForTests = client;
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

function fail(code: RealAiListingErrorCode, message: string): RealAiListingGenerateResult {
  return { ok: false, error: { code, message } };
}

function parseClientPayload(value: unknown) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return isRecord(value) ? value : null;
}

function isTimeoutError(error: unknown) {
  if (isRecord(error) && text(error.code).toLowerCase().includes("timeout")) return true;
  if (error instanceof Error) {
    const marker = `${error.name} ${error.message}`.toLowerCase();
    return marker.includes("timeout") || marker.includes("timed out");
  }
  return false;
}

function normalizeRealAiDraft(raw: Record<string, unknown>): AiListingPackDraft {
  return {
    source: "real_ai_draft",
    version: typeof raw.version === "number" && Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
    generatedAt: text(raw.generatedAt) && !Number.isNaN(Date.parse(text(raw.generatedAt))) ? text(raw.generatedAt) : new Date().toISOString(),
    model: text(raw.model),
    humanReviewRequired: true,
    titles: stringArray(raw.titles),
    bullets: stringArray(raw.bullets),
    description: text(raw.description),
    keywords: stringArray(raw.keywords),
    sellingPoints: stringArray(raw.sellingPoints),
    riskNotes: stringArray(raw.riskNotes),
    complianceWarnings: stringArray(raw.complianceWarnings),
    blockedClaims: stringArray(raw.blockedClaims),
    reviewChecklist: stringArray(raw.reviewChecklist),
  };
}

export async function generateRealAiListingDraft(context: RealAiListingContext): Promise<RealAiListingGenerateResult> {
  const client = injectedClientForTests;
  if (!client) {
    return fail("ai_provider_error", "Real AI Listing client is not configured for this stage.");
  }

  let payload: unknown;
  try {
    payload = await client({ context });
  } catch (error) {
    return isTimeoutError(error)
      ? fail("ai_timeout", "AI Listing generation timed out.")
      : fail("ai_provider_error", "AI Listing provider returned an error.");
  }

  const raw = parseClientPayload(payload);
  if (!raw) {
    return fail("ai_json_parse_failed", "AI Listing response was not valid JSON.");
  }

  const filtered = filterListingClaims(normalizeRealAiDraft(raw));
  const validation = validateAiListingPackDraft(filtered.cleaned);
  if (!validation.ok) {
    return fail("ai_schema_invalid", "AI Listing response failed schema validation.");
  }

  return { ok: true, data: validation.data };
}
