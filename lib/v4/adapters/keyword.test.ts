import { describe, it, expect, vi } from "vitest";
import type { ToolCallEnvelope } from "@/lib/v4/tools/envelope";
import { validateToolResult } from "@/lib/v4/tools/envelope";
import {
  runKeywordAdapter,
  normalizeKeywordSource,
  keywordEvidenceToSource,
  type IdempotencyStore,
  type KeywordSourcePayload,
} from "@/lib/v4/adapters/keyword";
import { evidenceSufficient, dataInsufficient, conflictObvious } from "@/lib/v4/adapters/fixtures/candidateProfiles";

function makeCall(overrides: Partial<ToolCallEnvelope> = {}): ToolCallEnvelope {
  return {
    toolCallId: "call-1",
    runId: "run-1",
    questionId: "q-keyword-1",
    toolName: "keyword-research",
    toolVersion: "keyword-adapter.v1",
    targetEntity: "Kitchen Storage",
    marketplace: "amazon.com",
    allowedDomains: [],
    requestedFields: ["monthlySearches"],
    maxSteps: 3,
    timeoutMs: 60000,
    budget: { maxCost: 1, currency: "USD", maxBrowserSteps: 5 },
    inputHash: "abc123",
    idempotencyKey: "idem-keyword-1",
    ...overrides,
  };
}

function memoryStore(): { store: IdempotencyStore; gets: string[]; sets: string[]; data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const gets: string[] = [];
  const sets: string[] = [];
  return {
    gets,
    sets,
    data,
    store: {
      async get(key: string) {
        gets.push(key);
        return data.get(key) ?? null;
      },
      async set(key: string, value: unknown) {
        sets.push(key);
        data.set(key, value);
      },
    },
  };
}

describe("keyword adapter", () => {
  it("returns a valid envelope with keywords/metricType/value/unit/period/source (recorded, evidence sufficient)", async () => {
    const result = await runKeywordAdapter(makeCall(), {
      mode: "recorded",
      fixture: evidenceSufficient.keyword,
      now: () => "2026-08-20T00:00:00.000Z",
    });
    const validation = validateToolResult(result);
    expect(validation.ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.errors).toEqual([]);
    const data = result.data as { keywords: Array<{ term: string; metrics: Array<{ field: string; metricType: string; value: number | null; unit: string; period: string; source: string }> }>; brandTerms: string[]; timeWindowWarning: string | null };
    expect(data.keywords.length).toBe(3);
    const first = data.keywords.find((k) => k.term === "kitchen storage organizer")!;
    const monthly = first.metrics.find((m) => m.field === "monthlySearches")!;
    expect(monthly.metricType).toBe("estimate");
    expect(monthly.unit).toBe("searches/month");
    expect(monthly.period).toBe("snapshot");
    expect(monthly.source).toBe("sellersprite-keyword");
    expect(data.brandTerms).toContain("GenericBrandA");
    // 第三方估算，且无时间窗 → 应有时间窗告警
    expect(data.timeWindowWarning).not.toBeNull();
  });

  it("downgrades untrusted exact to estimate (no third-party heat as exact search volume)", async () => {
    const source = conflictObvious.keyword; // volumeTrust third_party_estimate, monthlySearches metricType exact
    const result = await runKeywordAdapter(makeCall({ targetEntity: "Insulated Water Bottle" }), {
      mode: "recorded",
      fixture: source,
      now: () => "2026-08-20T00:00:00.000Z",
    });
    expect(result.status).toBe("ok");
    const data = result.data as { keywords: Array<{ term: string; metrics: Array<{ metricType: string; field: string }> }> };
    const term = data.keywords.find((k) => k.term === "insulated water bottle")!;
    const monthly = term.metrics.find((m) => m.field === "monthlySearches")!;
    expect(monthly.metricType).toBe("estimate");
    expect(result.warnings.some((w) => w.code === "NORMALIZATION" && /downgraded to estimate/.test(w.message))).toBe(true);
  });

  it("flags mixed time windows (do not sum across windows)", () => {
    const source: KeywordSourcePayload = {
      ...conflictObvious.keyword,
      rows: conflictObvious.keyword.rows,
    };
    const normalized = normalizeKeywordSource(source);
    expect(normalized.output.timeWindowWarning).not.toBeNull();
    expect(normalized.output.timeWindowWarning).toMatch(/window/i);
  });

  it("returns no_results for empty rows", async () => {
    const source: KeywordSourcePayload = { ...evidenceSufficient.keyword, rows: [] };
    const result = await runKeywordAdapter(makeCall(), { mode: "recorded", fixture: source });
    expect(result.status).toBe("no_results");
    expect(result.nextAction).toBe("revise_plan");
  });

  it("stops with WRONG_ENTITY when the source entity mismatches targetEntity", async () => {
    const result = await runKeywordAdapter(makeCall({ targetEntity: "SomeOtherEntity" }), {
      mode: "recorded",
      fixture: evidenceSufficient.keyword,
    });
    expect(result.status).toBe("stopped_error");
    expect(result.errors[0]?.code).toBe("WRONG_ENTITY");
    expect(result.nextAction).toBe("stop");
  });

  it("rejects metrics missing a unit", async () => {
    const source: KeywordSourcePayload = {
      ...evidenceSufficient.keyword,
      rows: [{
        rowNumber: 1,
        term: "no unit keyword",
        translation: null,
        relevance: 0.5,
        brandTerm: false,
        dataPeriod: null,
        metrics: [{ field: "monthlySearches", value: 100, unit: "", metricType: "estimate", period: null, source: "sellersprite-keyword", row: 1 }],
      }],
    };
    const result = await runKeywordAdapter(makeCall(), { mode: "recorded", fixture: source });
    const data = result.data as { keywords: unknown[]; gaps: string[] };
    expect(data.keywords.length).toBe(0);
    expect(result.warnings.some((w) => w.code === "NORMALIZATION" && /missing unit/.test(w.message))).toBe(true);
  });

  it("is idempotent: same key + same inputHash returns cached result without re-reading", async () => {
    const { store, gets, sets } = memoryStore();
    const readLive = vi.fn(async () => evidenceSufficient.keyword);
    const call = makeCall();
    const first = await runKeywordAdapter(call, { mode: "live", readLive, idempotency: store });
    const second = await runKeywordAdapter(call, { mode: "live", readLive, idempotency: store });
    expect(first).toEqual(second);
    expect(readLive).toHaveBeenCalledTimes(1); // 第二次不重复执行
    expect(sets.length).toBe(1);
    expect(gets.length).toBe(2);
  });

  it("converts keywordEvidence-like rows to a source payload (live reuse path)", () => {
    const converted = keywordEvidenceToSource({
      provider: "sellersprite-keyword",
      reportType: "keyword_mining",
      capturedAt: "2026-08-15T09:00:00.000Z",
      entity: "Kitchen Storage",
      marketplace: "amazon.com",
      rows: [{
        rowNumber: 1,
        keyword: "kitchen storage organizer",
        keywordTranslation: null,
        fields: {
          monthlySearches: { raw: "18200", normalized: 18200, metricNature: "snapshot", applicability: "available" },
          abaMonthlyRank: { raw: "1240", normalized: 1240, metricNature: "snapshot", applicability: "available" },
        },
      }],
    });
    expect(converted.source).not.toBeNull();
    expect(converted.source!.rows[0].metrics.find((m) => m.field === "monthlySearches")!.metricType).toBe("estimate");
    expect(converted.source!.rows[0].metrics.find((m) => m.field === "abaMonthlyRank")!.metricType).toBe("index");
  });

  it("returns SOURCE_STALE when recorded fixture is missing", async () => {
    const result = await runKeywordAdapter(makeCall(), { mode: "recorded" });
    expect(result.status).toBe("stopped_error");
    expect(result.errors[0]?.code).toBe("SOURCE_STALE");
  });
});
