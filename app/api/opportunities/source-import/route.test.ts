import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssessmentHash, createEvidenceHash } from "@/lib/sourceEvidenceContract";
import { verifySourceProof } from "@/lib/server/sourceProof";

const mocks = vi.hoisted(() => ({
  crawlUrls: vi.fn(),
  normalizeResults: vi.fn(),
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));
vi.mock("@/lib/server/radarCrawler", () => ({ crawlUrls: mocks.crawlUrls }));
vi.mock("@/lib/server/radarNormalize", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/server/radarNormalize")>(),
  normalizeResults: mocks.normalizeResults,
}));

import { POST } from "./route";

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/opportunities/source-import", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", "source-import-proof-test-password");
  mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner", token: "owner-token" } });
  mocks.crawlUrls.mockResolvedValue({ results: [], warnings: [] });
  mocks.normalizeResults.mockReturnValue({ items: [], warnings: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const crawlProvenance = {
  submittedUrl: "https://feed.example/rss.xml",
  finalUrl: "https://feed.example/rss.xml",
  redirectCount: 0,
  robots: "not_present" as const,
  transportSecurity: "https" as const,
  httpStatus: 200,
  contentType: "application/rss+xml",
  capturedAt: "2026-07-11T00:00:00.000Z",
};

function mockSuccessfulCandidate(overrides: Record<string, unknown> = {}) {
  const item = {
    title: "Portable Phone Stand",
    sourceUrl: "https://shop.example/products/stand?id=42",
    sourceType: "rss" as const,
    sourceHost: "feed.example",
    categoryHint: "收纳/桌面",
    signalText: "Foldable desk accessory",
    riskHint: "低风险品类",
    extractedAt: crawlProvenance.capturedAt,
    rawSnippet: "Portable Phone Stand",
    candidateType: "product_candidate" as const,
    provenance: {
      documentUrl: crawlProvenance.finalUrl,
      candidateUrl: "https://shop.example/products/stand?id=42",
      sourceRelation: "document_item" as const,
      crawl: crawlProvenance,
      extractionSignals: ["rss_item"],
    },
    ...overrides,
  };
  mocks.crawlUrls.mockResolvedValue({
    results: [{
      url: crawlProvenance.submittedUrl,
      status: "ok",
      statusCode: 200,
      contentType: crawlProvenance.contentType,
      body: "<rss />",
      provenance: crawlProvenance,
    }],
    warnings: [],
  });
  mocks.normalizeResults.mockReturnValue({ items: [item], warnings: [] });
  return { item };
}

describe("source-import request bounds", () => {
  it("rejects an oversized declared body before crawler invocation", async () => {
    const response = await POST(request(
      { input: "https://example.com/item" },
      { "content-length": String(32 * 1024 + 1) },
    ) as never);

    expect(response.status).toBe(413);
    expect(mocks.crawlUrls).not.toHaveBeenCalled();
  });

  it("rejects oversized actual UTF-8 input even without a content-length header", async () => {
    const response = await POST(request({
      input: `https://example.com/item\n${"中".repeat(11_000)}`,
    }) as never);

    expect(response.status).toBe(413);
    expect(mocks.crawlUrls).not.toHaveBeenCalled();
  });

  it("passes a bounded authenticated public URL to the controlled crawler", async () => {
    const response = await POST(request({ input: "https://example.com/item" }) as never);

    expect(response.status).toBe(200);
    expect(mocks.crawlUrls).toHaveBeenCalledWith(["https://example.com/item"]);
  });
});

describe("source-import signed source contract", () => {
  it("returns additive V2 Evidence, RuleAssessment and a verifiable Owner proof", async () => {
    mockSuccessfulCandidate();

    const response = await POST(request({ input: crawlProvenance.submittedUrl }) as never);
    const body = await response.json();
    const candidate = body.candidates[0];

    expect(response.status).toBe(200);
    expect(mocks.normalizeResults).toHaveBeenCalledWith(expect.any(Array), { includeRejected: true });
    expect(candidate).toMatchObject({
      title: "Portable Phone Stand",
      sourceUrl: "https://shop.example/products/stand?id=42",
      score: 64,
      sourceEvidence: {
        version: "candidate-source-v2",
        origin: "public_url",
        submittedUrl: "https://feed.example/rss.xml",
        finalUrl: "https://feed.example/rss.xml",
        candidateUrl: "https://shop.example/products/stand?id=42",
        sourceRelation: "document_item",
        sourceHost: "feed.example",
        sourceType: "rss",
        transportSecurity: "https",
        retrieval: {
          status: "retrieved",
          httpStatus: 200,
          contentType: "application/rss+xml",
          robots: "not_present",
          redirectCount: 0,
        },
        observations: {
          title: "Portable Phone Stand",
          categoryHint: "收纳/桌面",
          signalText: "Foldable desk accessory",
          priceText: null,
          hasImage: null,
        },
        extractionSignals: ["rss_item"],
      },
      ruleAssessment: {
        version: "candidate-rule-v1",
        algorithm: "radar-evidence-v2",
        candidateType: "product_candidate",
        scores: {
          demandSignal: 70,
          supplyEase: 35,
          risk: 15,
          beginnerFit: 50,
          final: 64,
        },
        queueSuggestion: "review",
      },
    });
    expect(typeof candidate.sourceProof).toBe("string");

    const bindings = {
      subject: "owner",
      evidenceHash: createEvidenceHash(candidate.sourceEvidence),
      assessmentHash: createAssessmentHash(candidate.ruleAssessment),
      sourceType: "rss" as const,
    };
    expect(candidate.ruleAssessment.evidenceHash).toBe(bindings.evidenceHash);
    expect(verifySourceProof(candidate.sourceProof, bindings)).toMatchObject({ ok: true });
  });

  it("binds Visitor proofs to the authenticated Visitor subject", async () => {
    mockSuccessfulCandidate();
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a", token: "visitor-token" },
    });

    const response = await POST(request({ input: crawlProvenance.submittedUrl }) as never);
    const body = await response.json();
    const candidate = body.candidates[0];
    const common = {
      evidenceHash: createEvidenceHash(candidate.sourceEvidence),
      assessmentHash: createAssessmentHash(candidate.ruleAssessment),
      sourceType: "rss" as const,
    };

    expect(verifySourceProof(candidate.sourceProof, { subject: "demo:visitor-a", ...common }))
      .toMatchObject({ ok: true });
    expect(verifySourceProof(candidate.sourceProof, { subject: "demo:visitor-b", ...common }))
      .toEqual({ ok: false, reason: "subject_mismatch" });
  });

  it("detects Evidence or RuleAssessment tampering after response", async () => {
    mockSuccessfulCandidate();
    const response = await POST(request({ input: crawlProvenance.submittedUrl }) as never);
    const body = await response.json();
    const candidate = body.candidates[0];

    const tamperedEvidence = {
      ...candidate.sourceEvidence,
      observations: { ...candidate.sourceEvidence.observations, title: "Client forged title" },
    };
    expect(verifySourceProof(candidate.sourceProof, {
      subject: "owner",
      evidenceHash: createEvidenceHash(tamperedEvidence),
      assessmentHash: createAssessmentHash(candidate.ruleAssessment),
      sourceType: "rss",
    })).toEqual({ ok: false, reason: "binding_mismatch" });

    const tamperedAssessment = {
      ...candidate.ruleAssessment,
      scores: { ...candidate.ruleAssessment.scores, final: 99 },
    };
    expect(verifySourceProof(candidate.sourceProof, {
      subject: "owner",
      evidenceHash: createEvidenceHash(candidate.sourceEvidence),
      assessmentHash: createAssessmentHash(tamperedAssessment),
      sourceType: "rss",
    })).toEqual({ ok: false, reason: "binding_mismatch" });
  });

  it("omits a candidate that lacks authoritative provenance instead of returning it unsigned", async () => {
    const { item } = mockSuccessfulCandidate();
    const unsafe = { ...item, provenance: undefined };
    mocks.normalizeResults.mockReturnValue({ items: [unsafe], warnings: [] });

    const response = await POST(request({ input: crawlProvenance.submittedUrl }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidates).toEqual([]);
    expect(body.summary.totalCandidates).toBe(0);
    expect(body.warnings).toContain("忽略 1 条无法建立可信来源契约的候选");
  });

  it("returns rejected source text only as a signed non-importable preview", async () => {
    const { item } = mockSuccessfulCandidate({
      title: "Privacy Policy",
      signalText: "Privacy Policy",
      candidateType: "rejected",
      rejectionReason: "匹配低质模式",
    });
    mocks.normalizeResults.mockReturnValue({
      items: [item],
      warnings: ["识别 1 条低质或非商品文本，仅供预览"],
    });

    const response = await POST(request({ input: crawlProvenance.submittedUrl }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      candidateType: "rejected",
      ruleAssessment: {
        algorithm: "radar-evidence-v2",
        candidateType: "rejected",
        queueSuggestion: "reject",
      },
    });
    expect(body.warnings).toContain("识别 1 条低质或非商品文本，仅供预览");
  });

  it("fails closed with a generic error when SourceProof signing is unavailable", async () => {
    mockSuccessfulCandidate();
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");

    const response = await POST(request({ input: crawlProvenance.submittedUrl }) as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "source_contract_failed",
        message: "来源证明暂时无法生成，请稍后重试。",
      },
    });
    expect(JSON.stringify(body)).not.toContain("SOURCE_PROOF_KEY_MISSING");
    expect(body.candidates).toBeUndefined();
  });

  it("returns only fully signed candidates when another submitted URL fails", async () => {
    mockSuccessfulCandidate();
    mocks.crawlUrls.mockResolvedValue({
      results: [
        {
          url: crawlProvenance.submittedUrl,
          status: "ok",
          statusCode: 200,
          contentType: crawlProvenance.contentType,
          body: "<rss />",
          provenance: crawlProvenance,
        },
        {
          url: "https://blocked.example/item",
          status: "blocked",
          error: "公开 URL 安全检查未通过",
          failureReason: "robots_disallowed",
        },
      ],
      warnings: [],
    });

    const response = await POST(request({
      input: `${crawlProvenance.submittedUrl}\nhttps://blocked.example/item`,
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({ totalUrls: 2, okUrls: 1, failedUrls: 1, totalCandidates: 1 });
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      sourceEvidence: { version: "candidate-source-v2" },
      ruleAssessment: { version: "candidate-rule-v1" },
    });
    expect(typeof body.candidates[0].sourceProof).toBe("string");
    expect(body.warnings.some((warning: string) => warning.includes("robots_disallowed"))).toBe(true);
  });
});
