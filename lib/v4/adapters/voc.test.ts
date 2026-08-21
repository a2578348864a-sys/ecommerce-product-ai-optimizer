import { describe, it, expect, vi } from "vitest";
import type { ToolCallEnvelope } from "@/lib/v4/tools/envelope";
import { validateToolResult } from "@/lib/v4/tools/envelope";
import {
  runVocAdapter,
  normalizeVocSource,
  reviewVocToSource,
  VOC_MIN_SAMPLE,
  type IdempotencyStore,
  type VocSourcePayload,
  type VocReviewSource,
} from "@/lib/v4/adapters/voc";
import { evidenceSufficient, dataInsufficient, conflictObvious } from "@/lib/v4/adapters/fixtures/candidateProfiles";

function makeCall(overrides: Partial<ToolCallEnvelope> = {}): ToolCallEnvelope {
  return {
    toolCallId: "call-3",
    runId: "run-3",
    questionId: "q-voc-1",
    toolName: "review-voc-analysis",
    toolVersion: "voc-adapter.v1",
    targetEntity: "cand-suf-0001",
    marketplace: "amazon.com",
    allowedDomains: [],
    requestedFields: ["themes", "sampleSize"],
    maxSteps: 3,
    timeoutMs: 60000,
    budget: { maxCost: 1, currency: "USD", maxBrowserSteps: 5 },
    inputHash: "abc789",
    idempotencyKey: "idem-voc-1",
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

describe("voc adapter", () => {
  it("returns a valid envelope with sampleSize/themes[{label,count,share,evidenceRefs}]/scenarios/languagePatterns/biases", async () => {
    const result = await runVocAdapter(makeCall(), {
      mode: "recorded",
      fixture: evidenceSufficient.voc,
      now: () => "2026-08-20T00:00:00.000Z",
    });
    const validation = validateToolResult(result);
    expect(validation.ok).toBe(true);
    expect(result.status).toBe("ok");
    const data = result.data as {
      sampleSize: number;
      samplingMethod: string;
      lowConfidence: boolean;
      themes: Array<{ label: string; count: number; share: number; evidenceRefs: string[] }>;
      scenarios: string[];
      languagePatterns: string[];
      biases: string[];
      injectionDetected: boolean;
      copyrightMinimized: boolean;
    };
    expect(data.sampleSize).toBe(12);
    expect(data.sampleSize).toBeGreaterThanOrEqual(VOC_MIN_SAMPLE);
    expect(data.lowConfidence).toBe(false);
    expect(data.themes.length).toBeGreaterThan(0);
    const theme = data.themes[0];
    expect(theme.count).toBeGreaterThan(0);
    expect(theme.share).toBeGreaterThan(0);
    expect(theme.share).toBeLessThanOrEqual(1);
    expect(theme.evidenceRefs.length).toBe(theme.count);
    expect(data.copyrightMinimized).toBe(true);
    expect(data.injectionDetected).toBe(false);
  });

  it("marks low confidence for samples below the minimum", async () => {
    const result = await runVocAdapter(makeCall(), {
      mode: "recorded",
      fixture: dataInsufficient.voc,
    });
    expect(result.status).toBe("ok");
    const data = result.data as { sampleSize: number; lowConfidence: boolean; biases: string[]; warnings: string[] };
    expect(data.sampleSize).toBeLessThan(VOC_MIN_SAMPLE);
    expect(data.lowConfidence).toBe(true);
    expect(data.biases).toContain("low_sample_size");
  });

  it("flags template/robot reviews and injects a template_reviews bias", async () => {
    // conflictObvious.voc has 3 identical "good product" reviews (repeated text).
    const result = await runVocAdapter(makeCall(), {
      mode: "recorded",
      fixture: conflictObvious.voc,
    });
    const data = result.data as { biases: string[]; warnings: string[] };
    expect(data.biases.some((b) => b.startsWith("template_reviews:"))).toBe(true);
    expect(result.warnings.some((w) => w.code === "VOC_WARNING" && /template/.test(w.message))).toBe(true);
  });

  it("detects injection in review text but keeps behavior bounded", async () => {
    const result = await runVocAdapter(makeCall(), {
      mode: "recorded",
      fixture: conflictObvious.voc,
    });
    const data = result.data as { injectionDetected: boolean; warnings: string[]; themes: unknown[] };
    expect(data.injectionDetected).toBe(true);
    expect(result.warnings.some((w) => w.code === "VOC_WARNING" && /instruction-like/.test(w.message))).toBe(true);
    // 注入不改变主题提取/权限边界
    expect(data.themes.length).toBeGreaterThan(0);
  });

  it("flags variant / role mixing when the sample spans multiple ASINs or roles", () => {
    const reviews: VocReviewSource[] = [
      { evidenceId: "rev-v1", productAsin: "B0TESTA001", sourceProductRole: "current_candidate", rating: 5, reviewDate: "2026-07-01", reviewText: "a", duplicateKey: "r1", language: "en", locale: "en-US" },
      { evidenceId: "rev-v2", productAsin: "B0TESTB002", sourceProductRole: "competitor", rating: 4, reviewDate: "2026-07-02", reviewText: "b", duplicateKey: "r2", language: "en", locale: "en-US" },
    ];
    const source: VocSourcePayload = {
      candidateId: "cand-x",
      sampledEvidenceIds: null,
      reviews,
      themes: [{ label: "t", bucket: "positive", evidenceRefs: ["rev-v1"], summary: "s", limitations: null }],
      unknowns: [],
      nextResearchSteps: [],
    };
    const normalized = normalizeVocSource(source);
    expect(normalized.output.biases.some((b) => b.startsWith("variant_mixing:"))).toBe(true);
    expect(normalized.output.biases.some((b) => b.startsWith("role_mixing:"))).toBe(true);
  });

  it("returns no_results when there are no reviews", async () => {
    const source: VocSourcePayload = { ...evidenceSufficient.voc, reviews: [], themes: [] };
    const result = await runVocAdapter(makeCall(), { mode: "recorded", fixture: source });
    expect(result.status).toBe("no_results");
    expect(result.nextAction).toBe("revise_plan");
  });

  it("rejects themes whose evidenceRefs do not hit the actual sample", () => {
    const source: VocSourcePayload = {
      ...evidenceSufficient.voc,
      themes: [{ label: "ghost theme", bucket: "positive", evidenceRefs: ["rev-NOT-IN-SAMPLE"], summary: "s", limitations: null }],
    };
    const normalized = normalizeVocSource(source);
    expect(normalized.output.themes.length).toBe(0);
    expect(normalized.output.warnings.some((w) => /no valid evidenceRefs/.test(w))).toBe(true);
  });

  it("converts reviewEvidence/vocAnalysis-like data to a source payload", () => {
    const converted = reviewVocToSource({
      reviewEvidence: {
        candidateId: "cand-suf-0001",
        dataset: {
          reviews: [
            { evidenceId: "rev-x", productAsin: "B0TESTAAA1", sourceProductRole: "current_candidate", rating: 5, reviewDate: "2026-07-01", reviewText: "nice", duplicateKey: "rid:r-x", language: "en", locale: "en-US" },
          ],
        },
      },
      vocAnalysis: {
        themes: {
          positiveThemes: [{ label: "positive", summary: "s", evidenceRefs: ["rev-x"] }],
          painPointThemes: [],
          usageScenarios: [],
          recurringRequests: [],
          weakSignals: [],
        },
      },
    });
    expect(converted.source).not.toBeNull();
    expect(converted.source!.reviews.length).toBe(1);
    expect(converted.source!.themes.length).toBe(1);
  });

  it("is idempotent: same key + same inputHash returns cached result without re-reading", async () => {
    const { store, gets, sets } = memoryStore();
    const readLive = vi.fn(async () => evidenceSufficient.voc);
    const call = makeCall();
    const first = await runVocAdapter(call, { mode: "live", readLive, idempotency: store });
    const second = await runVocAdapter(call, { mode: "live", readLive, idempotency: store });
    expect(first).toEqual(second);
    expect(readLive).toHaveBeenCalledTimes(1);
    expect(sets.length).toBe(1);
    expect(gets.length).toBe(2);
  });
});
