import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  convert: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/server/productBatchCandidateService", () => ({
  convertProductBatchItemToCandidate: mocks.convert,
  ProductBatchCandidateConversionError: class ProductBatchCandidateConversionError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = "ProductBatchCandidateConversionError";
    }
  },
}));

import { POST } from "./route";

function request(body: unknown, headers: Record<string, string> = {}) {
  return {
    url: "http://localhost:3000/api/product-batches/candidates",
    headers: new Headers({
      origin: "http://localhost:3000",
      host: "localhost:3000",
      ...headers,
    }),
    json: async () => body,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticated.mockReturnValue({
    ok: true,
    context: { mode: "owner", token: "owner-token" },
  });
  mocks.convert.mockResolvedValue({
    candidateId: "candidate-a",
    created: true,
    destination: "research",
    destinationUrl: "/agent/run?source=opportunity&candidateId=candidate-a&sourceMeta=%7B%7D",
    sourceMeta: {
      version: "product-batch-agent-run-source.v1",
      originKind: "seller_sprite_product_batch",
      productBatchId: "batch-a",
      productBatchItemId: "item-a",
      productName: "Closet organizer",
    },
  });
});

describe("POST /api/product-batches/candidates", () => {
  it("accepts only productBatchItemId and returns the server-built Candidate handoff", async () => {
    const response = await POST(request({ productBatchItemId: "item-a" }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.convert).toHaveBeenCalledWith(
      { mode: "owner", token: "owner-token" },
      "item-a",
    );
    expect(body.data).toMatchObject({
      candidateId: "candidate-a",
      created: true,
      destination: "research",
      sourceMeta: {
        originKind: "seller_sprite_product_batch",
        productName: "Closet organizer",
      },
    });
  });

  it.each([
    {},
    { productBatchItemId: "" },
    { productBatchItemId: "item-a", productName: "client-forged title" },
    { productBatchItemId: "item-a", evidenceHash: "f".repeat(64) },
    { productBatchItemId: "item-a", ownerSubject: "forged-owner" },
  ])("fails closed for missing or extra client-authoritative fields: %j", async (payload) => {
    const response = await POST(request(payload) as never);

    expect(response.status).toBe(400);
    expect(mocks.convert).not.toHaveBeenCalled();
  });

  it("requires same-origin authenticated access", async () => {
    const crossOrigin = await POST(request(
      { productBatchItemId: "item-a" },
      { origin: "https://evil.example" },
    ) as never);
    expect(crossOrigin.status).toBe(403);
    expect(mocks.convert).not.toHaveBeenCalled();

    mocks.requireAuthenticated.mockReturnValueOnce({
      ok: false,
      status: 401,
      code: "invalid_access",
      message: "unauthorized",
    });
    const unauthenticated = await POST(request({ productBatchItemId: "item-a" }) as never);
    expect(unauthenticated.status).toBe(401);
  });
});
