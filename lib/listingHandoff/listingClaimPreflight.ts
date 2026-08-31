/**
 * V3R（Research→Creative Consistency）— Listing Claim Preflight（Fix 3：UI/Generate 同源）
 *
 * 契约① LISTENING_READINESS：UI「可生成 Listing」的判定必须与服务端 Generate 的事实校验同源。
 *
 * 单一流程（与 generationService 同源）：
 *   buildListingInputFromCreativeHandoff
 *   → evaluateListingCapabilityFromPolicy（唯一 Policy 裁决出口）
 *   → verifiedFacts 构成 safeGenerationInput（review/prohibited 不进入）
 *   → deterministic draft / schema / Claim Evidence 只针对 safeGenerationInput
 *
 * 三态语义（V2 中文事实关闭）：
 *   - pass：安全事实已英文，schema + Claim Evidence 完整通过；
 *   - english_rendering_pending：verified 安全事实含中文，正式生成阶段英文化
 *     （允许生成状态，不是假 pass；完整文案校验在生成时执行）；
 *   - blocked：仅用于 handoff/revision 无效、排除 review/prohibited 后安全事实能力不足、
 *     缺少身份、真正全局 hasBlockingIssue、verified 安全事实的英文结构/Claim Evidence 失败。
 *
 * 一条 prohibited 事实不自动全局阻断其余安全事实（正确行为：排除后按剩余能力判断）。
 */
import type { ProductCreativeHandoffV1 } from "@/lib/productCreativeHandoff";
import {
  buildListingInputFromCreativeHandoff,
  type ListingGenerationInput,
} from "@/lib/listingHandoff/listingGenerationInput";
import { evaluateListingCapabilityFromPolicy } from "@/lib/listingHandoff/listingCapabilityEvaluation";
import { buildDeterministicListingPackDraft } from "@/lib/listingHandoff/listingComposition";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";
import {
  verifyListingClaims,
  listingClaimsHaveEvidence,
} from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import { DEFAULT_CANNOT_SAY } from "@/lib/listingHandoff/listingPlan";

export type ListingClaimPreflightResult =
  | { pass: true; reason: null }
  | { pass: false; reasonCode: string; reason: string };

/** 中文/中文标点检测：非英文内容可经 English Rendering 英文化，不属"不安全事实" */
const HAS_CJK = /[一-鿿㐀-䶿]/;
const HAS_CJK_PUNCT = /[。，；：、！？]/;

function hasCJKValue(value: string): boolean {
  return HAS_CJK.test(value) || HAS_CJK_PUNCT.test(value);
}

/** 安全事实（verified）中存在中文 → 需要英文化 */
function hasPendingCJK(facts: Array<{ value: string }>): boolean {
  return facts.some((f) => hasCJKValue(f.value));
}

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

  // 1) 单一 Policy 裁决出口（与 generationService 同源）
  const version = input.handoff.versions[input.handoff.versions.length - 1];
  const evalResult = evaluateListingCapabilityFromPolicy({
    input: buildResult.input,
    confirmedFacts: (version?.confirmedFacts ?? []).map((f) => ({
      field: String(f.field ?? ""),
      value: String(f.value ?? ""),
      evidenceTier: String((f as { evidenceTier?: string }).evidenceTier ?? ""),
      sourceRef: f.sourceRef as { sourceKind?: string } | undefined,
    })),
    extraProhibitedTerms: DEFAULT_CANNOT_SAY,
    hasBlockingIssue: false,
  });
  const capability = evalResult.capability;

  // 2) 排除 review/prohibited：safeGenerationInput 只含 verified
  const verifiedFields = new Set(evalResult.verifiedFacts.map((f) => f.field));
  const safeInput: ListingGenerationInput = {
    ...buildResult.input,
    productFacts: buildResult.input.productFacts.filter((f) => verifiedFields.has(f.field)),
  };

  // 3) 能力不足（排除 prohibited 后安全事实不足以生成部分草稿）→ blocked（能力，非洗白）
  if (capability.isBlocked || !capability.hasIdentity || capability.targetBulletCount < 2) {
    return {
      pass: false,
      reasonCode: "blocked",
      reason: capability.hasIdentity
        ? "已确认的安全事实不足以生成最低要求的 Listing，请补充并确认更多商品事实。"
        : "缺少品牌/商品类型/系列型号（身份事实），无法生成 Listing。",
    };
  }

  // 4) 安全事实含中文 → pending（正式生成阶段英文化；不伪称完整通过）
  if (hasPendingCJK(safeInput.productFacts)) {
    return {
      pass: false,
      reasonCode: "english_rendering_pending",
      reason: "中文商品事实将在正式生成阶段英文化（不阻塞生成）；完整文案校验在生成时执行。",
    };
  }

  // 5) 英文安全事实的结构 + Claim Evidence 校验（只对 safeInput）
  const draft = buildDeterministicListingPackDraft(safeInput, new Date().toISOString());
  const schema = validateAiListingPackDraft(draft);
  if (!schema.ok) {
    return { pass: false, reasonCode: "listing_schema_invalid", reason: "组合草稿未通过结构校验。" };
  }
  const filtered = filterListingClaims(schema.data, {
    prohibitedClaims: safeInput.prohibitedClaims,
    customClaimLabel: "Handoff prohibited claim",
  });
  const evidence = verifyListingClaims(filtered.cleaned, safeInput);
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
