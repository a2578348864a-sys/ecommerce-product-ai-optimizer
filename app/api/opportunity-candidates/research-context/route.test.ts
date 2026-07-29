import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const state: {
  context: { mode: "owner" } | { mode: "demo"; demoAccessId: string };
} = { context: { mode: "demo", demoAccessId: "visitor-a" } };

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  getAuthoritativeCandidate: vi.fn(),
  evaluateCandidateResearchEligibility: vi.fn(),
  buildCandidateAnalysisContext: vi.fn(),
  createCandidateAnalysisBindingHash: vi.fn(),
  getBatch: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/server/candidateAuthority", () => ({
  getAuthoritativeCandidate: mocks.getAuthoritativeCandidate,
}));

vi.mock("@/lib/server/candidateResearchEligibility", () => ({
  evaluateCandidateResearchEligibility: mocks.evaluateCandidateResearchEligibility,
}));

vi.mock("@/lib/server/candidateAnalysisContext", () => ({
  buildCandidateAnalysisContext: mocks.buildCandidateAnalysisContext,
  createCandidateAnalysisBindingHash: mocks.createCandidateAnalysisBindingHash,
}));

vi.mock("@/lib/server/productBatchStoreResolver", () => ({
  getProductBatchStore: () => ({ getBatch: mocks.getBatch }),
}));

import { GET } from "./route";

const PRODUCT_BATCH_SOURCE = {
  productBatchId: "batch-a",
  productBatchItemId: "item-a",
  productName: "Visitor A Product",
  marketplace: "US",
  asin: "B000000001",
  reportType: "search_results",
  query: "organizer",
  category: "Home",
  researchPriority: "priority_1",
  evidenceStatus: "sufficient_for_comparison",
  sellerSpriteDisclaimerVersion: "sellersprite-v1-frozen.2026-07-27",
  capturedAt: "2026-07-28T00:00:00.000Z",
};

function candidate(id = "sandbox_candidate_a") {
  return {
    id,
    name: "Visitor A Product",
    source: "SellerSprite ProductBatch",
    status: "worth_analyzing",
    sourceMetaJson: "{}",
    analysisJson: "{}",
    convertedTaskId: null,
    originProductBatchItemId: "item-a",
  };
}

function request(candidateId: string, extra = "") {
  return {
    url: `http://localhost:3000/api/opportunity-candidates/research-context?candidateId=${encodeURIComponent(candidateId)}${extra}`,
    nextUrl: new URL(`http://localhost:3000/api/opportunity-candidates/research-context?candidateId=${encodeURIComponent(candidateId)}${extra}`),
    headers: new Headers(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.context = { mode: "demo", demoAccessId: "visitor-a" };
  mocks.requireAuthenticated.mockImplementation(() => ({ ok: true, context: state.context }));
  mocks.getAuthoritativeCandidate.mockImplementation(async (context, id) => (
    context.mode === "demo"
      && context.demoAccessId === "visitor-a"
      && id === "sandbox_candidate_a"
      ? candidate()
      : null
  ));
  mocks.evaluateCandidateResearchEligibility.mockResolvedValue({
    allowed: true,
    originKind: "seller_sprite_product_batch",
    researchMode: "market_research_only",
    promotionEligible: false,
    reasons: [],
    productBatchSource: PRODUCT_BATCH_SOURCE,
  });
  mocks.buildCandidateAnalysisContext.mockReturnValue({
    version: "candidate-analysis-context-v1",
    integrity: "verified_product_batch",
    facts: { capturedAt: "2026-07-28T00:00:00.000Z" },
    assessment: { researchMode: "market_research_only", promotionEligible: false },
  });
  mocks.createCandidateAnalysisBindingHash.mockReturnValue("a".repeat(64));
  mocks.getBatch.mockResolvedValue({ id: "batch-a", batchName: "Visitor A Batch" });
});

describe("GET /api/opportunity-candidates/research-context", () => {
  it("returns only the authenticated Visitor's minimal Candidate context", async () => {
    const response = await GET(request("sandbox_candidate_a", "&productName=forged&sourceMeta=forged") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      candidateId: "sandbox_candidate_a",
      productName: "Visitor A Product",
      sourceType: "seller_sprite_product_batch",
      productBatchName: "Visitor A Batch",
      asin: "B000000001",
      contextHash: "a".repeat(64),
      promotionEligible: false,
    });
    expect(body.data).not.toHaveProperty("sourceMetaJson");
    expect(body.data).not.toHaveProperty("analysisJson");
    expect(JSON.stringify(body)).not.toContain("forged");
  });

  it("returns a validated cached ProductBatch image without exposing raw Candidate metadata", async () => {
    const imageBytes = Buffer.from([0xff, 0xd8, 0xff]);
    const imageHash = createHash("sha256").update(imageBytes).digest("hex");
    mocks.getAuthoritativeCandidate.mockResolvedValueOnce({
      ...candidate(),
      sourceMetaJson: JSON.stringify({
        originKind: "seller_sprite_product_batch",
        productKey: "amazon:US:B000000001",
        itemIdentityHash: "1".repeat(64),
        capturedAt: "2026-07-28T00:00:00.000Z",
        imageSnapshot: {
          status: "cached",
          mimeType: "image/jpeg",
          sizeBytes: imageBytes.length,
          sha256: imageHash,
          base64: imageBytes.toString("base64"),
        },
      }),
    });

    const response = await GET(request("sandbox_candidate_a") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.productImage).toEqual({
      dataUrl: `data:image/jpeg;base64,${imageBytes.toString("base64")}`,
      mimeType: "image/jpeg",
      contentHash: imageHash,
      provenance: "product_batch_snapshot",
    });
    expect(body.data).not.toHaveProperty("sourceMetaJson");
    expect(JSON.stringify(body)).not.toContain("itemIdentityHash");
  });

  it("returns the same 404 for another Visitor's Candidate and for an unknown Candidate", async () => {
    state.context = { mode: "demo", demoAccessId: "visitor-b" };

    const foreign = await GET(request("sandbox_candidate_a") as never);
    const missing = await GET(request("missing-candidate") as never);
    const foreignBody = await foreign.json();
    const missingBody = await missing.json();

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreignBody).toEqual(missingBody);
    expect(JSON.stringify(foreignBody)).not.toContain("Visitor A");
    expect(mocks.evaluateCandidateResearchEligibility).not.toHaveBeenCalled();
  });

  it("does not let Owner read a Visitor Candidate through the ordinary endpoint", async () => {
    state.context = { mode: "owner" };

    const response = await GET(request("sandbox_candidate_a") as never);
    expect(response.status).toBe(404);
  });

  it("lets Owner read an Owner Candidate while returning only minimal public context", async () => {
    state.context = { mode: "owner" };
    mocks.getAuthoritativeCandidate.mockResolvedValueOnce({
      ...candidate("candidate-owner-a"),
      name: "Owner Product",
      source: "Market screening",
    });
    mocks.evaluateCandidateResearchEligibility.mockResolvedValueOnce({
      allowed: true,
      originKind: "legacy_market_screening",
      researchMode: "legacy_r22_stage2",
      promotionEligible: true,
      reasons: [],
    });
    mocks.buildCandidateAnalysisContext.mockReturnValueOnce({
      version: "candidate-analysis-context-v1",
      integrity: "verified_public",
      facts: { capturedAt: "2026-07-28T00:00:00.000Z" },
      assessment: { queueSuggestion: "review" },
    });

    const response = await GET(request("candidate-owner-a") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      candidateId: "candidate-owner-a",
      productName: "Owner Product",
      sourceType: "legacy_market_screening",
      sourceLabel: "Market screening",
      promotionEligible: false,
    });
    expect(body.data).not.toHaveProperty("sourceMetaJson");
    expect(body.data).not.toHaveProperty("analysisJson");
  });

  it("fails closed with the same 404 when current research eligibility no longer passes", async () => {
    mocks.evaluateCandidateResearchEligibility.mockResolvedValueOnce({
      allowed: false,
      originKind: "seller_sprite_product_batch",
      researchMode: "market_research_only",
      promotionEligible: false,
      reasons: ["candidate_not_ready"],
    });

    const response = await GET(request("sandbox_candidate_a") as never);
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("candidate_not_ready");
  });

  it("requires authentication before reading Candidate authority", async () => {
    mocks.requireAuthenticated.mockReturnValueOnce({
      ok: false,
      status: 401,
      code: "invalid_access",
      message: "请先登录",
    });

    const response = await GET(request("sandbox_candidate_a") as never);
    expect(response.status).toBe(401);
    expect(mocks.getAuthoritativeCandidate).not.toHaveBeenCalled();
  });
});
