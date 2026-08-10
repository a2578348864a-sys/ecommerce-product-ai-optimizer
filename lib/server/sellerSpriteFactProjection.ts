/**
 * SellerSprite → Listing Source Fact Projection（v2.2.10 本地实现）
 *
 * 目标：SellerSprite XLSX 已存在的商品资料自动形成可核实的 Listing Fact Candidates，
 * 用户只负责核实/补缺，不重新手抄。
 *
 * 三层语义：
 * - MARKET_SIGNAL：price/rating/reviewCount/sales/revenue/BSR —— 仅研究，禁止成为 Listing Fact。
 * - STRUCTURED_PRODUCT_SOURCE：详细参数（Key: Value | Key: Value）→ canonical listing fields
 *   （brand/material/capacity/color/product_type/quantity/series）→ structured candidates。
 * - CONTENT_SOURCE：产品卖点/卖点翻译 → 功能事实候选（AI 提取，仅候选，不自动确认）。
 *
 * 安全：所有候选 usageScopes=internal + human_confirmation_required_for_claim；
 * AI 只提取候选，不得生成 human_confirmed；营销效果/认证/绝对 claim 不自动确认。
 *
 * 纯函数；无 DB/网络；同输入同输出。
 */

/** canonical listing 字段映射（仅当前已有合同的字段；未知字段保留为 sourceAttribute 或跳过） */
export const STRUCTURED_FIELD_MAP: Array<{ sourceKeys: string[]; canonicalField: string; canonicalLabel: string }> = [
  { sourceKeys: ["brand", "品牌"], canonicalField: "brand", canonicalLabel: "品牌" },
  { sourceKeys: ["material", "材质", "材料"], canonicalField: "material", canonicalLabel: "材质" },
  { sourceKeys: ["capacity", "容量", "size"], canonicalField: "capacity", canonicalLabel: "容量" },
  { sourceKeys: ["color", "颜色"], canonicalField: "color_or_variant", canonicalLabel: "颜色/变体" },
  { sourceKeys: ["bottle type", "product type", "type", "商品类型"], canonicalField: "product_type", canonicalLabel: "商品类型" },
  { sourceKeys: ["quantity", "pack count", "数量", "包装数量"], canonicalField: "quantity_or_pack_size", canonicalLabel: "数量/包装" },
  { sourceKeys: ["series", "model", "系列", "型号"], canonicalField: "series_or_model", canonicalLabel: "系列/型号" },
];

export type ProjectedFactCandidate = {
  field: string;
  label: string;
  value: string;
  candidateKind: "structured" | "ai_extracted";
  sourceField: string;
  sourceSnippet: string;
  role: string;
};

/** 规范化键：小写、去空格、去常见标点 */
function normalizeKey(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase().replace(/[\s:：|]+/g, "").trim();
}

/** 解析 SKU / 详细参数：`Key: Value | Key: Value` 结构（确定性，不调 AI） */
export function parseStructuredKeyValueBlocks(raw: string | null | undefined): Array<{ key: string; value: string }> {
  if (!raw) return [];
  const out: Array<{ key: string; value: string }> = [];
  for (const block of raw.split(/[|｜]/)) {
    const match = block.match(/^\s*([^:：]+?)\s*[:：]\s*(.+?)\s*$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (key && value) out.push({ key, value });
  }
  return out;
}

/** 结构化来源 → canonical listing 候选（未知字段跳过并记录，不硬猜） */
export function projectStructuredCandidates(
  detailAttributesRaw: string | null | undefined,
  skuRaw: string | null | undefined,
): { candidates: ProjectedFactCandidate[]; unmapped: Array<{ key: string; value: string }> } {
  const candidates: ProjectedFactCandidate[] = [];
  const unmapped: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();

  const blocks = [
    ...parseStructuredKeyValueBlocks(detailAttributesRaw),
    ...parseStructuredKeyValueBlocks(skuRaw),
  ];

  for (const { key, value } of blocks) {
    const normalized = normalizeKey(key);
    const mapping = STRUCTURED_FIELD_MAP.find((m) => m.sourceKeys.some((k) => normalizeKey(k) === normalized));
    if (!mapping) {
      unmapped.push({ key, value });
      continue;
    }
    const dedupeKey = `${mapping.canonicalField}:${value}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    candidates.push({
      field: mapping.canonicalField,
      label: mapping.canonicalLabel,
      value,
      candidateKind: "structured",
      sourceField: key,
      sourceSnippet: `${key}: ${value}`,
      role: mapping.canonicalField,
    });
  }
  return { candidates, unmapped };
}

/**
 * Content Source → 功能事实候选（Mock/deterministic 规则提取，非真实 AI）。
 * 输出候选；AI 不得生成 human_confirmed。
 * 规则：按功能关键词句拆分卖点文本，提取为 functional/usage/care/construction 等候选。
 */
/** Content 角色优先级：具体角色（care/construction/compatibility）优先于泛化 functional */
const CONTENT_ROLE_PATTERNS: Array<{ role: string; pattern: RegExp }> = [
  { role: "care", pattern: /\b(clean|dishwasher|hand wash|rinse|wash|wipe)\b/i },
  { role: "construction", pattern: /\b(stainless|steel|18\/8|material|durab|built to|construction)\b/i },
  { role: "compatibility", pattern: /\b(compatible|fits|cup holder|fits in)\b/i },
  { role: "included_components", pattern: /\b(comes with|includes|included|accessor|replacement)\b/i },
  { role: "functional_feature", pattern: /\b(freesip|spout|straw|lid|cap|sipping|drinking|sip|design)\b/i },
  { role: "insulation", pattern: /\b(insulat|keep.*(cold|hot)|temperature|thermos|double-wall|vacuum)\b/i },
  { role: "usage", pattern: /\b(carry|travel|commute|outdoor|gym|hike|school|kids|child|portable|on the go)\b/i },
];

export function extractProductFactCandidatesFromContent(
  sellingPointsRaw: string | null | undefined,
): ProjectedFactCandidate[] {
  if (!sellingPointsRaw) return [];
  const candidates: ProjectedFactCandidate[] = [];
  const seen = new Set<string>();

  // 按句/行拆分卖点
  const sentences = sellingPointsRaw
    .split(/\n|[.;。；!！?？]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15 && s.length <= 220);

  for (const sentence of sentences) {
    for (const { role, pattern } of CONTENT_ROLE_PATTERNS) {
      if (!pattern.test(sentence)) continue;
      const dedupeKey = `${role}:${sentence.slice(0, 60).toLocaleLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      candidates.push({
        field: role === "insulation" ? "functional_feature" : role,
        label: role === "insulation" ? "功能特点" : role === "care" ? "清洁保养" : role === "construction" ? "结构与做工" : role === "usage" ? "使用场景" : role === "compatibility" ? "兼容性" : role === "included_components" ? "随附组件" : "功能特点",
        value: sentence,
        candidateKind: "ai_extracted",
        sourceField: "产品卖点",
        sourceSnippet: sentence.slice(0, 160),
        role,
      });
      break; // 每句只取第一个命中角色
    }
  }
  return candidates.slice(0, 8);
}

/** 综合投影：structured + content 候选（供 UI 展示/确认入口） */
export function projectSellerSpriteFactCandidates(input: {
  detailAttributesRaw: string | null | undefined;
  skuRaw: string | null | undefined;
  sellingPointsRaw: string | null | undefined;
}): { structured: ProjectedFactCandidate[]; content: ProjectedFactCandidate[]; unmapped: Array<{ key: string; value: string }> } {
  const structured = projectStructuredCandidates(input.detailAttributesRaw, input.skuRaw);
  const content = extractProductFactCandidatesFromContent(input.sellingPointsRaw);
  return {
    structured: structured.candidates,
    content,
    unmapped: structured.unmapped,
  };
}
