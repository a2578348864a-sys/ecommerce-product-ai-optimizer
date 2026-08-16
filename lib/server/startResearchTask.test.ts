/**
 * V3 Final Product Integration — F1 Start Research（create/get Research Task）测试
 *
 * 覆盖：创建骨架任务（身份继承 productUrl）、幂等（已转返回既有）、
 * 候选不可研究拒绝、主体隔离、骨架 resultJson 无 researchRecord。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSandboxCandidate,
  getSandboxTask,
} from "@/lib/server/demoSandbox";
import { createOrGetResearchTask } from "@/lib/server/startResearchTask";

const NOW = "2026-08-16T00:00:00.000Z";
const DEMO_A = "demo-access-a";
const DEMO_B = "demo-access-b";

function demoContext(access: string) {
  return {
    mode: "demo" as const,
    token: "tok-demo",
    demoAccessId: access,
    isActive: true,
    isExpired: false,
    remainingAiCalls: 10,
  };
}

const SELLER_SPRITE_META = JSON.stringify({
  schema: "sellersprite_candidate_source_v1",
  source: { provider: "SellerSprite", type: "sellersprite_xlsx", marketplace: "Amazon US", reportType: "SellerSprite Search Results", capturedAt: null, importedAt: NOW, sourceFileSha256: "a".repeat(64), rowHash: "b".repeat(64) },
  identity: { asin: "B0TEST0001", parentAsin: null, productUrl: "https://www.amazon.com/dp/B0TEST0001" },
  snapshot: { title: "Test Bottle", imageUrl: null, priceUsd: 19.99, rating: 4.2, reviewCount: 123, brand: "TB", category: "Kitchen" },
  estimates: { searchRank: null, estimatedMonthlySales: null, estimatedMonthlyRevenueUsd: null, disclaimer: "third_party_estimate_point_in_time" },
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "start-research-"));
  process.env.DEMO_SANDBOX_STORE_PATH = join(root, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(root, "demo-access.json");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function seedCandidate(access: string, overrides: Record<string, unknown> = {}) {
  return createSandboxCandidate(access, {
    name: "Test Bottle",
    rawInput: "Test Bottle",
    link: "https://www.amazon.com/dp/B0TEST0001",
    score: 60,
    source: "SellerSprite",
    riskLevel: "low",
    riskLabel: "低",
    status: "pending",
    sourceMetaJson: SELLER_SPRITE_META,
    ...overrides,
  } as never);
}

describe("createOrGetResearchTask (F1)", () => {
  it("creates a research skeleton task with inherited productUrl and no researchRecord", async () => {
    const candidate = await seedCandidate(DEMO_A);
    const result = await createOrGetResearchTask(demoContext(DEMO_A), candidate.id);
    expect(result.mode).toBe("created");
    const task = getSandboxTask(DEMO_A, result.taskId);
    expect(task).not.toBeNull();
    expect(task!.productUrl).toBe("https://www.amazon.com/dp/B0TEST0001");
    expect(task!.decisionStatus).toBe("pending");
    const resultJson = JSON.parse(task!.resultJson) as Record<string, unknown>;
    expect(resultJson.candidateToTask).toMatchObject({ candidateId: candidate.id, confirmation: "research_started" });
    expect(resultJson.candidateAnalysisContext).toBeTruthy();
    expect(resultJson.researchRecord).toBeUndefined();
  });

  it("is idempotent: existing converted candidate returns the same taskId", async () => {
    const candidate = await seedCandidate(DEMO_A);
    const first = await createOrGetResearchTask(demoContext(DEMO_A), candidate.id);
    const second = await createOrGetResearchTask(demoContext(DEMO_A), candidate.id);
    expect(second.mode).toBe("existing");
    expect(second.taskId).toBe(first.taskId);
  });

  it("rejects candidates that are not research-eligible", async () => {
    const candidate = await seedCandidate(DEMO_A, { status: "rejected" });
    await expect(createOrGetResearchTask(demoContext(DEMO_A), candidate.id))
      .rejects.toMatchObject({ code: "candidate_not_ready", status: 409 });
  });

  it("isolates subjects: demo B cannot start research on demo A candidate", async () => {
    const candidate = await seedCandidate(DEMO_A);
    await expect(createOrGetResearchTask(demoContext(DEMO_B), candidate.id))
      .rejects.toMatchObject({ code: "candidate_not_found", status: 404 });
  });
});
