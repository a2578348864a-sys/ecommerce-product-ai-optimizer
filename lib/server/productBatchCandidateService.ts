import "server-only";

import { randomUUID } from "node:crypto";
import type { AccessContext } from "@/lib/server/accessPassword";
import { prisma } from "@/lib/server/db";
import {
  createOrReuseSandboxProductBatchCandidate,
  SandboxProductBatchCandidateError,
  type CreateSandboxProductBatchCandidateInput,
} from "@/lib/server/demoSandbox";
import {
  buildProductBatchCandidateAnalysis,
  buildProductBatchCandidateSource,
  parseProductBatchCandidateAnalysis,
  parseProductBatchCandidateSource,
  type ProductBatchCandidateSourceV1,
} from "@/lib/server/productBatchCandidateSource";
import { getProductBatchStore } from "@/lib/server/productBatchStoreResolver";

export type ProductBatchAgentRunSourceMetaV1 = {
  version: "product-batch-agent-run-source.v1";
  originKind: "seller_sprite_product_batch";
  productBatchId: string;
  productBatchItemId: string;
  productName: string;
  marketplace: string;
  asin: string | null;
  reportType: "search_results" | "category_current";
  query: string | null;
  category: string | null;
  researchPriority: string;
  evidenceStatus: string;
  evidenceHash: string;
  sellerSpriteDisclaimerVersion: string;
  capturedAt: string;
  researchMode: "market_research_only";
  promotionEligible: false;
};

export type ProductBatchCandidateConversionResult = {
  candidateId: string;
  created: boolean;
  destination: "research" | "history";
  destinationUrl: string;
  sourceMeta: ProductBatchAgentRunSourceMetaV1;
};

export class ProductBatchCandidateConversionError extends Error {
  constructor(
    public readonly code:
      | "product_batch_item_id_invalid"
      | "product_batch_selection_required"
      | "product_batch_not_ready"
      | "product_batch_item_not_found"
      | "product_batch_candidate_source_conflict"
      | "product_batch_candidate_not_researchable",
    message: string,
  ) {
    super(message);
    this.name = "ProductBatchCandidateConversionError";
  }
}

const PRODUCT_BATCH_ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type ExistingCandidate = {
  id: string;
  name: string;
  status: string;
  sourceMetaJson: string;
  analysisJson: string;
  convertedTaskId: string | null;
  originProductBatchItemId: string | null;
};

function fail(
  code: ProductBatchCandidateConversionError["code"],
  message: string,
): never {
  throw new ProductBatchCandidateConversionError(code, message);
}

function candidateInput(
  source: ProductBatchCandidateSourceV1,
): CreateSandboxProductBatchCandidateInput {
  return {
    name: source.productName,
    rawInput: source.productName,
    link: null,
    score: 0,
    source: "SellerSprite ProductBatch",
    keyword: source.query ?? source.category ?? source.asin ?? "",
    riskLevel: "unknown",
    riskLabel: "需人工核验",
    summaryLabel: "SellerSprite市场研究候选",
    status: "worth_analyzing",
    sourceMetaJson: JSON.stringify(source),
    analysisJson: JSON.stringify(buildProductBatchCandidateAnalysis(source)),
    originProductBatchItemId: source.productBatchItemId,
  };
}

function assertExistingCandidateMatches(
  existing: ExistingCandidate,
  source: ProductBatchCandidateSourceV1,
): void {
  const storedSource = parseProductBatchCandidateSource(existing.sourceMetaJson);
  const storedAnalysis = parseProductBatchCandidateAnalysis(existing.analysisJson);
  if (!storedSource
    || !storedAnalysis
    || existing.originProductBatchItemId !== source.productBatchItemId
    || existing.name !== source.productName
    || JSON.stringify(storedSource) !== JSON.stringify(source)
    || JSON.stringify(storedAnalysis) !== JSON.stringify(
      buildProductBatchCandidateAnalysis(source),
    )) {
    fail(
      "product_batch_candidate_source_conflict",
      "该商品已有 Candidate，但不可变来源与当前 ProductBatch 不一致。",
    );
  }
  if (!existing.convertedTaskId
    && existing.status !== "worth_analyzing"
    && existing.status !== "analyzed") {
    fail(
      "product_batch_candidate_not_researchable",
      "该 Candidate 当前状态不可研究。",
    );
  }
}

function handoffSource(source: ProductBatchCandidateSourceV1): ProductBatchAgentRunSourceMetaV1 {
  return {
    version: "product-batch-agent-run-source.v1",
    originKind: "seller_sprite_product_batch",
    productBatchId: source.productBatchId,
    productBatchItemId: source.productBatchItemId,
    productName: source.productName,
    marketplace: source.marketplace,
    asin: source.asin,
    reportType: source.reportType,
    query: source.query,
    category: source.category,
    researchPriority: source.researchPriority,
    evidenceStatus: source.evidenceStatus,
    evidenceHash: source.evidenceHash,
    sellerSpriteDisclaimerVersion: source.sellerSpriteDisclaimerVersion,
    capturedAt: source.capturedAt,
    researchMode: "market_research_only",
    promotionEligible: false,
  };
}

function conversionResult(
  candidate: Pick<ExistingCandidate, "id" | "convertedTaskId">,
  created: boolean,
  source: ProductBatchCandidateSourceV1,
): ProductBatchCandidateConversionResult {
  const sourceMeta = handoffSource(source);
  if (candidate.convertedTaskId) {
    return {
      candidateId: candidate.id,
      created,
      destination: "history",
      destinationUrl: `/tasks/${encodeURIComponent(candidate.convertedTaskId)}`,
      sourceMeta,
    };
  }
  return {
    candidateId: candidate.id,
    created,
    destination: "research",
    destinationUrl: `/opportunity-candidates/${encodeURIComponent(candidate.id)}`,
    sourceMeta,
  };
}

async function createOrReuseOwnerCandidate(
  source: ProductBatchCandidateSourceV1,
): Promise<{ candidate: ExistingCandidate; created: boolean }> {
  const input = candidateInput(source);
  try {
    return await prisma.$transaction(async (tx) => {
      const existingRows = await tx.$queryRaw<ExistingCandidate[]>`
        SELECT
          "id",
          "name",
          "status",
          "sourceMetaJson",
          "analysisJson",
          "convertedTaskId",
          "originProductBatchItemId"
        FROM "OpportunityCandidate"
        WHERE "originProductBatchItemId" = ${source.productBatchItemId}
        LIMIT 2
      `;
      if (existingRows.length > 1) {
        fail(
          "product_batch_candidate_source_conflict",
          "ProductBatchItem 关联了多个 Candidate。",
        );
      }
      const existing = existingRows[0] ?? null;
      if (existing) {
        assertExistingCandidateMatches(existing, source);
        return { candidate: existing, created: false };
      }
      const id = randomUUID();
      const nowMs = Date.now();
      await tx.$executeRaw`
        INSERT INTO "OpportunityCandidate" (
          "id",
          "name",
          "rawInput",
          "link",
          "score",
          "source",
          "keyword",
          "riskLevel",
          "riskLabel",
          "summaryLabel",
          "status",
          "sourceMetaJson",
          "analysisJson",
          "convertedTaskId",
          "originProductBatchItemId",
          "createdAt",
          "updatedAt",
          "lastActionAt"
        ) VALUES (
          ${id},
          ${input.name},
          ${input.rawInput},
          ${input.link},
          ${input.score},
          ${input.source},
          ${input.keyword},
          ${input.riskLevel},
          ${input.riskLabel},
          ${input.summaryLabel},
          ${input.status},
          ${input.sourceMetaJson},
          ${input.analysisJson},
          ${null},
          ${input.originProductBatchItemId},
          ${nowMs},
          ${nowMs},
          ${null}
        )
      `;
      const created: ExistingCandidate = {
        id,
        name: input.name,
        status: input.status,
        sourceMetaJson: input.sourceMetaJson,
        analysisJson: input.analysisJson,
        convertedTaskId: null,
        originProductBatchItemId: input.originProductBatchItemId,
      };
      return { candidate: created, created: true };
    });
  } catch (error) {
    const rows = await prisma.$queryRaw<ExistingCandidate[]>`
      SELECT
        "id",
        "name",
        "status",
        "sourceMetaJson",
        "analysisJson",
        "convertedTaskId",
        "originProductBatchItemId"
      FROM "OpportunityCandidate"
      WHERE "originProductBatchItemId" = ${source.productBatchItemId}
      LIMIT 2
    `;
    const existing = rows.length === 1 ? rows[0] : null;
    if (!existing) throw error;
    assertExistingCandidateMatches(existing, source);
    return { candidate: existing, created: false };
  }
}

export async function convertProductBatchItemToCandidate(
  context: AccessContext,
  productBatchItemId: string,
): Promise<ProductBatchCandidateConversionResult> {
  if (!PRODUCT_BATCH_ITEM_ID_PATTERN.test(productBatchItemId)) {
    fail("product_batch_item_id_invalid", "ProductBatchItem 标识无效。");
  }
  const store = getProductBatchStore(context);
  const selection = await store.getSelection();
  if (!selection?.activeProductBatchId) {
    fail("product_batch_selection_required", "请先选择一个当前 ProductBatch。");
  }
  const batch = await store.getBatch(selection.activeProductBatchId);
  if (!batch
    || batch.batchStatus !== "ready"
    || (batch.dataQualityStatus !== "passed"
      && batch.dataQualityStatus !== "passed_with_quarantine")) {
    fail("product_batch_not_ready", "当前 ProductBatch 尚不可研究。");
  }
  const item = (await store.getBatchItems(batch.id)).find(
    (candidateItem) => candidateItem.id === productBatchItemId,
  );
  if (!item) {
    fail("product_batch_item_not_found", "商品不在当前 ProductBatch 中。");
  }
  let source: ProductBatchCandidateSourceV1;
  try {
    source = buildProductBatchCandidateSource({
      batch,
      item,
      serverIdentityScope: context.mode === "owner" ? "owner:v1" : "visitor:sandbox",
    });
  } catch {
    fail(
      "product_batch_candidate_not_researchable",
      "该商品的来源证据不完整或已损坏，不能进入研究。",
    );
  }

  if (context.mode === "owner") {
    const result = await createOrReuseOwnerCandidate(source);
    return conversionResult({
      id: result.candidate.id,
      convertedTaskId: result.candidate.convertedTaskId ?? null,
    }, result.created, source);
  }
  try {
    const result = await createOrReuseSandboxProductBatchCandidate(
      context.demoAccessId,
      candidateInput(source),
    );
    return conversionResult({
      id: result.candidate.id,
      convertedTaskId: result.candidate.convertedTaskId ?? null,
    }, result.created, source);
  } catch (error) {
    if (error instanceof SandboxProductBatchCandidateError) {
      fail("product_batch_candidate_source_conflict", error.message);
    }
    throw error;
  }
}
