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

/**
 * V3 Image Product Identity Lock（§8/§23/§31）：目标商品身份硬约束文本。
 * productType 已确认 → 类别锁；未确认 → 要求保持与目标商品同类别（不猜具体类别）。
 * 低层参考（VOC/AI/竞品/供应）永不能覆盖此身份（§22/§24）。
 */
export function buildTargetProductIdentityBlock(input: ImageGenerationInput): string {
  const t = input.targetProduct;
  const lines = [
    t.displayName ? `- Product title: ${t.displayName}` : null,
    t.productType ? `- Product type: ${t.productType}` : null,
    t.brand ? `- Brand: ${t.brand}` : null,
    t.seriesOrModel ? `- Series/model: ${t.seriesOrModel}` : null,
    t.capacity ? `- Size/capacity: ${t.capacity}` : null,
  ].filter((line): line is string => line !== null);
  const categoryLock = t.productType
    ? `The image subject MUST remain a ${t.productType}. Do NOT change the product category. Do NOT replace the subject with serum, cosmetics, skincare, clothing, shoes, headphones, electronics, food or any other product.`
    : "The image subject MUST remain the same product category as the target product described above. Do NOT replace it with a different product category (e.g. serum, cosmetics, skincare, clothing, electronics).";
  return [
    "TARGET PRODUCT IDENTITY (HARD CONSTRAINT)",
    ...lines,
    categoryLock,
    "Do NOT add brand logos, trademarks, certification marks, packaging text or any unconfirmed text.",
    "Reference layers below must never override this identity.",
  ].join("\n");
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
      buildTargetProductIdentityBlock(input),
      "",
      "MODE: composition_concept only.",
      "- Produce ONLY an abstract composition concept: layout, background direction, scene mood, text whitespace areas, colour direction, camera angle suggestion.",
      "- Do NOT depict the specific product shape or any real product appearance.",
      "- Use abstract placeholders or silhouettes — but the placeholder subject MUST remain the target product category above.",
      "- Do NOT complete unknown product attributes (colour, material, structure, interface, packaging, accessories).",
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
      "",
      "=== 研究参考层（Research reference layers — NOT FACTS）===",
      "Reference ONLY for scene priority, mood and differentiation direction.",
      "Never turn any reference into product appearance, attribute, certification, performance, or text claim.",
      "Never let any reference change the target product category.",
      buildResearchReferenceLayers(input.creativeContext),
    ].join("\n");
  }

  // product_visual_draft
  return [
    ...commonSafety,
    "",
    buildTargetProductIdentityBlock(input),
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
    "",
    "=== 研究参考层（Research reference layers — NOT FACTS）===",
    "Reference ONLY for scene priority, mood and differentiation direction.",
    "Never turn any reference into product appearance, attribute, certification, performance, or text claim.",
    "Never let any reference change the target product category.",
    buildResearchReferenceLayers(input.creativeContext),
  ].join("\n");
}

/** V3 Evidence → Creative Context Bridge：Image 参考层文本（bounded；全部 NOT FACT） */
function buildResearchReferenceLayers(
  context: ImageGenerationInput["creativeContext"],
): string {
  if (!context) return "研究参考层：无";
  const sections: string[] = [];
  if (context.vocInsights.length) sections.push(`VOC_INSIGHTS_START\n${context.vocInsights.map((v) => `- ${v}`).join("\n")}\nVOC_INSIGHTS_END`);
  if (context.aiReferences.length) sections.push(`AI_REFERENCES_START\n${context.aiReferences.map((v) => `- ${v}`).join("\n")}\nAI_REFERENCES_END`);
  if (context.competitiveContext.length) sections.push(`COMPETITIVE_CONTEXT_START\n${context.competitiveContext.map((v) => `- ${v}`).join("\n")}\nCOMPETITIVE_CONTEXT_END`);
  return sections.length ? sections.join("\n") : "研究参考层：无";
}

/** 防泄漏断言：Prompt 不得包含任何内部标记 */
export function assertImagePromptIsSafe(prompt: string): boolean {
  return !IMAGE_PROMPT_FORBIDDEN_MARKERS.some((marker) => prompt.includes(marker));
}
