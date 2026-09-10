/**
 * 本地开发/验证种子：构造一个可用于 Listing V5 真实生成的沙盒任务。
 *
 * 默认跳过（需要真实写本地数据时显式开启）：
 *   SEED_LISTING_V5_TASK=1 npx vitest run scripts/seed-listing-v5-demo-task.seed.test.ts
 *
 * 只写入本地 gitignored 的开发数据文件：
 *   data/demo-access.json    （访客访问凭据）
 *   data/demo-sandbox.json   （沙盒任务，不触碰 Prisma 库）
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDemoAccess } from "@/lib/server/demoAccess";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import {
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
  PRODUCT_RESEARCH_HASH_SCHEMA,
} from "@/lib/productResearchRecord";

const NOW = "2026-08-10T00:00:00.000Z";
const YETI_DETAIL = "Brand: YETI | Material: Stainless Steel | Bottle Type: Insulated Bottle | Color: Mist/Pink/Grasshopper | Capacity: 12 ounces";
const YETI_SKU = "Color: Mist/Pink/Grasshopper";
const YETI_SELLING = "YETI kids need a bottle that can keep up. Introducing Rambler Jr. - a small-and-mighty kids bottle over-engineered for your little wild ones\nDishwasher Safe - As a well-deserved convenience, we ensure the bottle and lid are dishwasher safe.\n18/8 stainless steel - built to take all dents and drops, and BPA-free.\nNo sweat design - keeps hands dry.";

describe("Listing V5 demo task seed", () => {
  it.runIf(process.env.SEED_LISTING_V5_TASK === "1")("seeds a sandbox task with a confirmed creative handoff", async () => {
    // vitest 下 NODE_ENV=test，默认存储会落到 .next/test-stores；
    // 显式指向 data/ 下与 dev server 相同的文件，保证种子数据可被浏览器会话读到。
    process.env.DEMO_SANDBOX_STORE_PATH = join(process.cwd(), "data", "demo-sandbox.json");
    process.env.DEMO_ACCESS_STORE_PATH = join(process.cwd(), "data", "demo-access.json");

    const created = createDemoAccess({
      label: "listing-v5-trace",
      maxAiCalls: 50,
      notes: "Local seed for Listing V5 AI execution trace verification.",
    });
    const demoAccessId = created.record.id;

    const verification = createProductResearchVerification({
      schema: PRODUCT_RESEARCH_HASH_SCHEMA,
      candidateId: "candidate-v5-trace",
      runId: "run-v5-trace",
      contextHash: "a".repeat(64),
      inputHash: "b".repeat(64),
      resultHash: "c".repeat(64),
      workflowStatus: "completed",
      reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true, reviewedCount: 4, totalReviewSteps: 4, allReviewed: true },
    });
    const researchRecord = createInitialProductResearchRecord({
      candidateId: verification.candidateId,
      runId: verification.runId,
      contextHash: verification.contextHash,
      researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
      workflowStatus: verification.workflowStatus,
      reviewState: verification.reviewState,
      actor: { mode: "visitor", actorRef: `visitor:${"f".repeat(16)}` },
      now: NOW,
      decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "ok", nextAction: null },
    });

    const resultJson = JSON.stringify({
      type: "workflow",
      researchRecord,
      researchVerification: verification,
      researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: "2026-08-05T00:00:00.000Z", decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready" },
      candidateAnalysisContext: {
        candidateId: "candidate-v5-trace",
        productName: "YETI Rambler Jr. 12 oz Kids Bottle, with Straw Cap",
        sourceType: "seller_sprite_market_research",
        sourceLabel: "SellerSprite",
        marketplace: "US",
        asin: "B0GZRLKJT8",
        productUrl: "https://www.amazon.com/dp/B0GZRLKJT8?psc=1",
        title: "YETI Rambler Jr. 12 oz Kids Bottle, with Straw Cap",
        brand: "YETI",
        category: "Sports & Outdoors",
        priceUsd: 29.99,
        rating: 4.8,
        reviewCount: 1000,
        disclaimer: "third_party_estimate_point_in_time",
        reportType: "SellerSprite Search Results",
        query: "kids bottle",
        evidenceStatus: "ok",
        researchPriority: "high",
        promotionEligible: false,
        capturedAt: NOW,
        contextHash: "a".repeat(64),
        sellerSpriteSourceRaw: { detailAttributes: YETI_DETAIL, sku: YETI_SKU, sellingPoints: YETI_SELLING },
      },
      agentOutputSnapshot: {
        version: "agent-output-v1",
        generatedAt: NOW,
        sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" },
        riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false },
        summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "c", sellingPoints: ["L"], concerns: [], confidence: "medium" },
        listingSnapshot: { titleDraft: "T", bulletDrafts: ["E"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] },
        nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" },
        humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" },
        fallbackUsed: false,
        warnings: [],
      },
      keywordEvidence: {
        schema: "keyword-evidence.v1",
        version: 1,
        reportType: "keyword_mining",
        rows: [
          { rowNumber: 1, keyword: "kids water bottle", keywordTranslation: "儿童水杯", fields: { searchVolume: { raw: "12000", normalized: 12000, metricNature: "estimate", applicability: "available" } } },
          { rowNumber: 2, keyword: "insulated bottle", keywordTranslation: "保温瓶", fields: { searchVolume: { raw: "9800", normalized: 9800, metricNature: "estimate", applicability: "available" } } },
          { rowNumber: 3, keyword: "straw cap bottle", keywordTranslation: "吸管瓶", fields: { searchVolume: { raw: "6400", normalized: 6400, metricNature: "estimate", applicability: "available" } } },
        ],
        updatedAt: NOW,
      },
    });

    const taskId = "sandbox_task_v5_trace";
    writeFileSync(join(process.cwd(), "data", "demo-sandbox.json"), JSON.stringify({
      version: 1,
      tasks: [{
        id: taskId,
        demoAccessId,
        type: "workflow",
        title: "YETI Rambler Jr. 12 oz Kids Bottle",
        decisionStatus: "continue",
        platform: "amazon",
        productUrl: null,
        materialText: "m",
        source: "demo",
        score: 1,
        level: "low",
        oneLineSummary: "o",
        resultJson,
        productLifecycle: "i",
        createdAt: NOW,
        updatedAt: NOW,
      }],
      candidates: [],
    }), "utf8");

    const visitor = { mode: "demo" as const, token: "seed", demoAccessId, isActive: true, isExpired: false, remainingAiCalls: 50 };
    const preview = await generateCreativeHandoffPreview(taskId, visitor as never);
    const { getSandboxTask } = await import("@/lib/server/demoSandbox");
    const { getProductResearchRecord, getProductResearchVerification } = await import("@/lib/productResearchRecord");
    const sbTask = getSandboxTask(demoAccessId, taskId) as unknown as Record<string, unknown> | null;
    const sbParsed = sbTask ? JSON.parse(String(sbTask.resultJson)) : null;
    if (!preview.preview) console.log("GATE DEBUG", JSON.stringify({
      reason: preview.gate.reason,
      sandboxFound: Boolean(sbTask),
      hasResearch: sbParsed ? Boolean(getProductResearchRecord(sbParsed)) : null,
      hasVerification: sbParsed ? Boolean(getProductResearchVerification(sbParsed)) : null,
      recordSchema: sbParsed?.researchRecord?.schema ?? null,
    }, null, 2));
    if (!preview.preview) console.log("GATE DEBUG", JSON.stringify({ allowed: preview.gate.allowed, reason: preview.gate.reason, hasCandidate: Boolean(preview.gate.candidate), hasHandoff: Boolean(preview.gate.currentHandoff) }, null, 2));
    expect(preview.preview).toBeTruthy();
    expect(preview.gate.candidate).toBeTruthy();

    const confirmables = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts);
    const eligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    const pick = (field: string) => eligible.find((c) => c.field === field);
    const selected = [pick("brand"), pick("product_type"), pick("material"), pick("color_or_variant"), pick("capacity")].filter((c): c is NonNullable<typeof c> => Boolean(c));
    const selectedIds = selected.map((c) => preview.preview!.confirmableFactCandidates!.find((pc) => pc.canonicalField === c.field && String(pc.displayValue) === String(c.value))!.selectionId);
    const manualConfirmedFacts = [{ field: "care" as const, value: "dishwasher-safe bottle and lid" }];
    const fingerprint = buildRequestFingerprint({
      action: "create",
      selectedFactIds: selectedIds,
      manualConfirmedFacts,
      expectedStorageVersion: preview.preview!.storageVersion!,
      expectedResearchRevision: preview.preview!.expectedResearchRevision,
      expectedCurrentHandoffRevision: preview.preview!.expectedCurrentHandoffRevision ?? 0,
      confirmed: true,
    });
    await createOrAppendCreativeHandoff(taskId, visitor as never, {
      requestId: "550e8400-e29b-41d4-a716-446655441500",
      expectedResearchRevision: preview.preview!.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview.preview!.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: preview.preview!.storageVersion!,
      selectedFactCandidateIds: selectedIds,
      manualConfirmedFacts,
      requestFingerprint: fingerprint,
    });

    const after = await generateCreativeHandoffPreview(taskId, visitor as never);
    const handoff = after.gate.currentHandoff;
    const lastVersion = handoff?.versions?.[handoff.versions.length - 1];
    const listingFacts = (lastVersion?.confirmedFacts ?? []).filter((fact) => fact.usageScopes.includes("listing"));
    expect(listingFacts.length).toBeGreaterThanOrEqual(3);

    console.log("=== Listing V5 demo task seeded ===");
    console.log(`taskId        : ${taskId}`);
    console.log(`demoAccessId  : ${demoAccessId}`);
    console.log(`password      : ${created.plainPassword}`);
    console.log(`gate.allowed  : ${after.gate.allowed} (${after.gate.reason})`);
    console.log(`listing facts : ${listingFacts.map((f) => `${f.field}=${f.value}`).join(", ")}`);
  }, 60_000);
});
