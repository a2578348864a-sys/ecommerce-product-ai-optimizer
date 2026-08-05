import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

/**
 * PR2-2 Listing Prompt 五分区构造器。
 *
 * 只接收安全 Listing Generation Input（已过滤内部字段）；
 * 不接收 requestId、Ledger、完整 Hash、resultJson、内部主体。
 * 输出明确分区：已确认商品事实 / 有来源稳定事实 / 创意参考 / 禁止声明 / 未知与冲突。
 */

export const LISTING_PROMPT_FORBIDDEN_MARKERS = Object.freeze([
  "requestId", "requestLedger", "researchHash", "handoffFingerprint", "candidateId",
  "subjectFingerprint", "actorRef", "resultJson", "sourceRef", "assetFingerprint",
  "candidateSnapshotFingerprint",
]);

function sectionTitle(label: string) {
  return `\n=== ${label} ===\n`;
}

function textList(values: string[]) {
  return values.length > 0 ? values.map((v, i) => `${i + 1}. ${v}`).join("\n") : "(无)";
}

function factLines(facts: Array<{ field: string; label: string; value: string }>) {
  return facts.length > 0
    ? facts.map((f) => `- ${f.label} (${f.field}): ${f.value}`).join("\n")
    : "(无)";
}

/**
 * 五分区 Prompt。纯函数：同输入同输出；无时间/随机/env。
 */
export function buildListingPromptFromInput(input: ListingGenerationInput): string {
  const prefs = input.creativePreferences;
  const preferenceLine = Object.keys(prefs).length
    ? Object.entries(prefs).map(([k, v]) => `${k}: ${v}`).join(", ")
    : "(无)";

  return [
    "You generate a human-review listing draft for a cross-border ecommerce operator. The draft must never be presented as published, certified, approved, or ready for direct commercial use.",
    "",
    "Rules:",
    "- Return strict JSON only, matching the requested shape. Do not add Markdown fences.",
    "- State ONLY the confirmed facts above, using their exact values with conservative field templates.",
    "- Never add grades, performance, effects, compatibility ranges, origin or any modifier that is not in the confirmed facts.",
    "- Never rewrite AI creative references into objective product facts. Creative references are wording and structure only.",
    "- Keep unknowns unknown: never complete, guess or infer missing or conflicting details, and never pick one side of a conflict yourself.",
    "- Never output prohibited claims or their rewrites. Never complete, guess or infer unknown or conflicting details.",
    "- Only neutral non-factual copy from the frozen allowlist may be added (e.g. 日常使用的实用选择, 简洁实用的选择, 清晰呈现产品特点).",
    "- Keep wording conservative when information is missing.",
    "- Human review is required (humanReviewRequired=true). Output is a draft only.",
    "",
    "=== 已确认商品事实 (Confirmed product facts) ===",
    "You MAY state these as product facts.",
    factLines(input.productFacts),
    "",
    "=== 有来源的稳定事实 (Stable sourced facts) ===",
    "Use only when the current use is allowed; these are NOT confirmed facts.",
    factLines(input.stableSourceFacts),
    "",
    "=== 创意参考 (Creative references only) ===",
    "Use ONLY for wording and structure. They are NOT facts.",
    textList(input.creativeReferences),
    "",
    "=== 禁止声明 (Prohibited claims) ===",
    "Must NEVER appear in output, including warnings or metadata.",
    textList(input.prohibitedClaims),
    "",
    "=== 未知和冲突 (Unknowns and conflicts) ===",
    "Do NOT complete, guess or infer. If relevant, mention in risk notes only.",
    textList(input.unknowns),
    "",
    "=== 创意偏好 (Creative preferences) ===",
    preferenceLine,
    "",
    "Output JSON shape:",
    JSON.stringify({
      source: "mock_ai_draft",
      titles: ["Draft title for human review"],
      bullets: ["Factual bullet without unsupported claims"],
      description: "Plain draft description for manual review only.",
      keywords: ["keyword"],
      sellingPoints: ["Factual selling angle"],
      riskNotes: ["What the operator must verify before publishing"],
      complianceWarnings: [],
      blockedClaims: [],
      reviewChecklist: ["Manual review item"],
    }),
  ].join("\n");
}

/** 防泄漏断言：Prompt 不得包含任何内部标记 */
export function assertPromptIsSafe(prompt: string): boolean {
  return !LISTING_PROMPT_FORBIDDEN_MARKERS.some((marker) => prompt.includes(marker));
}
