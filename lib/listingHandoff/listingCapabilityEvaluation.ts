/**
 * Listing Capability Evaluation —— 共享 Policy 适配器（Step2）。
 *
 * 本模块把「Claim Policy 裁决结果 → ListingCapabilityV2 能力合同」接到纯函数层：
 * 逐个 productFact 调用既有 classifyClaimPolicy（单一裁决出口），得到真实 tier 后
 * 交给 evaluateListingCapability。禁止二次自造禁词/高风险规则；禁止从
 * creativeContext（VOC/关键词/竞品/供应商参考）生成事实。
 *
 * 纯函数：无 DB / 文件 / 环境变量 / 网络 / Provider / 日期 / 随机；不修改输入；同输入同输出。
 */

import { classifyClaimPolicy, type ClaimPolicyVerdict } from "@/lib/listingHandoff/listingClaimPolicy";
import {
  evaluateListingCapability,
  type ListingCapabilityFact,
  type ListingCapabilityResult,
  type ListingCapabilityTier,
} from "@/lib/listingHandoff/listingCapabilityV2";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

export type CapabilityEvaluationInput = {
  /** 生成输入（productFacts 与 prohibitedClaims 的权威来源；creativeContext 只读参考，绝不生成事实） */
  input: ListingGenerationInput;
  /** 当前版本 confirmedFacts（用于导出高风险逐项确认元数据） */
  confirmedFacts: ReadonlyArray<{
    field: string;
    value: string;
    evidenceTier?: string;
    sourceRef?: { sourceKind?: string };
  }>;
  /** 额外禁止条款（与 generationInput.prohibitedClaims 合并） */
  extraProhibitedTerms?: ReadonlyArray<string>;
  /** 是否已有阻断性问题 */
  hasBlockingIssue?: boolean;
};

export type CapabilityFactRecord = {
  factId: string;
  field: string;
  label: string;
  value: string;
  tier: ListingCapabilityTier;
};

export type CapabilityVerdict = ClaimPolicyVerdict & { field: string };

export type CapabilityEvaluationResult = {
  capability: ListingCapabilityResult;
  /** 仅 verified 事实（可进正式字段） */
  verifiedFacts: CapabilityFactRecord[];
  /** 仅 review 事实（待确认区） */
  reviewFacts: CapabilityFactRecord[];
  /** 仅 prohibited 事实（不得进入正式字段） */
  prohibitedFacts: CapabilityFactRecord[];
  /** 每个 productFact 的裁决记录（field / tier / reason） */
  verdicts: CapabilityVerdict[];
};

/**
 * 从 Policy 裁决结果评估 Listing 能力（纯函数）。
 *
 * - explicitHighRiskConfirmed 仅沿用当前权威规则：同字段 confirmedFact 满足
 *   evidenceTier="human_confirmed" 且 sourceRef.sourceKind="user_confirmation"。
 * - prohibited 合并 extraProhibitedTerms 与 generationInput.prohibitedClaims。
 * - factId 沿用 field（与 listingPlan 既有绑定键一致）。
 * - 绝不读取 creativeContext 生成事实。
 */
export function evaluateListingCapabilityFromPolicy(
  evaluation: CapabilityEvaluationInput,
): CapabilityEvaluationResult {
  const input = evaluation?.input as ListingGenerationInput | undefined ?? makeEmptyInput();
  const productFacts = Array.isArray(input?.productFacts) ? input.productFacts : [];
  const confirmedFacts = Array.isArray(evaluation?.confirmedFacts) ? evaluation.confirmedFacts : [];

  // 1) 高风险逐项确认集合（沿用 generationService 既有判定）
  const highRiskConfirmedFields = new Set<string>();
  for (const f of confirmedFacts) {
    const kind = (f?.sourceRef as { sourceKind?: string } | undefined)?.sourceKind;
    if (f?.evidenceTier === "human_confirmed" && kind === "user_confirmation") {
      highRiskConfirmedFields.add(String(f?.field ?? ""));
    }
  }

  // 2) 禁语合并（额外 + generationInput.prohibitedClaims；不重复）
  const prohibited = [
    ...(Array.isArray(evaluation?.extraProhibitedTerms) ? evaluation.extraProhibitedTerms : []),
    ...(Array.isArray(input?.prohibitedClaims) ? input.prohibitedClaims : []),
  ].filter((p) => typeof p === "string" && p.trim().length > 0);

  // 3) 逐事实调用既有 classifyClaimPolicy（唯一裁决出口）
  const verdicts: CapabilityVerdict[] = [];
  const capabilityFacts: ListingCapabilityFact[] = [];
  const verifiedFacts: CapabilityFactRecord[] = [];
  const reviewFacts: CapabilityFactRecord[] = [];
  const prohibitedFacts: CapabilityFactRecord[] = [];
  for (const gf of productFacts) {
    const field = String(gf?.field ?? "").trim();
    if (!field) continue;
    const verdict = classifyClaimPolicy({
      field,
      value: String(gf?.value ?? ""),
      explicitHighRiskConfirmed: highRiskConfirmedFields.has(field),
      prohibited,
    });
    verdicts.push({ field, tier: verdict.tier, reason: verdict.reason });
    const record: CapabilityFactRecord = {
      factId: field,
      field,
      label: String(gf?.label ?? ""),
      value: String(gf?.value ?? ""),
      tier: verdict.tier,
    };
    if (verdict.tier === "verified") verifiedFacts.push(record);
    else if (verdict.tier === "review") reviewFacts.push(record);
    else prohibitedFacts.push(record);
    capabilityFacts.push(record);
  }

  // 4) 交给 ListingCapabilityV2（它只认 verified 非空事实；review/prohibited 不增加 Bullet 数）
  const capability = evaluateListingCapability({
    facts: capabilityFacts,
    hasBlockingIssue: evaluation?.hasBlockingIssue === true,
  });

  return { capability, verifiedFacts, reviewFacts, prohibitedFacts, verdicts };
}

function makeEmptyInput(): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 0, researchRevision: 0 },
    productFacts: [],
    stableSourceFacts: [],
    creativeReferences: [],
    creativePreferences: {},
    prohibitedClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
  };
}
