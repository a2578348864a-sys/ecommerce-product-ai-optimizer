import { beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  AMAZON_ADAPTER_ERROR_CODES,
  AMAZON_FIELD_WHITELIST,
  __resetAmazonAdapterCacheForTest,
  buildToolResult,
  mapPageStatusToError,
  parseTargetEntity,
  resolveRequestedFields,
  runAmazonAdapter,
  splitAdPlacements,
  validateEntity,
  validateToolResult,
  type AmazonAdapterOptions,
  type AmazonExtraction,
  type AmazonLiveExecutor,
} from "@/lib/v4/adapters/amazon";
import type { ToolCallEnvelope } from "@/lib/v4/tools/envelope";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures", "amazon-recorded");

function makeEnvelope(overrides: Partial<ToolCallEnvelope> = {}): ToolCallEnvelope {
  return {
    toolCallId: "call-1",
    runId: "run-1",
    questionId: "q-1",
    toolName: "amazon_bounded_browser",
    toolVersion: "amazon-bounded-browser.v1",
    targetEntity: "yoga mat",
    marketplace: "amazon.com",
    allowedDomains: ["amazon.com", "www.amazon.com"],
    requestedFields: ["asin", "title", "price", "rating", "reviewCount", "productUrl", "capturedAt"],
    maxSteps: 5,
    timeoutMs: 60000,
    budget: { maxCost: 1, currency: "USD", maxBrowserSteps: 10 },
    inputHash: "search-ok-hash",
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

function baseObservation(overrides: Record<string, unknown> = {}) {
  return {
    asin: "B0YOGA1234",
    title: "Yoga Mat Non-Slip TPE 6mm",
    price: 24.99,
    priceCurrency: "USD",
    rating: 4.5,
    reviewCount: 1234,
    bsr: null,
    sellingPoints: [],
    productUrl: "https://www.amazon.com/dp/B0YOGA1234",
    imageUrl: null,
    position: 1,
    sponsored: false,
    capturedAt: "2026-08-21T12:00:00.000Z",
    ...overrides,
  } as AmazonExtraction["observations"][number];
}

function makeSearchExtraction(overrides: Partial<AmazonExtraction> = {}): AmazonExtraction {
  return {
    entityType: "search_results",
    observedEntity: "yoga mat",
    context: {
      host: "www.amazon.com",
      marketplace: "amazon.com",
      pageUrl: "https://www.amazon.com/s?k=yoga+mat",
      pageStatus: "amazon_normal",
      observedMarket: "US",
      observedCurrency: "USD",
      deliveryRegion: "Deliver to New York 10001",
      language: "en-us",
      amazonBrandMarkerPresent: true,
    },
    observations: [baseObservation()],
    adPlacements: [],
    detail: null,
    rawCardCount: 1,
    keyContainerFound: true,
    rawArtifactSample: null,
    cost: { usedBrowserSteps: 1, usedCost: 0.05, currency: "USD" },
    ...overrides,
  };
}

describe("pure helpers", () => {
  it("parseTargetEntity distinguishes ASIN vs keyword", () => {
    expect(parseTargetEntity("B0YOGA1234")).toEqual({ kind: "asin", value: "B0YOGA1234" });
    expect(parseTargetEntity("yoga mat")).toEqual({ kind: "keyword", value: "yoga mat" });
  });

  it("resolveRequestedFields keeps only whitelist fields", () => {
    const { allowed, rejected } = resolveRequestedFields(makeEnvelope({ requestedFields: ["asin", "title", "secretField"] }));
    expect(allowed.has("asin")).toBe(true);
    expect(allowed.has("title")).toBe(true);
    expect([...allowed]).toEqual(["asin", "title"]);
    expect(rejected).toEqual(["secretField"]);
  });

  it("splitAdPlacements separates sponsored=true from organic", () => {
    const { observations, adPlacements } = splitAdPlacements([
      baseObservation({ asin: "B0ADPLACE1", sponsored: true }),
      baseObservation({ asin: "B0YOGA1234", sponsored: false }),
      baseObservation({ asin: "B0UNKNOWN99", sponsored: null }),
    ]);
    expect(adPlacements).toHaveLength(1);
    expect(adPlacements[0].asin).toBe("B0ADPLACE1");
    expect(observations).toHaveLength(2);
  });

  it("mapPageStatusToError maps all mandatory error codes", () => {
    expect(mapPageStatusToError("captcha")?.code).toBe("CAPTCHA_OR_BOT_CHECK");
    expect(mapPageStatusToError("login_wall")?.code).toBe("AUTH_REQUIRED");
    expect(mapPageStatusToError("region_selection")?.code).toBe("WRONG_ENTITY");
    expect(mapPageStatusToError("unknown_page")?.code).toBe("DOM_CHANGED");
    expect(mapPageStatusToError("error_page")?.code).toBe("RATE_LIMITED");
    expect(mapPageStatusToError("loading")?.code).toBe("TIMEOUT");
    expect(mapPageStatusToError("amazon_normal")).toBeNull();
  });

  it("exports all 13 project error codes", () => {
    expect(AMAZON_ADAPTER_ERROR_CODES).toContain("AUTH_REQUIRED");
    expect(AMAZON_ADAPTER_ERROR_CODES).toContain("CAPTCHA_OR_BOT_CHECK");
    expect(AMAZON_ADAPTER_ERROR_CODES).toContain("WRONG_ENTITY");
    expect(AMAZON_ADAPTER_ERROR_CODES).toContain("DOM_CHANGED");
    expect(AMAZON_ADAPTER_ERROR_CODES).toContain("RATE_LIMITED");
    expect(AMAZON_ADAPTER_ERROR_CODES).toContain("TIMEOUT");
    expect(AMAZON_ADAPTER_ERROR_CODES).toContain("BUDGET_EXCEEDED");
    expect(AMAZON_ADAPTER_ERROR_CODES).toHaveLength(13);
  });
});

describe("validateEntity", () => {
  it("rejects non-allowed host", () => {
    const err = validateEntity(makeEnvelope(), makeSearchExtraction({ context: { ...makeSearchExtraction().context, host: "evil.com" } }));
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("host_not_allowed");
  });

  it("rejects marketplace mismatch", () => {
    const err = validateEntity(makeEnvelope({ marketplace: "amazon.com" }), makeSearchExtraction({ context: { ...makeSearchExtraction().context, marketplace: "amazon.co.uk" } }));
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("marketplace_mismatch");
  });

  it("accepts ASIN target on search_results when an organic card matches (WE-1 positive)", () => {
    const extraction = makeSearchExtraction({ observations: [baseObservation({ asin: "B0YOGA1234", sponsored: false })] });
    const err = validateEntity(makeEnvelope({ targetEntity: "B0YOGA1234" }), extraction);
    expect(err).toBeNull();
  });

  it("rejects ASIN target on search_results when target card is a recommended/ad placement (WE-1)", () => {
    const extraction = makeSearchExtraction({
      observations: [baseObservation({ asin: "B0YOGA1234", sponsored: true })],
    });
    const err = validateEntity(makeEnvelope({ targetEntity: "B0YOGA1234" }), extraction);
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("target_card_not_organic");
  });

  it("rejects ASIN target on search_results when target card is an ambiguous ad marker (WE-1)", () => {
    const extraction = makeSearchExtraction({
      observations: [baseObservation({
        asin: "B0YOGA1234",
        sponsored: null,
        sponsoredDiagnostic: { state: null, reasonCode: "ambiguous_ad_text_without_known_marker", matchedText: "Promoted" },
      })],
    });
    const err = validateEntity(makeEnvelope({ targetEntity: "B0YOGA1234" }), extraction);
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("target_card_not_organic");
  });

  it("rejects ASIN mismatch on detail page", () => {
    const extraction = makeSearchExtraction({
      entityType: "product_detail",
      observedEntity: "B0WRONG999",
      detail: baseObservation({ asin: "B0WRONG999", productUrl: "https://www.amazon.com/dp/B0WRONG999" }),
    });
    const err = validateEntity(makeEnvelope({ targetEntity: "B0CORRECT1" }), extraction);
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("asin_mismatch");
  });

  it("accepts a valid detail ASIN binding", () => {
    const extraction = makeSearchExtraction({
      entityType: "product_detail",
      observedEntity: "B0YOGA1234",
      detail: baseObservation({ asin: "B0YOGA1234" }),
    });
    const err = validateEntity(makeEnvelope({ targetEntity: "B0YOGA1234" }), extraction);
    expect(err).toBeNull();
  });

  it("rejects keyword mismatch on search page", () => {
    const err = validateEntity(makeEnvelope({ targetEntity: "running shoes" }), makeSearchExtraction());
    expect(err).not.toBeNull();
    expect(err!.reason).toContain("keyword_mismatch");
  });
});

describe("buildToolResult — failure paths", () => {
  it("WRONG_ENTITY: host not allowed", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction({ context: { ...makeSearchExtraction().context, host: "evil.com" } }));
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("stop");
    expect(result.errors[0].code).toBe("WRONG_ENTITY");
    expect(result.errors[0].safeMessage).toContain("host_not_allowed");
  });

  it("WRONG_ENTITY: region_selection page", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction({ context: { ...makeSearchExtraction().context, pageStatus: "region_selection" } }));
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("stop");
    expect(result.errors[0].code).toBe("WRONG_ENTITY");
  });

  it("no_results: empty organic results", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction({ observations: [], keyContainerFound: false }));
    expect(result.status).toBe("no_results");
    expect(result.nextAction).toBe("revise_plan");
    expect(result.errors).toEqual([]);
  });

  it("AUTH_REQUIRED: login_wall", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction({ context: { ...makeSearchExtraction().context, pageStatus: "login_wall" } }));
    expect(result.status).toBe("waiting_auth");
    expect(result.nextAction).toBe("wait_human");
    expect(result.errors[0].code).toBe("AUTH_REQUIRED");
  });

  it("CAPTCHA_OR_BOT_CHECK: captcha", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction({ context: { ...makeSearchExtraction().context, pageStatus: "captcha" } }));
    expect(result.status).toBe("waiting_auth");
    expect(result.nextAction).toBe("wait_human");
    expect(result.errors[0].code).toBe("CAPTCHA_OR_BOT_CHECK");
  });

  it("DOM_CHANGED: unknown_page", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction({ context: { ...makeSearchExtraction().context, pageStatus: "unknown_page" } }));
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("stop");
    expect(result.errors[0].code).toBe("DOM_CHANGED");
  });

  it("RATE_LIMITED: error_page", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction({ context: { ...makeSearchExtraction().context, pageStatus: "error_page" } }));
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("retry");
    expect(result.errors[0].code).toBe("RATE_LIMITED");
  });

  it("TIMEOUT: loading", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction({ context: { ...makeSearchExtraction().context, pageStatus: "loading" } }));
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("retry");
    expect(result.errors[0].code).toBe("TIMEOUT");
  });

  it("BUDGET_EXCEEDED: browser steps over budget", () => {
    const result = buildToolResult(makeEnvelope({ budget: { maxCost: 1, currency: "USD", maxBrowserSteps: 1 } }), makeSearchExtraction({ cost: { usedBrowserSteps: 5, usedCost: 0.05, currency: "USD" } }));
    expect(result.status).toBe("budget_exceeded");
    expect(result.nextAction).toBe("wait_human");
    expect(result.errors[0].code).toBe("BUDGET_EXCEEDED");
  });

  it("WRONG_ENTITY: environment market mismatch", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction({ context: { ...makeSearchExtraction().context, observedMarket: "JP" } }));
    expect(result.status).toBe("stopped_error");
    expect(result.errors[0].code).toBe("WRONG_ENTITY");
  });
});

describe("buildToolResult — ok path and boundaries", () => {
  it("produces a valid envelope (validateToolResult ok)", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction());
    expect(validateToolResult(result).ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
  });

  it("excludes sponsored placements from target observations", () => {
    const result = buildToolResult(makeEnvelope(), makeSearchExtraction({
      observations: [
        baseObservation({ asin: "B0ADPLACE1", sponsored: true }),
        baseObservation({ asin: "B0YOGA1234", sponsored: false }),
      ],
    }));
    expect(result.status).toBe("ok");
    const data = result.data as { observations: Array<Record<string, unknown>> };
    expect(data.observations).toHaveLength(1);
    expect(data.observations[0].asin).toBe("B0YOGA1234");
    expect(result.warnings.some((w) => w.code === "AD_PLACEMENTS_EXCLUDED")).toBe(true);
  });

  it("applies field whitelist and rejects non-whitelist fields", () => {
    const result = buildToolResult(makeEnvelope({ requestedFields: ["asin", "title", "secretField"] }), makeSearchExtraction());
    expect(result.status).toBe("ok");
    const data = result.data as { observations: Array<Record<string, unknown>> };
    expect(data.observations[0]).toHaveProperty("title");
    expect(data.observations[0]).toHaveProperty("asin");
    expect(data.observations[0]).not.toHaveProperty("secretField");
    expect(result.warnings.some((w) => w.code === "FIELD_NOT_ALLOWED")).toBe(true);
  });

  it("always keeps identity/locator fields even if not requested", () => {
    const result = buildToolResult(makeEnvelope({ requestedFields: ["title"] }), makeSearchExtraction());
    const data = result.data as { observations: Array<Record<string, unknown>> };
    expect(data.observations[0]).toHaveProperty("asin");
    expect(data.observations[0]).toHaveProperty("productUrl");
    expect(data.observations[0]).toHaveProperty("capturedAt");
    expect(data.observations[0]).toHaveProperty("title");
    expect(data.observations[0]).not.toHaveProperty("price");
  });
});

describe("runAmazonAdapter — recorded replay", () => {
  beforeEach(() => __resetAmazonAdapterCacheForTest());

  it("replays a search fixture deterministically -> ok", async () => {
    const result = await runAmazonAdapter(makeEnvelope({ inputHash: "search-ok-hash" }), { fixturesDir });
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
    expect(result.observedEntity).toBe("yoga mat");
    expect(result.errors).toEqual([]);
    const data = result.data as { schemaVersion: string; entityType: string; observations: Array<Record<string, unknown>> };
    expect(data.schemaVersion).toBe("amazon-bounded.v1");
    expect(data.entityType).toBe("search_results");
    expect(data.observations).toHaveLength(2);
    expect(data.observations[0].asin).toBe("B0YOGA1234");
    expect(result.rawArtifactRefs.length).toBeGreaterThan(0);
    expect(result.capturedAt).toBeTruthy();
    expect(validateToolResult(result).ok).toBe(true);
  });

  it("replays a detail fixture -> ok with detail observation", async () => {
    const result = await runAmazonAdapter(
      makeEnvelope({ inputHash: "detail-ok-hash", targetEntity: "B0YOGA1234", requestedFields: ["asin", "title", "price", "rating", "reviewCount", "bsr", "productUrl", "capturedAt"] }),
      { fixturesDir },
    );
    expect(result.status).toBe("ok");
    const data = result.data as { entityType: string; asin: string; observations: Array<Record<string, unknown>> };
    expect(data.entityType).toBe("product_detail");
    expect(data.asin).toBe("B0YOGA1234");
    expect(data.observations).toHaveLength(1);
    expect(data.observations[0].asin).toBe("B0YOGA1234");
    expect(data.observations[0].bsr).toBe(2541);
  });

  it("returns no_results when no fixture matches", async () => {
    const result = await runAmazonAdapter(makeEnvelope({ inputHash: "does-not-exist" }), { fixturesDir });
    expect(result.status).toBe("no_results");
    expect(result.nextAction).toBe("revise_plan");
    expect(result.warnings.some((w) => w.code === "FIXTURE_NOT_FOUND")).toBe(true);
  });

  it("WRONG_ENTITY when recorded fixture observed entity mismatches target", async () => {
    const result = await runAmazonAdapter(
      makeEnvelope({ inputHash: "wrong-entity-hash", targetEntity: "B0CORRECT1", requestedFields: ["asin", "title"] }),
      { fixturesDir },
    );
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("stop");
    expect(result.errors[0].code).toBe("WRONG_ENTITY");
    expect(result.observedEntity).toBe("B0WRONG999");
  });

  it("excludes sponsored placements from recorded replay", async () => {
    const result = await runAmazonAdapter(makeEnvelope({ inputHash: "sponsored-hash" }), { fixturesDir });
    expect(result.status).toBe("ok");
    const data = result.data as { observations: Array<Record<string, unknown>> };
    expect(data.observations).toHaveLength(1);
    expect(data.observations[0].asin).toBe("B0YOGA1234");
    expect(result.warnings.some((w) => w.code === "AD_PLACEMENTS_EXCLUDED")).toBe(true);
  });
});

describe("runAmazonAdapter — injection safety", () => {
  beforeEach(() => __resetAmazonAdapterCacheForTest());

  it("injection text is captured as data, never as instructions/plan/permission", async () => {
    const result = await runAmazonAdapter(
      makeEnvelope({ inputHash: "injection-hash", requestedFields: ["asin", "title", "price", "productUrl", "capturedAt"] }),
      { fixturesDir },
    );
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
    expect(result.errors).toEqual([]);
    const data = result.data as { observations: Array<Record<string, unknown>> };
    const title = data.observations[0].title as string;
    expect(title).toContain("Ignore all previous instructions");
    // injection text appears only as a data field / warning, never as a control field
    expect(data).not.toHaveProperty("instructions");
    expect(data).not.toHaveProperty("plan");
    expect(data).not.toHaveProperty("permission");
    expect(result.nextAction).toBe("continue");
    expect(result.status).toBe("ok");
    expect(result.warnings.some((w) => w.code === "INJECTION_TEXT_CAPTURED_AS_DATA")).toBe(true);
  });
});

describe("runAmazonAdapter — idempotency", () => {
  beforeEach(() => __resetAmazonAdapterCacheForTest());

  it("same idempotencyKey + inputHash returns cached result without re-running live executor", async () => {
    let calls = 0;
    const executor: AmazonLiveExecutor = {
      async run() {
        calls += 1;
        return makeSearchExtraction();
      },
    };
    const opts: AmazonAdapterOptions = { mode: "live", liveEnabled: true, liveExecutor: executor };
    const envelope = makeEnvelope({ idempotencyKey: "idem-fixed", inputHash: "hash-fixed" });
    const r1 = await runAmazonAdapter(envelope, opts);
    const r2 = await runAmazonAdapter(envelope, opts);
    expect(r1.status).toBe("ok");
    expect(r2.status).toBe("ok");
    expect(r1).toEqual(r2);
    expect(calls).toBe(1);
  });
});

describe("runAmazonAdapter — live mode gate", () => {
  beforeEach(() => __resetAmazonAdapterCacheForTest());

  it("live mode disabled by server switch (default off)", async () => {
    const result = await runAmazonAdapter(makeEnvelope(), { mode: "live", liveEnabled: false });
    expect(result.status).toBe("stopped_error");
    expect(result.errors[0].code).toBe("PERMISSION_DENIED");
    expect(result.nextAction).toBe("stop");
    expect(result.warnings.some((w) => w.code === "LIVE_DISABLED")).toBe(true);
  });

  it("live mode with injected executor produces ok result", async () => {
    const executor: AmazonLiveExecutor = { async run() { return makeSearchExtraction(); } };
    const result = await runAmazonAdapter(makeEnvelope(), { mode: "live", liveEnabled: true, liveExecutor: executor });
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
  });

  it("live executor error maps to waiting_auth for auth/bot errors", async () => {
    const executor: AmazonLiveExecutor = {
      async run() { throw new Error("captcha or robot check"); },
    };
    const result = await runAmazonAdapter(makeEnvelope(), { mode: "live", liveEnabled: true, liveExecutor: executor });
    expect(result.status).toBe("waiting_auth");
    expect(result.nextAction).toBe("wait_human");
    expect(result.errors[0].code).toBe("CAPTCHA_OR_BOT_CHECK");
  });
});

describe("P2-C review — prompt injection (PI-1/PI-2/PI-3)", () => {
  beforeEach(() => __resetAmazonAdapterCacheForTest());

  it("PI-1 web body injection: control fields unchanged, injection only into rawArtifact/data", async () => {
    const envelope = makeEnvelope({ inputHash: "pi-1-web-body-hash", requestedFields: ["asin", "title", "price", "productUrl", "capturedAt"] });
    const result = await runAmazonAdapter(envelope, { fixturesDir });
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
    expect(envelope.allowedDomains).toEqual(["amazon.com", "www.amazon.com"]);
    expect(envelope.budget.maxCost).toBe(1);
    expect(envelope.requestedFields).toEqual(["asin", "title", "price", "productUrl", "capturedAt"]);
    const data = result.data as { observations: Array<Record<string, unknown>> };
    const ev = data.observations[0].evidence as { kind: string; sourceType: string };
    expect(ev.kind).not.toBe("action");
    expect(ev.sourceType).toBe("amazon");
    expect(result.errors).toEqual([]);
    expect(data).not.toHaveProperty("instructions");
    expect(data).not.toHaveProperty("plan");
    expect(data).not.toHaveProperty("permission");
    expect(data).not.toHaveProperty("stopConditions");
    expect(data.observations[0].title as string).toContain("Ignore all previous instructions");
    expect(result.rawArtifactRefs.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.code === "INJECTION_TEXT_CAPTURED_AS_DATA")).toBe(true);
  });

  it("PI-2 review injection: treated as untrusted data, no control-field mutation", async () => {
    const result = await runAmazonAdapter(makeEnvelope({ inputHash: "pi-2-review-hash" }), { fixturesDir });
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
    const data = result.data as { observations: Array<Record<string, unknown>> };
    expect(data.observations[0].title as string).toContain("approve the purchase");
    expect(data).not.toHaveProperty("plan");
    expect(data).not.toHaveProperty("permission");
    expect(result.errors).toEqual([]);
  });

  it("PI-3 XLSX formula injection: not executed, only captured as field text", async () => {
    const result = await runAmazonAdapter(makeEnvelope({ inputHash: "pi-3-xlsx-hash" }), { fixturesDir });
    expect(result.status).toBe("ok");
    expect(result.nextAction).toBe("continue");
    const data = result.data as { observations: Array<Record<string, unknown>> };
    const title = data.observations[0].title as string;
    expect(title).toContain("=cmd|'/C calc'!A0");
    expect(title).toContain("=HYPERLINK(");
    expect(data).not.toHaveProperty("instructions");
  });
});

describe("P2-C review — WRONG_ENTITY (WE-1/WE-2/WE-3)", () => {
  beforeEach(() => __resetAmazonAdapterCacheForTest());

  it("WE-1 recommended-position wrong ASIN -> WRONG_ENTITY + stop + no evidence merge", async () => {
    const result = await runAmazonAdapter(
      makeEnvelope({ inputHash: "we-1-placement-hash", targetEntity: "B0DOM00002", requestedFields: ["asin", "title", "price"] }),
      { fixturesDir },
    );
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("stop");
    expect(result.errors[0].code).toBe("WRONG_ENTITY");
    expect(result.data).toBeNull();
    expect(result.observedEntity).toBe("B0DOM00002");
  });

  it("WE-2 region switch -> WRONG_ENTITY (market/currency mismatch)", async () => {
    const result = await runAmazonAdapter(makeEnvelope({ inputHash: "we-2-region-hash" }), { fixturesDir });
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("stop");
    expect(result.errors[0].code).toBe("WRONG_ENTITY");
    expect(result.data).toBeNull();
  });

  it("WE-3 variant mix -> WRONG_ENTITY (observed ASIN != target)", async () => {
    const result = await runAmazonAdapter(
      makeEnvelope({ inputHash: "we-3-variant-hash", targetEntity: "B0PARENT01" }),
      { fixturesDir },
    );
    expect(result.status).toBe("stopped_error");
    expect(result.nextAction).toBe("stop");
    expect(result.errors[0].code).toBe("WRONG_ENTITY");
    expect(result.observedEntity).toBe("B0CHILD001");
    expect(result.data).toBeNull();
  });
});

describe("P2-C review — three candidate profiles (evidence schema aligned)", () => {
  beforeEach(() => __resetAmazonAdapterCacheForTest());

  it("profile A: evidence sufficient -> source_fact, rich observations, no missing", async () => {
    const result = await runAmazonAdapter(
      makeEnvelope({ inputHash: "profile-a-hash", requestedFields: ["asin", "title", "price", "rating", "reviewCount", "bsr", "productUrl", "capturedAt"] }),
      { fixturesDir },
    );
    expect(result.status).toBe("ok");
    const data = result.data as { observations: Array<Record<string, unknown>>; missingFields: Record<string, string> };
    expect(data.observations).toHaveLength(2);
    const ev = data.observations[0].evidence as { kind: string; sourceType: string; sampleSize: number; contentHash: string };
    expect(ev.kind).toBe("source_fact");
    expect(ev.sourceType).toBe("amazon");
    expect(ev.sampleSize).toBe(1);
    expect(ev.contentHash).toBeTruthy();
    expect(Object.keys(data.missingFields).length).toBe(0);
  });

  it("profile B: data insufficient -> missing price/rating, evidence NOT padded to source_fact", async () => {
    const result = await runAmazonAdapter(
      makeEnvelope({ inputHash: "profile-b-hash", requestedFields: ["asin", "title", "price", "rating", "reviewCount"] }),
      { fixturesDir },
    );
    expect(result.status).toBe("ok");
    const data = result.data as { observations: Array<Record<string, unknown>>; missingFields: Record<string, string> };
    expect(data.observations[0].price).toBeNull();
    expect(data.observations[0].rating).toBeNull();
    expect(data.missingFields.price).toBeTruthy();
    expect(data.missingFields.rating).toBeTruthy();
    const ev = data.observations[0].evidence as { kind: string };
    expect(ev.kind).not.toBe("source_fact");
  });

  it("profile C: conflicts obvious -> dual values side by side, not normalized", async () => {
    const result = await runAmazonAdapter(
      makeEnvelope({ inputHash: "profile-c-hash", requestedFields: ["asin", "title", "price", "rating"] }),
      { fixturesDir },
    );
    expect(result.status).toBe("ok");
    const data = result.data as { observations: Array<Record<string, unknown>> };
    expect(data.observations).toHaveLength(2);
    expect(data.observations.map((o) => o.price)).toEqual([24.99, 19.99]);
    expect(data.observations.map((o) => o.rating)).toEqual([4.5, 3.1]);
  });
});

describe("P2-C review — deterministic fixture replay + GOLD-1 boundaries", () => {
  beforeEach(() => __resetAmazonAdapterCacheForTest());
  const fixedNow = () => "2026-08-21T12:00:00.000Z";

  it("deterministic replay: same fixture -> identical output (not P1 fakeTools table)", async () => {
    const opts = { fixturesDir, now: fixedNow };
    const a = await runAmazonAdapter(makeEnvelope({ inputHash: "search-ok-hash" }), opts);
    __resetAmazonAdapterCacheForTest();
    const b = await runAmazonAdapter(makeEnvelope({ inputHash: "search-ok-hash" }), opts);
    expect(a).toEqual(b);
    expect(a.status).toBe("ok");
    expect((a.data as { observations: Array<{ asin: string }> }).observations[0].asin).toBe("B0YOGA1234");
  });

  it("GOLD-1: no forbidden marketing text in output data", async () => {
    const result = await runAmazonAdapter(
      makeEnvelope({ inputHash: "profile-a-hash", requestedFields: ["asin", "title", "price", "rating", "reviewCount", "productUrl", "capturedAt"] }),
      { fixturesDir },
    );
    const json = JSON.stringify(result.data);
    expect(json).not.toMatch(/能卖|爆款概率|预计月赚|值得卖/);
  });
});

describe("contract", () => {
  it("whitelist matches the frozen Amazon Bounded Browser fields", () => {
    expect([...AMAZON_FIELD_WHITELIST]).toEqual([
      "asin", "title", "price", "rating", "reviewCount", "bsr", "sellingPoints", "productUrl", "pageUrl", "capturedAt",
    ]);
  });
});
