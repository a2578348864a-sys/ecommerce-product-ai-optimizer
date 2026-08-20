// P1-DEMO-01 Golden Demo Refresh — Data Contract Tests
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GOLDEN_DEMO_TEMPLATE_RESULT_JSON as T } from "@/lib/server/goldenDemoTemplateData";
import { ensureVisitorDemoCopy } from "@/lib/server/goldenDemoTemplate";
import { listSandboxTasks } from "@/lib/server/demoSandbox";
import { buildListingReadiness } from "@/lib/listingHandoff/listingReadiness";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v3-gd-refresh");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || "file:" + join(dir, "unused.db").replaceAll("\\", "/");
});

beforeEach(() => {
  const dir = join(tmpdir(), "v3-gd-refresh");
  rmSync(join(dir, "sandbox.json"), { force: true });
});
afterEach(() => vi.restoreAllMocks());

function latestHandoff(rj: any) {
  const ch = rj.creativeHandoff;
  return ch.versions[ch.versions.length - 1];
}
async function freshCopyStats() {
  const visitorId = "refresh-visitor-" + Math.random().toString(36).slice(2, 8);
  const copy = await ensureVisitorDemoCopy(visitorId);
  const tasks = await listSandboxTasks(visitorId);
  const task = tasks.find((t: any) => t.id === copy?.taskId);
  const rj = JSON.parse(task?.resultJson ?? "{}");
  const latest = latestHandoff(rj);
  return {
    confirmed: latest.confirmedFacts,
    usable: latest.confirmedFacts.filter((f: any) => (f.usageScopes || []).includes("listing")),
    market: latest.confirmedFacts.filter((f: any) => !(f.usageScopes || []).includes("listing")),
    rj,
  };
}

describe("P1-DEMO-01 Golden Demo Refresh Data Contract", () => {
  it("GOLDEN_DEMO_PRODUCT_IDENTITY_LOCK: ASIN/title/marketplace bound + entityBinding + productInfo", () => {
    const cacFacts = (T.candidateAnalysisContext as any)?.facts ?? {};
    expect(cacFacts.asin).toBe("B0F2BF31PW");
    expect(cacFacts.marketplace).toBe("US");
    const snaps = (T.browserEvidence as any).snapshots as any[];
    expect(snaps.length).toBeGreaterThanOrEqual(2);
    for (const s of snaps) {
      expect(s.entityBinding.bound).toBe(true);
      expect(s.entityBinding.urlAsin).toBe("B0F2BF31PW");
      expect(s.entityBinding.pageAsin).toBe("B0F2BF31PW");
    }
    const recovery = snaps.find((s: any) => s.productInfo);
    expect(recovery).toBeDefined();
    expect(recovery.productInfo.schemaVersion).toBe("amazon-product-info-extraction.v1");
    expect(recovery.productInfo.canonicalFacts.material).toBe("Stainless Steel");
    expect(recovery.productInfo.canonicalFacts.capacity).toBe("12 ounces");
    expect(recovery.productInfo.canonicalFacts.operation).toBe("Flip Top Cap");
    expect(recovery.capturedAt).toBeTruthy();
  });

  it("ACCEPTED_FACT_PROJECTION: refreshed facts reach Fresh Visitor copy with listing scope", async () => {
    const { confirmed, usable, rj } = await freshCopyStats();
    const fields = confirmed.map((f: any) => f.field);
    for (const f of ["material", "dimensions", "weight", "color_or_variant", "quantity_or_pack_size", "care", "operation", "functional_feature"]) {
      expect(fields).toContain(f);
    }
    expect(confirmed.length).toBe(17);
    expect(usable.length).toBe(12);
    // provenance preserved
    const material = confirmed.find((f: any) => f.field === "material");
    expect(material.sourceRef.confirmationReference).toContain("amazon_product_info");
    expect(material.evidenceTier).toBe("human_confirmed");
    // new snapshot present in fresh copy
    expect((rj.browserEvidence.snapshots as any[]).some((s: any) => s.productInfo)).toBe(true);
  });

  it("REJECTED_INCLUDED_COMPONENT: kids water bottle never enters facts", async () => {
    const { confirmed } = await freshCopyStats();
    expect(confirmed.some((f: any) => f.field === "included_components")).toBe(false);
    expect(confirmed.some((f: any) => String(f.value).includes("kids water bottle"))).toBe(false);
  });

  it("SERIES_MODEL_SUPERSESSION: latest value updated, historical versions keep old value", async () => {
    const { confirmed, rj } = await freshCopyStats();
    const latest = latestHandoff(rj);
    expect(latest.confirmedFacts.find((f: any) => f.field === "series_or_model").value).toBe("FUNTAINER 12 Ounce Bottle");
    // historical versions preserve superseded provenance
    const v1 = rj.creativeHandoff.versions[0].confirmedFacts.find((f: any) => f.field === "series_or_model");
    expect(v1.value).toBe("FUNTAINER Water");
  });

  it("MARKET_OBSERVATION_NOT_LISTING: market fields stay internal only", async () => {
    const { market } = await freshCopyStats();
    const fields = market.map((f: any) => f.field);
    for (const f of ["category", "price_usd", "rating", "review_count", "bsr"]) {
      expect(fields).toContain(f);
      const item = market.find((x: any) => x.field === f);
      expect(item.usageScopes).toEqual(["internal"]);
    }
  });

  it("LISTING_READINESS + CLAIM_SAFETY: copyReady true, claimSafe true", async () => {
    const { confirmed } = await freshCopyStats();
    const usable = confirmed.filter((f: any) => (f.usageScopes || []).includes("listing"));
    const readiness = buildListingReadiness({
      confirmedFacts: confirmed,
      listingEligibleFacts: usable.length,
      hasBlockingIssue: false,
      keywordBrief: null,
    });
    expect(readiness.claimSafe).toBe(true);
    expect(readiness.copyReady).toBe(true);
    expect(readiness.counts.identity).toBeGreaterThanOrEqual(3);
    expect(readiness.counts.specification).toBeGreaterThanOrEqual(2);
    expect(readiness.counts.functional).toBeGreaterThanOrEqual(1);
  });

  it("NO_OTHER_VARIANT_POLLUTION + NO_FAKE_KEYWORDS", async () => {
    const { confirmed, rj } = await freshCopyStats();
    const values = confirmed.map((f: any) => String(f.value).toLowerCase()).join(" ");
    expect(values).not.toContain("food jar");
    expect(values).not.toContain("10oz");
    expect(values).not.toContain("pink");
    expect(rj.keywordEvidence).toBeUndefined();
    expect(rj.competitorEvidence).toBeUndefined();
  });
});
