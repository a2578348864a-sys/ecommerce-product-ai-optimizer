import type { ImageGenerationInput } from "@/lib/imageHandoff/imageGenerationInput";

/**
 * PR2-3 Image Prompt 双模式构造器。
 *
 * composition_concept：只生成构图概念，不描绘具体商品外形，不补全未知产品属性；
 *                    使用抽象占位/轮廓/非产品特定构图；不生成 Logo/认证/包装文字；
 *                    不暗示是真实商品图；输出仅供布局参考。
 * product_visual_draft：产品形态只能来自批准视觉参考；商品事实只能来自 confirmedFacts；
 *                     不增加功能/配件/认证；不改变 Logo 或包装文字；
 *                     AI reference 只影响风格；unknown/conflict 不得推断；输出仍需人工审核。
 *
 * 不包含：完整 Handoff / resultJson / requestId / Request Ledger / 内部主体 /
 *        Candidate ID / 完整 Hash / Store 路径 / Provider Secret / 未批准视觉对象。
 */

export const IMAGE_PROMPT_FORBIDDEN_MARKERS = Object.freeze([
  "requestId", "requestLedger", "researchHash", "handoffFingerprint", "candidateId",
  "subjectFingerprint", "actorRef", "resultJson", "sourceRef", "assetFingerprint",
  "candidateSnapshotFingerprint", "confirmationReference",
]);

function textList(values: string[]) {
  return values.length > 0 ? values.map((v, i) => `${i + 1}. ${v}`).join("\n") : "(无)";
}

function factLines(facts: Array<{ field: string; label: string; value: string }>) {
  return facts.length > 0
    ? facts.map((f) => `- ${f.label} (${f.field}): ${f.value}`).join("\n")
    : "(无)";
}

function preferenceLine(prefs: Record<string, string>) {
  return Object.keys(prefs).length
    ? Object.entries(prefs).map(([k, v]) => `${k}: ${v}`).join(", ")
    : "(无)";
}

/** 双模式 Prompt 构造（纯函数） */
export function buildImagePromptFromInput(input: ImageGenerationInput): string {
  const commonSafety = [
    "You generate a human-review image draft for cross-border ecommerce listing material planning.",
    "This is NOT a real product photograph and must not be presented or labelled as one.",
    "Do not add brand logos, trademarks, certification marks, platform badges, medical claims, safety claims, sales claims, profit claims, or competitor-specific visual identity.",
    "Do not invent dimensions, weight, capacity, materials, certifications, performance data, functions, or packaging contents.",
    "Unknown or conflicting details must stay visually neutral: never infer, complete or pick one side.",
    "Human review is required before any use. The output is a draft only and is not publishable.",
  ];

  if (input.mode === "composition_concept") {
    return [
      ...commonSafety,
      "",
      "MODE: composition_concept only.",
      "- Produce ONLY an abstract composition concept: layout, background direction, scene mood, text whitespace areas, colour direction, camera angle suggestion.",
      "- Do NOT depict the specific product shape or any real product appearance.",
      "- Do NOT complete unknown product attributes (colour, material, structure, interface, packaging, accessories).",
      "- Use abstract placeholders, silhouettes or non-product-specific compositions.",
      "- Do NOT generate logos, certification marks, or packaging text.",
      "- Do NOT imply this is a finished product image.",
      "",
      "=== 已确认商品事实（仅作为构图上下文，不描绘外观）===",
      factLines(input.productFacts),
      "",
      "=== 构图参考（仅风格/氛围/构图/色彩方向，非事实）===",
      textList(input.compositionReferences),
      "",
      "=== 构图偏好 ===",
      preferenceLine(input.creativePreferences),
      "",
      "=== 禁止视觉声明 ===",
      "Must NEVER appear in the output.",
      textList(input.prohibitedVisualClaims),
      "",
      "=== 未知和冲突（不得推断）===",
      textList(input.unknowns),
    ].join("\n");
  }

  // product_visual_draft
  return [
    ...commonSafety,
    "",
    "MODE: product_visual_draft.",
    "- The product shape may ONLY come from the approved visual reference(s) listed below.",
    "- Product facts may ONLY come from the confirmed facts listed below.",
    "- Do NOT add functions, accessories, certifications, logos, or packaging text that are not in the approved reference or confirmed facts.",
    "- Do NOT alter logos or packaging text shown in the approved reference.",
    "- AI composition references affect STYLE ONLY, never product shape or facts.",
    "- Unknown or conflicting details must stay visually neutral; never infer or complete.",
    "- The output remains a human-review draft and must not be presented as a finished product photo.",
    "",
    "=== 已批准产品视觉参考（唯一产品形态来源）===",
    textList(input.approvedVisualReferences.map((r) => r.summary)),
    "",
    "=== 已确认商品事实 ===",
    factLines(input.productFacts),
    "",
    "=== 构图参考（仅风格/氛围/构图/色彩方向）===",
    textList(input.compositionReferences),
    "",
    "=== 构图偏好 ===",
    preferenceLine(input.creativePreferences),
    "",
    "=== 禁止视觉声明 ===",
    "Must NEVER appear in the output.",
    textList(input.prohibitedVisualClaims),
    "",
    "=== 未知和冲突（不得推断）===",
    textList(input.unknowns),
  ].join("\n");
}

/** 防泄漏断言：Prompt 不得包含任何内部标记 */
export function assertImagePromptIsSafe(prompt: string): boolean {
  return !IMAGE_PROMPT_FORBIDDEN_MARKERS.some((marker) => prompt.includes(marker));
}
