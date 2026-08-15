import { describe, expect, it } from "vitest";
import {
  browserEvidenceFailClosedCode,
  buildConfirmedSnapshot,
  BROWSER_EVIDENCE_COLLECTOR_VERSION,
  type BrowserEvidenceCollectPreview,
} from "@/lib/server/browserEvidenceCollect";
import type { AmazonDetailPageExtraction } from "@/tools/collectors/amazon/detail-page-extract";

const TASK_ASIN = "B0A1B2C3D4";

function extraction(overrides: Partial<AmazonDetailPageExtraction> = {}): AmazonDetailPageExtraction {
  return {
    schemaVersion: "amazon-detail-page-extraction.v1",
    expectedAsin: TASK_ASIN,
    urlAsin: TASK_ASIN,
    pageAsin: TASK_ASIN,
    entityBound: true,
    bindingProof: { urlMatchesExpected: true, pageAnchorMatchesExpected: true, productContainerFound: true },
    pageStatus: "ok",
    fields: {
      asin: { field: "asin", value: TASK_ASIN, status: "correct", reason: null },
      title: { field: "title", value: "John Boos Walnut Cutting Board", status: "correct", reason: null },
      price: { field: "price", value: 48.95, status: "correct", reason: null },
      bsr: { field: "bsr", value: 2541, status: "correct", reason: null },
      rating: { field: "rating", value: 4.2, status: "correct", reason: null },
      reviews: { field: "reviews", value: 4958, status: "correct", reason: null },
    },
    capturedAt: "2026-08-05T00:00:00.000Z",
    collectorVersion: BROWSER_EVIDENCE_COLLECTOR_VERSION,
    ...overrides,
  };
}

function preview(ext: AmazonDetailPageExtraction): BrowserEvidenceCollectPreview {
  return {
    extraction: ext,
    navigation: {
      requestedUrl: `https://www.amazon.com/dp/${ext.urlAsin ?? "X"}`,
      finalUrl: `https://www.amazon.com/dp/${ext.urlAsin ?? "X"}`,
      httpStatus: 200,
      navigationElapsedMs: 2400,
      allowedFinalOrigin: true,
    },
  };
}

const context = { mode: "owner" as const, token: "tok-owner" };
const capturedAt = "2026-08-05T00:00:00.000Z";

describe("browserEvidenceFailClosedCode (redirect/final-page classification)", () => {
  it("maps every non-ok page status to a fail-closed error code", () => {
    expect(browserEvidenceFailClosedCode("ok")).toBeNull();
    expect(browserEvidenceFailClosedCode("captcha")).toBe("page_blocked_captcha");
    expect(browserEvidenceFailClosedCode("login_wall")).toBe("page_blocked_login_wall");
    expect(browserEvidenceFailClosedCode("error_page")).toBe("page_error");
    expect(browserEvidenceFailClosedCode("unknown_page")).toBe("page_unknown");
  });
});

describe("buildConfirmedSnapshot (ASIN 三一致硬门禁)", () => {
  function expectAsinMismatch(ext: AmazonDetailPageExtraction) {
    try {
      buildConfirmedSnapshot({ preview: preview(ext), taskAsin: TASK_ASIN, capturedAt, context });
      throw new Error("expected asin_mismatch but succeeded");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("asin_mismatch");
    }
  }

  it("accepts when URL ASIN = page ASIN = task ASIN", () => {
    const snapshot = buildConfirmedSnapshot({ preview: preview(extraction()), taskAsin: TASK_ASIN, capturedAt, context });
    expect(snapshot.entityBinding.bound).toBe(true);
    expect(snapshot.fields.asin.value).toBe(TASK_ASIN);
    expect(snapshot.currency).toBe("USD");
  });

  it("rejects when URL ASIN differs from task ASIN", () => {
    expectAsinMismatch(extraction({ urlAsin: "B0ZZZZZZZZ" }));
  });

  it("rejects when page anchor ASIN differs from task ASIN", () => {
    expectAsinMismatch(extraction({ pageAsin: "B0ZZZZZZZZ" }));
  });

  it("rejects when expectedAsin differs from task ASIN", () => {
    expectAsinMismatch(extraction({ expectedAsin: "B0ZZZZZZZZ" }));
  });

  it("rejects when entity binding is not proven", () => {
    expectAsinMismatch(extraction({ entityBound: false, pageAsin: null }));
  });

  it("rejects when binding proof flags are not all true", () => {
    expectAsinMismatch(extraction({ bindingProof: { urlMatchesExpected: true, pageAnchorMatchesExpected: false, productContainerFound: true } }));
  });

  it("rejects a preview with an unknown schema version", () => {
    try {
      buildConfirmedSnapshot({
        preview: preview(extraction({ schemaVersion: "amazon-detail-page-extraction.v9" as AmazonDetailPageExtraction["schemaVersion"] })),
        taskAsin: TASK_ASIN,
        capturedAt,
        context,
      });
      throw new Error("expected preview_invalid but succeeded");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("preview_invalid");
    }
  });

  it("marks JPY currency and refuses to save price value", () => {
    const ext = extraction({
      fields: {
        ...extraction().fields,
        price: { field: "price", value: null, status: "unknown", reason: "currency_not_usd:JPY" },
      },
    });
    const snapshot = buildConfirmedSnapshot({ preview: preview(ext), taskAsin: TASK_ASIN, capturedAt, context });
    expect(snapshot.currency).toBe("JPY");
    expect(snapshot.fields.price).toMatchObject({ value: null, status: "unknown" });
  });

  it("records confirmedBy owner/visitor by context mode", () => {
    const owner = buildConfirmedSnapshot({ preview: preview(extraction()), taskAsin: TASK_ASIN, capturedAt, context });
    expect(owner.confirmedBy).toEqual({ mode: "owner", actorRef: "owner:v1" });
    const visitor = buildConfirmedSnapshot({
      preview: preview(extraction()),
      taskAsin: TASK_ASIN,
      capturedAt,
      context: { mode: "demo", token: "tok-v", demoAccessId: "demo-v", isActive: true, isExpired: false, remainingAiCalls: 1 },
    });
    expect(visitor.confirmedBy).toEqual({ mode: "visitor", actorRef: "visitor:demo-v" });
  });
});
