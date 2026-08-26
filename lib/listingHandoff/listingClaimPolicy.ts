/**
 * Listing Claim Policy v1 —— 事实分级唯一裁决出口（Fact Safety）。
 *
 * 本模块是所有生成路径（AI 稿 / structured fallback / safe fallback）消费的
 * 单一事实分级来源：任何事实值在进入正式字段前必须经过本策略。
 *
 * 输出只有三档：
 *   - verified   ：确认事实且无禁止/风险问题 → 可进入正式字段；
 *   - review     ：确认事实但缺少新版「逐项确认（explicit_high_risk）」元数据
 *                  的高风险硬属性（功能/清洁/保温/认证/性能/时长/兼容/操作/结构），
 *                  或存在高风险词面但以确认事实值形式给出 → 只能进入待确认区；
 *   - prohibited ：命中 prohibitedClaims / cannotSay（含同义变体）→ 不得进入任何正式字段。
 *
 * 规范化（归一化）规则：大小写、首尾空格、连续空白、连字符/空格变体统一，
 * 使 "leakproof" = "leak-proof" = "leak proof"、"dishwasher-safe" = "dishwasher safe"。
 * 禁止各路径各自维护同义词表——全部走本模块。
 *
 * 纯函数；无 DB/网络；同输入同输出。
 */

export const LISTING_CLAIM_POLICY_VERSION = "listing-claim-policy.v1" as const;

export type ClaimTier = "verified" | "review" | "prohibited";

export type ClaimPolicyVerdict = {
  tier: ClaimTier;
  reason: string;
};

export type ClaimPolicyInput = {
  /** 事实字段（canonicalField） */
  field: string;
  /** 事实值（原文，未规范化） */
  value: string;
  /** 新版逐项确认元数据：显式标记该项已通过人工逐项确认（高风险硬属性必需） */
  explicitHighRiskConfirmed?: boolean;
  /** 调用方禁语（cannotSay / prohibitedClaims 的原文集合） */
  prohibited?: ReadonlyArray<string>;
};

/** 与 FactCandidateReview.HIGH_RISK_FACT_FIELDS 同步的高风险硬属性字段（单一语义出口） */
export const HIGH_RISK_CLAIM_FIELDS: ReadonlySet<string> = new Set([
  "functional_feature",
  "care",
  "cleaning",
  "insulation",
  "certification",
  "performance",
  "duration",
  "compatibility",
  "operation",
  "construction",
]);

/** 规范化：小写、空白归一、连字符/空格变体统一为无分隔（for 同义词匹配） */
export function normalizeClaimText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 同义规范化：连字符与空格视为等价（"leakproof" -> "leakproof";
 * "leak-proof" -> "leakproof"; "leak proof" -> "leakproof"）。
 * 用于 cannotSay / prohibitedClaims 匹配（词面级）。
 */
export function canonicalClaimTerm(text: string): string {
  return normalizeClaimText(text).replace(/[-_\s]+/g, "");
}

/** cannotSay / prohibitedClaims 是否命中（同义规范化后子串/等值匹配） */
export function hitsProhibited(
  value: string,
  prohibited: ReadonlyArray<string>,
): { hit: boolean; term: string | null } {
  const cannonValue = canonicalClaimTerm(value);
  if (!cannonValue) return { hit: false, term: null };
  for (const raw of prohibited ?? []) {
    const term = canonicalClaimTerm(raw);
    if (!term) continue;
    if (term === cannonValue || cannonValue.includes(term) || term.includes(cannonValue)) {
      return { hit: true, term: String(raw) };
    }
  }
  return { hit: false, term: null };
}

/**
 * 单一裁决出口。
 * 优先级：
 *   1) prohibitedClaims / cannotSay 命中 → prohibited；
 *   2) 高风险硬属性字段且缺少 explicitHighRiskConfirmed → review；
 *   3) 其余 → verified。
 */
export function classifyClaimPolicy(input: ClaimPolicyInput): ClaimPolicyVerdict {
  const field = String(input.field ?? "").trim();
  const value = String(input.value ?? "").trim();
  if (!value) return { tier: "prohibited", reason: "事实值为空，不得进入正式字段。" };

  // 1) 禁止声明命中（含同义变体）→ prohibited
  const hit = hitsProhibited(value, input.prohibited ?? []);
  if (hit.hit) {
    return { tier: "prohibited", reason: "事实值命中禁止声明（" + hit.term + "），不得进入正式字段。" };
  }

  // 2) 高风险硬属性缺逐项确认元数据 → review
  //    历史数据（无 explicit_high_risk 字段）fail-closed：不得进入正式字段。
  if (HIGH_RISK_CLAIM_FIELDS.has(field) && input.explicitHighRiskConfirmed !== true) {
    return {
      tier: "review",
      reason: "高风险硬属性缺少新版逐项确认（explicit_high_risk）元数据，需人工逐项确认后才能进入正式字段。",
    };
  }

  // 3) 其余 → verified
  return { tier: "verified", reason: "确认事实且无禁止/风险问题。" };
}

/** 批量裁决（保序） */
export function classifyClaimsPolicy(inputs: ReadonlyArray<ClaimPolicyInput>): ClaimPolicyVerdict[] {
  return inputs.map((input) => classifyClaimPolicy(input));
}
