import { createHash } from "node:crypto";
import type { ProductCreativeHandoffProjectionEvidence } from "@/lib/productCreativeHandoffProjection";
import type { ProductResearchRecordV1 } from "@/lib/productResearchRecord";
import type { CandidateResearchContext } from "@/lib/candidateResearchContext";
import type { AgentOutputSnapshot } from "@/lib/agentOutputSnapshot";

/**
 * Creative Handoff Projection Evidence Adapter（Fix.3）
 *
 * 真实研究数据 → ProjectionEvidence 的确定性纯函数转换。
 * 职责边界：
 * - 本模块负责「真实研究数据 → ProjectionEvidence」；
 * - projectProductCreativeHandoffCandidate 继续负责「ProjectionEvidence → Handoff Candidate」。
 *
 * 五层证据边界（冻结）：
 * - source_snapshot：仅 candidateAnalysisContext（同一商品实体，candidateId 一致）→ stable facts
 * - ai_hypothesis：仅 agentOutputSnapshot 的 AI 产出（summary/listing）→ creative references
 * - unknown_or_conflict：风险/合规/缺失 → issues
 * - human_confirmed：当前系统无生产点 — 本模块永不伪造
 * - deterministic_check：来源一致性校验结果
 *
 * 纯函数要求：无 DB/文件/网络/环境变量/Date.now/随机数；不修改输入；同输入同输出。
 */

const REQUIRED_AI_PROHIBITED_USES = [
  "title_fact",
  "bullet_fact",
  "parameter",
  "certification",
  "performance_claim",
  "image_text",
] as const;

const FULL_AI_PROHIBITED_USES = [
  ...REQUIRED_AI_PROHIBITED_USES,
  "packaging",
  "logo",
] as const;

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function uuidV4FromSeed(seed: string, salt: string): string {
  // 确定性 UUID v4（纯函数、无随机）
  const digest = sha256(`${salt}:${seed}`);
  const hex = digest.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed.normalize("NFC");
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const cleaned = cleanText(item, maxLength);
    if (cleaned && !seen.has(cleaned) && out.length < maxItems) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
}

/**
 * 同一商品实体门禁：CandidateResearchContext 与 researchRecord 的 candidateId 必须一致。
 */
function assertSameProductEntity(
  researchRecord: ProductResearchRecordV1,
  context: CandidateResearchContext,
): void {
  if (researchRecord.candidateId !== context.candidateId) {
    throw new ProjectionEvidenceAdapterError(
      "candidate_identity_mismatch",
      "候选身份与当前研究记录不一致，已拒绝投影。",
    );
  }
}

export class ProjectionEvidenceAdapterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProjectionEvidenceAdapterError";
  }
}

export type ProjectionEvidenceInput = {
  researchRecord: ProductResearchRecordV1;
  context: CandidateResearchContext;
  agentOutput: AgentOutputSnapshot | null;
  researchRevision: number;
  researchHash: string;
};

export type ProjectionEvidenceOutput = {
  evidence: ProductCreativeHandoffProjectionEvidence[];
  deterministicChecks: { checkId: string; passed: boolean; blocksHandoff: boolean; summary: string }[];
};

/**
 * 从权威 Task 构建 ProjectionEvidence。
 * 输入必须为已经通过严格解析和身份验证的服务端对象。
 */
export function buildProductCreativeHandoffProjectionEvidence(
  input: ProjectionEvidenceInput,
): ProjectionEvidenceOutput {
  const { researchRecord, context, agentOutput, researchRevision, researchHash } = input;

  // ── 同一商品实体门禁 ──
  assertSameProductEntity(researchRecord, context);

  // ── 版本一致性门禁 ──
  if (context.capturedAt && Number.isNaN(Date.parse(context.capturedAt))) {
    throw new ProjectionEvidenceAdapterError("invalid_captured_at", "来源捕获时间无效。");
  }

  const evidence: ProductCreativeHandoffProjectionEvidence[] = [];
  const deterministicChecks: ProjectionEvidenceOutput["deterministicChecks"] = [];

  // ── 身份一致性确定性检查 ──
  const identityConsistent = researchRecord.candidateId === context.candidateId;
  deterministicChecks.push({
    checkId: "source_identity_consistent",
    passed: identityConsistent,
    blocksHandoff: true,
    summary: "候选来源身份与当前研究记录一致。",
  });

  // ── 第一层：来源数据快照（candidateAnalysisContext）→ stable source facts ──
  // 仅允许同一商品实体的确定性字段；全部标记 internal + 需人工确认后才能用于声明。
  // V2.1.2：增加 factCategory 分类——product_fact 可确认进 Listing；
  // market_signal（价格/评分/评论数/类目）仅研究用途，永不进入 Listing。
  const stableFieldMapping: Array<{
    field: string;
    label: string;
    value: unknown;
    stabilityRule: "identity_only" | "routing_only" | "human_confirmation_required_for_claim";
    factCategory?: "product_fact" | "market_signal";
  }> = [];

  if (context.asin) {
    stableFieldMapping.push({ field: "asin", label: "ASIN", value: context.asin, stabilityRule: "identity_only" });
  }
  if (context.title) {
    stableFieldMapping.push({ field: "title", label: "商品标题", value: context.title, stabilityRule: "routing_only" });
  }
  if (context.brand) {
    stableFieldMapping.push({ field: "brand", label: "品牌", value: context.brand, stabilityRule: "human_confirmation_required_for_claim", factCategory: "product_fact" });
  }
  if (context.category) {
    // 类目是市场归类，不是商品内容属性；仅 internal（市场参考）
    stableFieldMapping.push({ field: "category", label: "类目", value: context.category, stabilityRule: "human_confirmation_required_for_claim", factCategory: "market_signal" });
  }
  if (context.priceUsd !== null && context.priceUsd !== undefined) {
    stableFieldMapping.push({ field: "price_usd", label: "参考价格 (USD)", value: context.priceUsd, stabilityRule: "human_confirmation_required_for_claim", factCategory: "market_signal" });
  }
  if (context.rating !== null && context.rating !== undefined) {
    stableFieldMapping.push({ field: "rating", label: "评分", value: context.rating, stabilityRule: "human_confirmation_required_for_claim", factCategory: "market_signal" });
  }
  if (context.reviewCount !== null && context.reviewCount !== undefined) {
    stableFieldMapping.push({ field: "review_count", label: "评论数", value: context.reviewCount, stabilityRule: "human_confirmation_required_for_claim", factCategory: "market_signal" });
  }

  for (const mapping of stableFieldMapping) {
    if (mapping.value === null || mapping.value === undefined || mapping.value === "") continue;
    const factId = uuidV4FromSeed(`stable:${context.candidateId}:${mapping.field}:${String(mapping.value)}`, "stable-fact-v1");
    evidence.push({
      evidenceTier: "source_snapshot",
      fact: {
        factId,
        field: mapping.field,
        label: mapping.label,
        value: mapping.value as string | number | boolean,
        evidenceTier: "source_snapshot",
        usageScopes: ["internal"],
        sourceRef: {
          sourceKind: "candidate_snapshot",
          sourceField: mapping.field,
          candidateSnapshotFingerprint: sha256(`${context.candidateId}:${mapping.field}:${String(mapping.value)}:${context.capturedAt}`),
          capturedAt: context.capturedAt,
        },
        stabilityRule: mapping.stabilityRule,
        factCategory: mapping.factCategory,
      },
    });
  }

  // ── 第四层：AI 辅助假设／创意参考（agentOutputSnapshot）→ aiCreativeReferences ──
  const aiReferences: Array<{ field: string; summary: string; allowedUse: "tone" | "layout" | "composition" | "non_factual_angle" }> = [];

  if (agentOutput) {
    // listingSnapshot：标题/卖点/描述 → 仅创意参考
    const titleDraft = cleanText(agentOutput.listingSnapshot.titleDraft, 500);
    if (titleDraft) {
      aiReferences.push({ field: "listing_title_idea", summary: titleDraft, allowedUse: "composition" });
    }
    for (const bullet of cleanStringArray(agentOutput.listingSnapshot.bulletDrafts, 4, 300)) {
      aiReferences.push({ field: "bullet_idea", summary: bullet, allowedUse: "non_factual_angle" });
    }
    const descriptionDraft = agentOutput.listingSnapshot.descriptionDraft
      ? cleanText(agentOutput.listingSnapshot.descriptionDraft, 500)
      : null;
    if (descriptionDraft) {
      aiReferences.push({ field: "description_idea", summary: descriptionDraft, allowedUse: "non_factual_angle" });
    }
    for (const idea of cleanStringArray(agentOutput.listingSnapshot.imageIdeas, 3, 300)) {
      aiReferences.push({ field: "image_idea", summary: idea, allowedUse: "composition" });
    }
    // summarySnapshot：卖点 → 仅创意参考
    for (const point of cleanStringArray(agentOutput.summarySnapshot.sellingPoints, 4, 300)) {
      aiReferences.push({ field: "selling_point_idea", summary: point, allowedUse: "non_factual_angle" });
    }
  }

  for (const reference of aiReferences) {
    const referenceId = uuidV4FromSeed(`ai:${context.candidateId}:${reference.field}:${reference.summary}`, "ai-ref-v1");
    evidence.push({
      evidenceTier: "ai_hypothesis",
      reference: {
        referenceId,
        field: reference.field,
        summary: reference.summary,
        evidenceTier: "ai_hypothesis",
        allowedUse: reference.allowedUse,
        prohibitedUses: [...FULL_AI_PROHIBITED_USES],
      },
    });
  }

  // ── 第五层：未知／冲突 → issues ──
  const issues: Array<{
    issueId: string;
    field: string;
    kind: "missing" | "conflict";
    summary: string;
    sourceSummaries?: string[];
    risk: "low" | "medium" | "high" | "blocking";
    blocks: Array<"listing_title" | "listing_bullets" | "listing_description" | "search_terms" | "image_product_depiction" | "image_text" | "packaging" | "logo" | "certification" | "performance_claim">;
    recommendedAction: string;
  }> = [];

  if (agentOutput) {
    const risk = agentOutput.riskSnapshot;
    if (risk.needsManualReview) {
      for (const flag of cleanStringArray(risk.riskFlags, 4, 200)) {
        issues.push({
          issueId: uuidV4FromSeed(`issue:risk:${flag}`, "issue-v1"),
          field: "risk",
          kind: "conflict",
          summary: flag,
          risk: risk.riskLevel === "high" ? "high" : "medium",
          blocks: ["listing_title", "listing_bullets"],
          recommendedAction: "请人工复核该风险项后再使用相关内容。",
        });
      }
    }
    // 缺失信息 → issues
    for (const missing of cleanStringArray(agentOutput.listingSnapshot.missingInputs, 4, 200)) {
      issues.push({
        issueId: uuidV4FromSeed(`issue:missing:${missing}`, "issue-v1"),
        field: "listing_input",
        kind: "missing",
        summary: `缺少: ${missing}`,
        risk: "low",
        blocks: ["listing_description"],
        recommendedAction: "补充该信息后再创作 Listing。",
      });
    }
    // blocking issues（nextActionSnapshot.blockingIssues）
    // 兼容降级：历史快照可能把"Listing bullets / sellingPoints / 关键词"等可补信息
    // 误记为 blocking。这些只作为普通提示（risk: low），不标记 blocking，不阻断 Handoff。
    // 真正阻断仅限合规/风险/黑名单等（risk: blocking）。
    const NON_BLOCKING_HINTS = /bullets?|selling ?points|卖点|关键词|keywords|listing|标题|title/i;
    for (const blocking of cleanStringArray(agentOutput.nextActionSnapshot.blockingIssues, 4, 200)) {
      const isListableHint = NON_BLOCKING_HINTS.test(blocking);
      issues.push({
        issueId: uuidV4FromSeed(`issue:blocking:${blocking}`, "issue-v1"),
        field: isListableHint ? "listing_input" : "blocking",
        kind: "conflict",
        summary: blocking,
        risk: isListableHint ? "low" : "blocking",
        blocks: isListableHint
          ? ["listing_description"]
          : ["listing_title", "listing_bullets", "listing_description", "search_terms", "image_product_depiction"],
        recommendedAction: isListableHint
          ? "缺少卖点不影响继续，系统会根据已确认事实生成保守 Listing 草稿。"
          : "解决该阻塞项后才能继续创作交接。",
      });
    }
  }

  for (const issue of issues) {
    evidence.push({
      evidenceTier: "unknown_or_conflict",
      issue: {
        ...issue,
        ...(issue.sourceSummaries ? { sourceSummaries: issue.sourceSummaries } : {}),
      },
    });
  }

  return { evidence, deterministicChecks };
}
