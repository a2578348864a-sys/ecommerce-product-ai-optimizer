import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

/**
 * Human-provided marketing direction for a single Listing generation request.
 * This is deliberately separate from confirmed product facts and is never saved
 * into the Creative Handoff fact contract.
 */
export type ListingBrief = {
  schema: "listing-creation-brief.v1";
  coreSellingPoint?: string;
  targetAudience?: string;
  useScenario?: string;
  differentiation?: string;
  contentEmphasis?: string;
};

type ListingBriefFields = Omit<ListingBrief, "schema">;

export type ListingBriefResult =
  | { ok: true; brief: ListingBrief | null }
  | { ok: false; code: "invalid_listing_brief" | "listing_brief_unsupported_claim"; message: string };

const FIELD_LIMITS: Record<keyof ListingBriefFields, number> = {
  coreSellingPoint: 300,
  targetAudience: 200,
  useScenario: 200,
  differentiation: 300,
  contentEmphasis: 300,
};

const UNSUPPORTED_CLAIM_PATTERNS: RegExp[] = [
  /\bbest\b/i,
  /\bguaranteed?\b/i,
  /\bnumber\s*(?:one|1)\b/i,
  /\bno\.?\s*1\b/i,
  /100\s*(?:%|percent)\s*(?:safe|安全)/i,
  /\btop\s*1\b/i,
  /最佳|第一名|全网第一|保证(?:安全|有效|成功)/,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedText(value: unknown, limit: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ");
  return normalized.length <= limit ? normalized : null;
}

/**
 * Validates only the shape and prohibited marketing absolutes. It does not
 * promote any brief value to a verified fact, nor does it attempt fact checking.
 */
export function buildListingBrief(value: unknown): ListingBriefResult {
  if (value === undefined || value === null) return { ok: true, brief: null };
  if (!isRecord(value)) {
    return { ok: false, code: "invalid_listing_brief", message: "商品创作补充格式无效。" };
  }

  const allowed = new Set<keyof ListingBriefFields>(Object.keys(FIELD_LIMITS) as Array<keyof ListingBriefFields>);
  for (const key of Object.keys(value)) {
    // 唯一合法 schema 允许重复解析（持久化往返）；其他 schema 一律拒绝，避免绕行或旧格式文本。
    if (key === "schema") {
      if (value.schema !== "listing-creation-brief.v1") {
        return { ok: false, code: "invalid_listing_brief", message: "商品创作补充 schema 不支持。" };
      }
      continue;
    }
    if (!allowed.has(key as keyof ListingBriefFields)) {
      return { ok: false, code: "invalid_listing_brief", message: "商品创作补充包含不支持的字段。" };
    }
  }

  const brief: ListingBrief = { schema: "listing-creation-brief.v1" };
  for (const field of allowed) {
    const normalized = normalizedText(value[field], FIELD_LIMITS[field]);
    if (normalized === null) {
      return { ok: false, code: "invalid_listing_brief", message: "商品创作补充只能填写文本。" };
    }
    if (!normalized) continue;
    if (UNSUPPORTED_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return {
        ok: false,
        code: "listing_brief_unsupported_claim",
        message: "商品创作补充不能包含“best、guaranteed、number one、100%安全”等未经证实声明。",
      };
    }
    brief[field] = normalized;
  }

  return Object.keys(brief).length === 1 ? { ok: true, brief: null } : { ok: true, brief };
}

/**
 * Adds a request-scoped guidance object without changing the confirmed fact
 * arrays. Returning the exact source object for an empty brief preserves the
 * pre-v2.2.16 generation fingerprint and no-brief behavior.
 */
export function withListingBrief(
  input: ListingGenerationInput,
  brief: ListingBrief | null | undefined,
): ListingGenerationInput {
  if (!brief) return input;
  return { ...input, listingBrief: brief };
}
