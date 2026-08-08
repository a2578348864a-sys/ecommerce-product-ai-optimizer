import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: {
    mode: "owner" as "owner" | "demo",
    token: "token",
    demoAccessId: "demo_aaaaaaaaaaaaaaaa",
  },
  store: {
    listBatches: vi.fn(),
    getSelection: vi.fn(),
    getBatch: vi.fn(),
    getBatchItems: vi.fn(),
    activateBatch: vi.fn(),
    activateLegacy: vi.fn(),
    archiveBatch: vi.fn(),
  },
  getProductBatchStore: vi.fn(),
  getProductBatchAccessSummary: vi.fn(),
  importSellerSpriteProductBatch: vi.fn(),
  inspectSellerSpriteProductBatch: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => ({
    ok: true,
    context: mocks.context,
  }),
}));

vi.mock("@/lib/server/productBatchStoreResolver", () => ({
  getProductBatchStore: mocks.getProductBatchStore,
  getProductBatchAccessSummary: mocks.getProductBatchAccessSummary,
}));

vi.mock("@/lib/server/productBatchImportService", () => ({
  importSellerSpriteProductBatch: mocks.importSellerSpriteProductBatch,
  inspectSellerSpriteProductBatch: mocks.inspectSellerSpriteProductBatch,
  ProductBatchImportError: class ProductBatchImportError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

import { GET, POST } from "./route";
import {
  GET as GET_DETAIL,
  PATCH as PATCH_DETAIL,
} from "./[id]/route";
import { PATCH as PATCH_SELECTION } from "./selection/route";

function request(
  path: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
) {
  return new NextRequest(`http://localhost:43128${path}`, init);
}

function formRequest(extra: Record<string, string | null> = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "input.xlsx"));
  form.set("reportType", "search_results");
  form.set("query", "organizer");
  form.set("category", "Home & Kitchen");
  form.set("priceMin", "10");
  form.set("priceMax", "40");
  for (const [key, value] of Object.entries(extra)) {
    if (value === null) form.delete(key);
    else form.set(key, value);
  }
  return request("/api/product-batches", {
    method: "POST",
    body: form,
    headers: { origin: "http://localhost:43128" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mode = "owner";
  mocks.context.demoAccessId = "demo_aaaaaaaaaaaaaaaa";
  mocks.getProductBatchStore.mockReturnValue(mocks.store);
  mocks.getProductBatchAccessSummary.mockReturnValue({
    accessMode: "owner",
    maxProducts: null,
    usedProducts: null,
    remainingProducts: null,
  });
  mocks.store.listBatches.mockResolvedValue([]);
  mocks.store.getSelection.mockResolvedValue(null);
  mocks.store.getBatch.mockResolvedValue(null);
  mocks.store.getBatchItems.mockResolvedValue([]);
  mocks.store.activateBatch.mockResolvedValue({
    activeProductBatchId: "batch-a",
    activeLegacyRegistrationId: null,
    updatedAt: "2026-07-28T00:00:00.000Z",
  });
  mocks.store.activateLegacy.mockResolvedValue({
    activeProductBatchId: null,
    activeLegacyRegistrationId: "production-registration-20260717-01",
    updatedAt: "2026-07-28T00:00:00.000Z",
  });
  mocks.store.archiveBatch.mockResolvedValue({ id: "batch-a", batchStatus: "archived" });
  mocks.importSellerSpriteProductBatch.mockResolvedValue({
    created: true,
    batch: { id: "batch-a", batchStatus: "ready" },
  });
});

describe("unified ProductBatch API", () => {
  it.each([
    ["owner", "owner", null],
    ["demo", "visitor", 5],
  ] as const)("returns one list schema for %s", async (mode, accessMode, remaining) => {
    mocks.context.mode = mode;
    mocks.getProductBatchAccessSummary.mockReturnValue({
      accessMode,
      maxProducts: remaining === null ? null : 5,
      usedProducts: remaining === null ? null : 0,
      remainingProducts: remaining,
    });
    const response = await GET(request("/api/product-batches"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(Object.keys(body.data)).toEqual([
      "accessMode",
      "maxProducts",
      "usedProducts",
      "remainingProducts",
      "batches",
      "selection",
      "legacyRegistrationId",
    ]);
    expect(mocks.getProductBatchStore).toHaveBeenCalledWith(mocks.context);
  });

  it("lets Visitor import through the same route without accepting identity selectors", async () => {
    mocks.context.mode = "demo";
    const response = await POST(formRequest());
    expect(response.status).toBe(201);
    expect(mocks.importSellerSpriteProductBatch).toHaveBeenCalledOnce();
    expect(mocks.getProductBatchStore).toHaveBeenCalledWith(mocks.context);

    for (const field of ["demoAccessId", "ownerSubject", "storageMode", "accessMode"]) {
      const rejected = await POST(formRequest({ [field]: "owner" }));
      expect(rejected.status).toBe(400);
    }
  });
  mocks.inspectSellerSpriteProductBatch.mockReturnValue({
    reportType: "category_current",
    reportTypeDetected: true,
    categoryDetection: {
      status: "detected",
      category: "Kitchen & Dining",
      distribution: [{ category: "Kitchen & Dining", count: 10 }],
      validCategoryCount: 10,
    },
    query: null,
    queryDetection: "not_available",
  });

  it("accepts an omitted report type and delegates authoritative detection to the import service", async () => {
    const response = await POST(formRequest({ reportType: null }));

    expect(response.status).toBe(201);
    expect(mocks.importSellerSpriteProductBatch).toHaveBeenCalledWith(
      expect.objectContaining({ reportType: null }),
    );
  });

  it("inspects the selected workbook before requiring import brief fields and does not open a Store", async () => {
    const response = await POST(formRequest({
      operation: "inspect",
      reportType: null,
      query: null,
      category: null,
      priceMin: null,
      priceMax: null,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      reportType: "category_current",
      categoryDetection: { category: "Kitchen & Dining" },
    });
    expect(mocks.inspectSellerSpriteProductBatch).toHaveBeenCalledOnce();
    expect(mocks.importSellerSpriteProductBatch).not.toHaveBeenCalled();
    expect(mocks.getProductBatchStore).not.toHaveBeenCalled();
  });

  it("fails closed for a batch outside the authenticated Store", async () => {
    const response = await GET_DETAIL(
      request("/api/product-batches/owner-batch"),
      { params: Promise.resolve({ id: "owner-batch" }) },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("batch_not_found");
  });

  it("activates and archives through the authenticated Store only", async () => {
    mocks.store.getBatch.mockResolvedValue({ id: "batch-a" });
    const activate = await PATCH_DETAIL(
      request("/api/product-batches/batch-a", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:43128",
        },
        body: JSON.stringify({ action: "activate" }),
      }),
      { params: Promise.resolve({ id: "batch-a" }) },
    );
    expect(activate.status).toBe(200);
    expect(mocks.store.activateBatch).toHaveBeenCalledWith("batch-a");

    const archive = await PATCH_DETAIL(
      request("/api/product-batches/batch-a", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:43128",
        },
        body: JSON.stringify({ action: "archive" }),
      }),
      { params: Promise.resolve({ id: "batch-a" }) },
    );
    expect(archive.status).toBe(200);
    expect(mocks.store.archiveBatch).toHaveBeenCalledWith("batch-a");
  });

  it("switches Legacy selection without a client-selected storage identity", async () => {
    const response = await PATCH_SELECTION(request("/api/product-batches/selection", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:43128",
      },
      body: JSON.stringify({
        action: "activate_legacy",
        registrationId: "production-registration-20260717-01",
      }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.store.activateLegacy).toHaveBeenCalledWith(
      "production-registration-20260717-01",
    );
  });
});
