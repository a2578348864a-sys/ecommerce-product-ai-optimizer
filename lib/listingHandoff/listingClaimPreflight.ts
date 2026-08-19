/**
 * V3R（Research→Creative Consistency）— Listing Claim Preflight（Fix 3：UI/Generate 同源）
 *
 * 契约① LISTENING_READINESS：UI「可生成 Listing」的判定必须与服务端 Generate 的事实校验同源。
 * 旧问题：GET readiness 只检查 listingEligibleFacts > 0（计数），而 Generate 实际要求
 * 组合草稿的每一条 claim 都有证据支持（listingClaimsHaveEvidence）——计数>0 与 claims 校验
 * 不一致，导致 UI 显示可生成、点击后报「组合草稿未通过事实校验」。
 *
 * 本函数复用 Generate 的完整确定性校验链（与 listingGenerationService 阶段 B 完全一致）：
 *   buildListingInputFromCreativeHandoff → buildDeterministicListingPackDraft
 *     → validateAiListingPackDraft → filterListingClaims → verifyListingClaims
 *     → listingClaimsHaveEvidence
 * 纯函数：无 DB / 无网络 / 无 AI / 无副作用，GET 预演安全。
 *
 * 注意：Generate 输入中的 listingBrief 不参与确定性组合（compose 只从 facts 组合），
 * 因此无 brief 预演与 Generate 的 deterministic 校验同源；brief 引入的额外风险
 * 由 Generate 自身的 verifyListingClaims 拦截，不在本预演范围内。
 */
import type { ProductCreativeHandoffV1 } from "@/lib/productCreativeHandoff";
import {
  buildListingInputFromCreativeHandoff,
} from "@/lib/listingHandoff/listingGenerationInput";
import { buildDeterministicListingPackDraft } from "@/lib/listingHandoff/listingComposition";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";
import {
  verifyListingClaims,
  listingClaimsHaveEvidence,
} from "@/lib/listingHandoff/listingClaimEvidenceResolver";

export type ListingClaimPreflightResult =
  | { pass: true; reason: null }
  | { pass: false; reasonCode: string; reason: string };

/**
 * 预演 Generate 的事实校验链。pass=false 时 reason 为面向用户的阻断原因（人话）。
 */
export function preflightListingClaimSafety(input: {
  handoff: ProductCreativeHandoffV1;
  researchRevision: number;
}): ListingClaimPreflightResult {
  const buildResult = buildListingInputFromCreativeHandoff(input.handoff, input.researchRevision);
  if (!buildResult.ok) {
    return { pass: false, reasonCode: buildResult.code, reason: buildResult.message };
  }
  const draft = buildDeterministicListingPackDraft(buildResult.input, new Date().toISOString());
  const schema = validateAiListingPackDraft(draft);
  if (!schema.ok) {
    return { pass: false, reasonCode: "listing_schema_invalid", reason: "组合草稿未通过结构校验。" };
  }
  const filtered = filterListingClaims(schema.data, {
    prohibitedClaims: buildResult.input.prohibitedClaims,
    customClaimLabel: "Handoff prohibited claim",
  });
  const evidence = verifyListingClaims(filtered.cleaned, buildResult.input);
  if (!listingClaimsHaveEvidence(evidence)) {
    const first = evidence.unsupportedClaims[0];
    return {
      pass: false,
      reasonCode: "listing_claims_unsupported",
      reason: first
        ? `组合草稿含未经验证的表述（${first.reason}）：「${first.text.slice(0, 80)}」。请补充并确认相应商品事实后重试。`
        : "组合草稿未通过事实校验，请补充确认事实后重试。",
    };
  }
  return { pass: true, reason: null };
}
