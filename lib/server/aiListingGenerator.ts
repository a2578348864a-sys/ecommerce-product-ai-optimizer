import "server-only";

import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";
import { callAiJson } from "@/lib/server/aiClient";

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

function buildRealAiListingPrompt(context: RealAiListingContext) {
  return [
    "You generate a listing draft for a cross-border ecommerce operator.",
    "Return strict JSON only. Do not wrap the JSON in Markdown.",
    "The JSON must include: source, titleCandidates, bulletPoints, description, keywords, sellingPoints, riskWarnings, reviewWarnings, reviewChecklist.",
    "source must be exactly real_ai_draft.",
    "Use these field constraints: titleCandidates 1-3 strings; bulletPoints 1-5 strings; keywords 1-12 strings; sellingPoints 1-6 strings; riskWarnings at least 1 string; reviewWarnings can be empty; reviewChecklist at least 1 string; description must be a non-empty string.",
    "Listing content is a human-review draft only. Do not say it has been published, approved, certified, or is ready for direct commercial use.",
    "Do not fabricate certifications, sales volume, medical/health effects, FDA, CE, UL, LFGB, BPA-free, food grade, eco-friendly, child-safe, profit, ranking, or guaranteed outcome claims.",
    "Do not use absolute promises such as 100% guaranteed, guaranteed profit, best seller guaranteed, or equivalent Chinese claims.",
    "Keep wording factual and tell the operator what must be verified manually.",
    "",
    "Return exactly this JSON shape:",
    JSON.stringify({
      source: "real_ai_draft",
      titleCandidates: ["Short factual title for manual review"],
      bulletPoints: ["Factual bullet without unsupported claims"],
      description: "Plain draft description for manual review only.",
      keywords: ["keyword"],
      sellingPoints: ["Factual selling angle"],
      riskWarnings: ["What the operator must verify before publishing"],
      reviewWarnings: [],
      reviewChecklist: ["Manual review item"],
    }),
    "",
    "Task context:",
    JSON.stringify({
      taskTitle: context.taskTitle,
      productName: context.productName,
      decisionSummary: context.decisionSummary,
      riskLevel: context.riskLevel,
      category: context.category,
      sellingPoints: context.sellingPoints,
    }),
  ].join("\n");
}

function mapAiClientErrorCode(code: string): RealAiListingErrorCode {
  if (code === "timeout") return "ai_timeout";
  if (code === "json_parse_error" || code === "empty_response") return "ai_json_parse_failed";
  return "ai_provider_error";
}

async function callDefaultRealAiListingClient({ context }: RealAiListingClientInput) {
  const result = await callAiJson<unknown>({
    messages: [
      {
        role: "system",
        content: "You are a careful ecommerce listing assistant. Output only valid JSON for a human-review draft.",
      },
      {
        role: "user",
        content: buildRealAiListingPrompt(context),
      },
    ],
    temperature: 0.2,
    maxTokens: 1200,
  });

  if (!result.ok) {
    const code = mapAiClientErrorCode(result.error.code);
    throw { code, message: result.error.message };
  }

  return result.data;
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
  const riskWarnings = stringArray(raw.riskWarnings);
  const reviewWarnings = stringArray(raw.reviewWarnings);
  const riskNotes = stringArray(raw.riskNotes);
  const complianceWarnings = stringArray(raw.complianceWarnings);

  return {
    source: "real_ai_draft",
    version: typeof raw.version === "number" && Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
    generatedAt: text(raw.generatedAt) && !Number.isNaN(Date.parse(text(raw.generatedAt))) ? text(raw.generatedAt) : new Date().toISOString(),
    model: text(raw.model) || "real-ai-provider",
    humanReviewRequired: true,
    titles: stringArray(raw.titles).length ? stringArray(raw.titles) : stringArray(raw.titleCandidates),
    bullets: stringArray(raw.bullets).length ? stringArray(raw.bullets) : stringArray(raw.bulletPoints),
    description: text(raw.description),
    keywords: stringArray(raw.keywords),
    sellingPoints: stringArray(raw.sellingPoints),
    riskNotes: riskNotes.length ? riskNotes : riskWarnings,
    complianceWarnings: complianceWarnings.length ? complianceWarnings : reviewWarnings,
    blockedClaims: stringArray(raw.blockedClaims),
    reviewChecklist: stringArray(raw.reviewChecklist),
  };
}

export async function generateRealAiListingDraft(context: RealAiListingContext): Promise<RealAiListingGenerateResult> {
  const client = injectedClientForTests || callDefaultRealAiListingClient;

  let payload: unknown;
  try {
    payload = await client({ context });
  } catch (error) {
    return isTimeoutError(error)
      ? fail("ai_timeout", "AI Listing generation timed out.")
      : isRecord(error) && text(error.code) === "ai_json_parse_failed"
        ? fail("ai_json_parse_failed", "AI Listing response was not valid JSON.")
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
