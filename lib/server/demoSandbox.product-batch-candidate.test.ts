import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOrReuseSandboxProductBatchCandidate,
  getSandboxCandidate,
  type CreateSandboxProductBatchCandidateInput,
} from "@/lib/server/demoSandbox";
import type { ProductBatchCandidateSourceV1 } from "@/lib/server/productBatchCandidateSource";

const roots: string[] = [];

function source(itemId = "item-a"): ProductBatchCandidateSourceV1 {
  return {
    version: "product-batch-candidate-source.v1",
    originKind: "seller_sprite_product_batch",
    productBatchId: "batch-a",
    productBatchItemId: itemId,
    serverIdentityScope: "visitor:sandbox",
    productKey: "amazon:US:B000000001",
    productName: "Closet organizer",
    marketplace: "US",
    asin: "B000000001",
    parentAsin: null,
    reportType: "search_results",
    query: "organizer",
    category: "Home",
    manifestHash: "a".repeat(64),
    snapshotHash: "b".repeat(64),
    itemIdentityHash: "c".repeat(64),
    itemHash: "d".repeat(64),
    evidenceHash: "e".repeat(64),
    researchPriority: "priority_1",
    provisionalDisposition: "provisional_score_only",
    evidenceStatus: "sufficient_for_comparison",
    promotionEligible: false,
    sellerSpriteDisclaimerVersion: "v1",
    imageSnapshot: { status: "not_cached" },
    productFacts: { productTitle: "Closet organizer", price: 29.99 },
    capturedAt: "2026-07-28T00:00:00.000Z",
  };
}

function input(itemId = "item-a"): CreateSandboxProductBatchCandidateInput {
  const candidateSource = source(itemId);
  return {
    name: candidateSource.productName,
    rawInput: candidateSource.productName,
    link: null,
    score: 0,
    source: "SellerSprite ProductBatch",
    keyword: candidateSource.query ?? candidateSource.category ?? "",
    riskLevel: "unknown",
    riskLabel: "需人工核验",
    summaryLabel: "SellerSprite市场研究候选",
    status: "worth_analyzing",
    sourceMetaJson: JSON.stringify(candidateSource),
    analysisJson: JSON.stringify({
      version: "product_batch_research_entry.v1",
      originKind: "seller_sprite_product_batch",
      researchMode: "market_research_only",
      promotionEligible: false,
      evidenceHash: candidateSource.evidenceHash,
      itemHash: candidateSource.itemHash,
    }),
    originProductBatchItemId: itemId,
  };
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "demo-sandbox-product-batch-"));
  roots.push(root);
  vi.stubEnv("DEMO_SANDBOX_STORE_PATH", join(root, "sandbox.json"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Visitor ProductBatch Candidate storage", () => {
  it("creates once per Visitor and productBatchItemId under concurrent calls", async () => {
    const [first, second] = await Promise.all([
      createOrReuseSandboxProductBatchCandidate("visitor-a", input()),
      createOrReuseSandboxProductBatchCandidate("visitor-a", input()),
    ]);

    expect(first.candidate.id).toBe(second.candidate.id);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(first.candidate.originProductBatchItemId).toBe("item-a");
    expect(getSandboxCandidate("visitor-a", first.candidate.id)?.convertedTaskId).toBeNull();

    const path = process.env.DEMO_SANDBOX_STORE_PATH!;
    expect(JSON.parse(readFileSync(path, "utf8")).candidates).toHaveLength(1);
    expect(readdirSync(join(path, "..")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(existsSync(`${path}.backup`)).toBe(false);
  });

  it("keeps identical item ids isolated between Visitor A and Visitor B", async () => {
    const a = await createOrReuseSandboxProductBatchCandidate("visitor-a", input());
    const b = await createOrReuseSandboxProductBatchCandidate("visitor-b", input());

    expect(a.candidate.id).not.toBe(b.candidate.id);
    expect(getSandboxCandidate("visitor-a", b.candidate.id)).toBeNull();
    expect(getSandboxCandidate("visitor-b", a.candidate.id)).toBeNull();
  });

  it("fails closed when an existing item relation carries different immutable hashes", async () => {
    await createOrReuseSandboxProductBatchCandidate("visitor-a", input());
    const changed = input();
    changed.sourceMetaJson = JSON.stringify({
      ...source(),
      itemHash: "f".repeat(64),
    });
    changed.analysisJson = JSON.stringify({
      version: "product_batch_research_entry.v1",
      originKind: "seller_sprite_product_batch",
      researchMode: "market_research_only",
      promotionEligible: false,
      evidenceHash: "e".repeat(64),
      itemHash: "f".repeat(64),
    });

    await expect(
      createOrReuseSandboxProductBatchCandidate("visitor-a", changed),
    ).rejects.toMatchObject({ code: "product_batch_candidate_source_conflict" });

    const changedContext = input();
    changedContext.sourceMetaJson = JSON.stringify({
      ...source(),
      query: "changed-query",
    });
    await expect(
      createOrReuseSandboxProductBatchCandidate("visitor-a", changedContext),
    ).rejects.toMatchObject({ code: "product_batch_candidate_source_conflict" });
  });
});
