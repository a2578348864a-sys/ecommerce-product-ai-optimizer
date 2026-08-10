/**
 * Research Context Adapter（V2 BLOCKER 修复）
 *
 * 背景：
 *   真实前端 save-task 写入 resultJson.candidateAnalysisContext 的是
 *   CandidateAnalysisContextV1（version/integrity/facts/assessment 格式）；
 *   Creative Handoff 链（preview gate / persistence / visualReferenceCandidates）
 *   从同一字段解析 CandidateResearchContext（sourceType/candidateId/contextHash
 *   /productImage 格式）——格式不匹配导致真实用户任务 Handoff 永远 404。
 *
 * 设计约束（不重做 Research / Handoff 模块，不放开 Gate）：
 *   1. 确定性：仅从任务内既有权威命名空间映射，无随机、无外部调用。
 *   2. fail-closed：输入不完整/不一致时返回 null，绝不伪造事实或身份。
 *   3. 不创建第二套研究模型：输出仍是 CandidateResearchContext（Handoff 既有合同），
 *      仅做格式适配。
 *   4. 身份绑定：contextHash 必须与 researchRecord.contextHash 一致（该 hash 由
 *      createCandidateAnalysisBindingHash 从候选生成，是研究分析的权威绑定）；
 *      candidateId 必须与 researchRecord.candidateId 一致。
 *   5. 图片：仅从 sourceMeta.candidateSnapshot.productImageSnapshot（任务自有、
 *      已验证快照）构造 productImage；无图片时返回 context（productImage 可选）。
 */

import { createHash } from "node:crypto";
import {
  parseCandidateResearchContext,
  type CandidateResearchContext,
} from "@/lib/candidateResearchContext";
import { getProductResearchRecord } from "@/lib/productResearchRecord";
import { parseProductImageSnapshot } from "@/lib/productResearchImage";
import {
  buildCandidateAnalysisContext,
  createCandidateAnalysisBindingHash,
  type CandidateAnalysisContextV1,
} from "@/lib/server/candidateAnalysisContext";

export type ResearchContextAdapterResult =
  | { ok: true; context: CandidateResearchContext }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function nullableBounded(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const text = bounded(value, maxLength);
  return text || null;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/**
 * 从任务 resultJson 确定性适配 CandidateResearchContext。
 * 输入：任务 resultJson（含 candidateAnalysisContext V1 + researchRecord + sourceMeta）。
 * 返回 ok=false 时不改变调用方语义（按原 fail-closed 404 处理）。
 */
export function adaptResearchContextForHandoff(
  resultJson: Record<string, unknown>,
): ResearchContextAdapterResult {
  const contextRaw = resultJson.candidateAnalysisContext;
  if (!isRecord(contextRaw)) {
    return { ok: false, reason: "candidate_analysis_context_missing" };
  }

  // 1) 若已是 Handoff 可消费格式：原样通过（不重复转换）
  const direct = parseCandidateResearchContext(contextRaw);
  if (direct) return { ok: true, context: direct };

  // 2) V1 格式适配
  if (contextRaw.version !== "candidate-analysis-context-v1") {
    return { ok: false, reason: "unsupported_context_format" };
  }
  const integrity = contextRaw.integrity;
  if (integrity !== "verified_seller_sprite" && integrity !== "verified_product_batch") {
    return { ok: false, reason: `unsupported_integrity:${String(integrity)}` };
  }

  const facts = isRecord(contextRaw.facts) ? contextRaw.facts : null;
  if (!facts) return { ok: false, reason: "context_facts_missing" };

  // 3) 权威绑定：researchRecord（candidateId + contextHash）
  const record = getProductResearchRecord(resultJson);
  if (!record) return { ok: false, reason: "research_record_missing" };
  const candidateId = bounded(record.candidateId, 120);
  const contextHash = typeof record.contextHash === "string" && /^[a-f0-9]{64}$/i.test(record.contextHash)
    ? record.contextHash.toLowerCase()
    : "";
  if (!candidateId || !contextHash) {
    return { ok: false, reason: "research_binding_incomplete" };
  }

  // 4) 候选身份快照（sourceMeta.candidateSnapshot）——商品名与图片快照
  const sourceMeta = isRecord(resultJson.sourceMeta) ? resultJson.sourceMeta : null;
  const candidateSnapshot = sourceMeta && isRecord(sourceMeta.candidateSnapshot)
    ? sourceMeta.candidateSnapshot
    : null;
  const productName = bounded(candidateSnapshot?.name, 120)
    || bounded(resultJson.productName, 120)
    || bounded(facts.productName, 120)
    || "";
  if (!productName) return { ok: false, reason: "product_name_missing" };

  const capturedAt = typeof facts.capturedAt === "string" && !Number.isNaN(Date.parse(facts.capturedAt))
    ? facts.capturedAt
    : "";
  if (!capturedAt) return { ok: false, reason: "captured_at_invalid" };

  // 5) 图片快照（任务自有已验证资源；无则省略 productImage——Handoff 合同允许可选）
  let productImage: CandidateResearchContext["productImage"] = undefined;
  const imageSnapshot = candidateSnapshot && isRecord(candidateSnapshot.productImageSnapshot)
    ? parseProductImageSnapshot(candidateSnapshot.productImageSnapshot)
    : null;
  if (imageSnapshot) {
    const mime = imageSnapshot.mimeType;
    if ((mime === "image/jpeg" || mime === "image/png")
      && typeof imageSnapshot.contentHash === "string"
      && /^[a-f0-9]{64}$/i.test(imageSnapshot.contentHash)
      && typeof imageSnapshot.dataUrl === "string"
      && imageSnapshot.dataUrl.length <= 2_800_000) {
      productImage = {
        dataUrl: imageSnapshot.dataUrl,
        mimeType: mime,
        contentHash: imageSnapshot.contentHash.toLowerCase(),
        provenance: "task_snapshot",
      };
    }
  }

  // 6) 按 integrity 分支映射字段（仅映射既有事实，不新增/伪造）
  if (integrity === "verified_seller_sprite") {
    const asin = bounded(facts.asin, 20);
    const title = bounded(facts.title, 240);
    const productUrl = bounded(facts.productUrl, 2048);
    if (!asin || !title || !productUrl) {
      return { ok: false, reason: "sellersprite_facts_incomplete" };
    }
    const context: CandidateResearchContext = {
      candidateId,
      productName,
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite 市场调查",
      marketplace: bounded(facts.marketplace, 40) || "Amazon US",
      reportType: "SellerSprite Search Results",
      asin,
      parentAsin: nullableBounded(facts.parentAsin, 20),
      productUrl,
      title,
      imageUrl: nullableBounded(facts.imageUrl, 2048),
      priceUsd: typeof facts.priceUsd === "number" ? facts.priceUsd : null,
      rating: typeof facts.rating === "number" ? facts.rating : null,
      reviewCount: typeof facts.reviewCount === "number" ? facts.reviewCount : null,
      brand: nullableBounded(facts.brand, 160),
      category: nullableBounded(facts.category, 240),
      searchRank: typeof facts.searchRank === "number" ? facts.searchRank : null,
      estimatedMonthlySales: typeof facts.estimatedMonthlySales === "number" ? facts.estimatedMonthlySales : null,
      estimatedMonthlyRevenueUsd: typeof facts.estimatedMonthlyRevenueUsd === "number" ? facts.estimatedMonthlyRevenueUsd : null,
      disclaimer: "third_party_estimate_point_in_time",
      evidenceStatus: "sellersprite_market_research",
      researchPriority: "人工研究",
      promotionEligible: false,
      capturedAt,
      contextHash,
      ...(facts.detailAttributes || facts.sku || facts.sellingPoints ? {
        sellerSpriteSourceRaw: {
          ...(facts.detailAttributes ? { detailAttributes: bounded(facts.detailAttributes, 4000) } : {}),
          ...(facts.sku ? { sku: bounded(facts.sku, 2000) } : {}),
          ...(facts.sellingPoints ? { sellingPoints: bounded(facts.sellingPoints, 8000) } : {}),
        },
      } : {}),
      ...(productImage ? { productImage } : {}),
    };
    return { ok: true, context };
  }

  if (integrity === "verified_product_batch") {
    const productBatchId = bounded(facts.productBatchId, 120);
    const productBatchItemId = bounded(facts.productBatchItemId, 120);
    const marketplace = bounded(facts.marketplace, 40);
    const reportType = facts.reportType;
    if (!productBatchId || !productBatchItemId || !marketplace
      || (reportType !== "search_results" && reportType !== "category_current")) {
      return { ok: false, reason: "product_batch_facts_incomplete" };
    }
    // ProductBatch 商品事实（facts.productFacts 嵌套对象）映射到标准研究上下文：
    // title/brand 用于标题派生候选（listing product_fact）；价格/评分/评论/销量为
    // market_signal，绝不升级为 Listing 事实（projection 侧按 factCategory 收敛）。
    const productFacts = isRecord(facts.productFacts) ? facts.productFacts : null;
    const context: CandidateResearchContext = {
      candidateId,
      productName,
      sourceType: "seller_sprite_product_batch",
      sourceLabel: "SellerSprite ProductBatch",
      productBatchName: bounded(resultJson.productBatchName, 160) || productBatchId,
      productBatchId,
      productBatchItemId,
      marketplace,
      asin: nullableBounded(facts.asin, 20),
      reportType,
      query: nullableBounded(facts.query, 240),
      title: productFacts
        ? (nullableBounded(productFacts.productTitle, 240) ?? undefined)
        : undefined,
      brand: productFacts
        ? nullableBounded(productFacts.brand, 160)
        : null,
      category: nullableBounded(
        productFacts ? productFacts.rootCategory : null,
        240,
      ) || nullableBounded(facts.category, 240) || null,
      priceUsd: productFacts && typeof productFacts.price === "number"
        ? productFacts.price
        : null,
      rating: productFacts && typeof productFacts.rating === "number"
        ? productFacts.rating
        : null,
      reviewCount: productFacts && typeof productFacts.reviews === "number"
        ? productFacts.reviews
        : null,
      estimatedMonthlySales: productFacts && typeof productFacts.estimatedMonthlySales === "number"
        ? productFacts.estimatedMonthlySales
        : null,
      estimatedMonthlyRevenueUsd: productFacts && typeof productFacts.estimatedMonthlyRevenue === "number"
        ? productFacts.estimatedMonthlyRevenue
        : null,
      evidenceStatus: bounded(facts.evidenceStatus, 120) || "sellersprite_product_batch",
      researchPriority: bounded(facts.researchPriority, 120) || "人工研究",
      promotionEligible: false,
      sellerSpriteDisclaimerVersion: bounded(facts.sellerSpriteDisclaimerVersion, 120),
      capturedAt,
      contextHash,
      ...(productImage ? { productImage } : {}),
    };
    return { ok: true, context };
  }

  return { ok: false, reason: "unsupported_integrity" };
}

/** 供 preview 展示使用：从 V1 上下文 + 候选重建 binding hash 的一致性校验（不修改存储） */
export function verifyResearchContextBinding(
  resultJson: Record<string, unknown>,
  candidateSourceMetaJson?: string,
): boolean {
  const contextRaw = resultJson.candidateAnalysisContext;
  if (!isRecord(contextRaw) || contextRaw.version !== "candidate-analysis-context-v1") {
    return false;
  }
  const record = getProductResearchRecord(resultJson);
  if (!record) return false;
  try {
    const rebuilt = buildCandidateAnalysisContext({
      sourceMetaJson: candidateSourceMetaJson || "",
      // buildCandidateAnalysisContext 只读 sourceMetaJson；其余字段不影响 sellerSprite 分支
    } as never);
    if (rebuilt.integrity === "unverified") return false;
    const hash = createCandidateAnalysisBindingHash(rebuilt as never, rebuilt);
    return hash === record.contextHash;
  } catch {
    return false;
  }
}
