/**
 * Reference Listing Draft Generator
 *
 * 零费用确定性规则引擎：根据筛选出的有效参考资料，生成自然合规的英文初稿。
 * 纯函数：无外部调用 / 零费用 / 零网络 / 1~5条卖点合法输出。
 */

import type {
  ReferenceDraftReadiness,
  ReferenceListingDraft,
  ReferenceMaterialItem,
  DraftGenerationSnapshot,
  DraftAnchorCitation,
} from "./referenceDraftContract";
import { checkValueRisk, SUBSTANTIVE_FIELDS } from "./referenceMaterialFilter";

function cleanToken(s: string): string {
  return s.replace(/[,\s]+$/, "").trim();
}

function toTitleCase(str: string): string {
  if (!str) return "";
  return str
    .split(/\s+/)
    .map((word) => {
      if (/^(and|or|for|with|in|on|at|to|of|a|an|the)$/i.test(word)) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function sanitizeFallbackName(rawName?: string): string {
  if (!rawName) return "Product";
  let s = rawName.replace(/\b\d+(?:\.\d+)?\s*(?:lb|lbs|kg|g|pound|pounds|oz|ml|l)\b/gi, "");
  s = s.replace(/\b\d+\s*[-/]?\s*(?:pack|count|pcs|pieces|set)\b/gi, "");
  s = s.replace(/\b(waterproof|rustproof|food[-\s]?safe|bpa[-\s]?free|dishwasher[-\s]?safe|heavy[-\s]?duty)\b/gi, "");
  s = s.replace(/\b(best[-\s]?seller|top[-\s]?rated|hot\s+sale|100%\s+guaranteed|premium|perfect)\b/gi, "");
  s = s.replace(/[,;:/|]+/g, " ").replace(/\s{2,}/g, " ").trim();
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 5) {
    s = words.slice(0, 5).join(" ");
  }
  return s || "Product";
}

/**
 * 组装英文标题
 */
export function generateReferenceTitle(readiness: ReferenceDraftReadiness): string {
  const map = new Map<string, string>();
  for (const item of readiness.adoptedMaterials) {
    map.set(item.field, item.value);
  }

  const brand = map.get("brand") || "";
  const series = map.get("series_or_model") || "";
  const capacity = map.get("capacity") || "";
  const productType = map.get("product_type") || "";
  const color = map.get("color_or_variant") || "";
  const pack = map.get("quantity_or_pack_size") || "";

  const mainParts: string[] = [];
  if (brand) mainParts.push(brand);
  if (series && series.toLowerCase() !== brand.toLowerCase()) mainParts.push(series);
  if (capacity) mainParts.push(capacity);
  if (
    productType &&
    productType.toLowerCase() !== brand.toLowerCase() &&
    (!series || !series.toLowerCase().includes(productType.toLowerCase()))
  ) {
    mainParts.push(productType);
  }

  if (!series && !productType) {
    const fallback = sanitizeFallbackName(readiness.productName);
    if (fallback && fallback.toLowerCase() !== brand.toLowerCase()) {
      mainParts.push(fallback);
    }
  }

  let title = mainParts.join(" ");
  if (!title) {
    title = sanitizeFallbackName(readiness.productName);
  }

  const qualifiers: string[] = [];
  if (color) qualifiers.push(color);
  if (pack) qualifiers.push(pack);

  if (qualifiers.length > 0) {
    title += ", " + qualifiers.join(", ");
  }

  return cleanToken(title);
}

/**
 * 组装 1~5 条卖点（Bullet Points）
 * 每条卖点锚定一项已采用事实，绝不凭空捏造不存在的卖点，亦不强行补齐 5 条。
 */
export function generateReferenceBullets(readiness: ReferenceDraftReadiness): string[] {
  const map = new Map<string, string>();
  for (const item of readiness.adoptedMaterials) {
    map.set(item.field, item.value);
  }

  // 必须至少有一项实质规格属性（非单纯品牌/型号等身份属性）
  // 品牌（brand）、型号（series_or_model）和商品类型（product_type）仅用于标题与身份说明，绝对不能单独作为卖点
  const substantiveCount = readiness.adoptedMaterials.filter((m) =>
    SUBSTANTIVE_FIELDS.has(m.field)
  ).length;
  if (substantiveCount === 0) {
    return [];
  }

  const bullets: string[] = [];
  const pack = map.get("quantity_or_pack_size");
  const color = map.get("color_or_variant");
  const dimensions = map.get("dimensions");
  const components = map.get("included_components");
  const capacity = map.get("capacity");

  // 1. 数量/包装与随附组件（若两者皆有，合并表达；若单一，则分别陈述）
  if (pack && components) {
    bullets.push(`Package quantity: ${pack}, includes ${components}.`);
  } else if (pack) {
    bullets.push(`Package quantity: ${pack}.`);
  } else if (components) {
    bullets.push(`Included components: ${components}.`);
  }

  // 2. 颜色/款式外观
  if (color) {
    bullets.push(`Color: ${color}.`);
  }

  // 3. 尺寸规格
  if (dimensions) {
    bullets.push(`Dimensions: ${dimensions}.`);
  }

  // 4. 容量规格（若有）
  if (capacity) {
    bullets.push(`Capacity: ${capacity}.`);
  }

  return bullets.slice(0, 5);
}

/**
 * 组装简要英文描述（Description）
 * 严格基于已采用规格，禁止任何未证实的营销扩写或空泛承诺
 */
export function generateReferenceDescription(readiness: ReferenceDraftReadiness): string {
  const map = new Map<string, string>();
  for (const item of readiness.adoptedMaterials) {
    map.set(item.field, item.value);
  }

  const brand = map.get("brand");
  const series = map.get("series_or_model");
  const adoptedType = map.get("product_type");
  const type = adoptedType || series || sanitizeFallbackName(readiness.productName);
  const color = map.get("color_or_variant");
  const pack = map.get("quantity_or_pack_size");
  const dimensions = map.get("dimensions");
  const components = map.get("included_components");
  const capacity = map.get("capacity");

  const sentences: string[] = [];
  const subject = brand ? `The ${brand} ${type}` : `This ${type}`;

  const specClauses: string[] = [];
  if (color) specClauses.push(`color: ${color}`);
  if (pack) specClauses.push(`package quantity: ${pack}`);
  if (dimensions) specClauses.push(`dimensions: ${dimensions}`);
  if (components) specClauses.push(`included components: ${components}`);
  if (capacity) specClauses.push(`capacity: ${capacity}`);

  if (specClauses.length > 0) {
    sentences.push(`${subject} specifications: ${specClauses.join(", ")}.`);
  } else {
    sentences.push(`${subject} reference specifications.`);
  }

  return sentences.join(" ");
}

/**
 * 输出安全校验：防止敏感词、高风险承诺、套话或占位符泄露
 */
export function validateDraftContent(
  draft: {
    title: string;
    bullets: string[];
    description: string;
  },
  adoptedMaterials?: ReferenceMaterialItem[]
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  // 必须有标题
  if (!draft.title.trim()) {
    violations.push("标题为空");
  }

  // 卖点必须在 1~5 条
  if (draft.bullets.length < 1 || draft.bullets.length > 5) {
    violations.push(`卖点条数必须在 1~5 条之间（当前 ${draft.bullets.length} 条）`);
  }

  // 必须有描述
  if (!draft.description.trim()) {
    violations.push("商品描述为空");
  }

  // 检查高风险内容泄露
  const fullText = [draft.title, ...draft.bullets, draft.description].join(" ");
  const risk = checkValueRisk(fullText);
  if (risk) {
    violations.push(`文案泄露高风险声明: ${risk}`);
  }

  // 检查内部占位符或报错文本泄露
  if (/\[object Object\]|undefined|null|TODO|FIXME|__placeholder__/i.test(fullText)) {
    violations.push("文案中包含未替换的占位符或代码异常标记");
  }

  // 检查套话与未证实扩写词
  const FORBIDDEN_FLUFF = [
    /suitable for versatile home/i,
    /coordinates easily with various/i,
    /compact storage and space efficiency/i,
    /Designed by/i,
    /ready out of the box/i,
    /\bapproximately\b/i,
    /verified catalog records/i,
    /provides a practical solution for everyday household needs/i,
  ];
  for (const pattern of FORBIDDEN_FLUFF) {
    if (pattern.test(fullText)) {
      violations.push(`文案包含未证实的营销扩写或套话: ${pattern}`);
    }
  }

  // 校验已采纳规格值的一致性，拦截数值与颜色篡改
  if (adoptedMaterials && adoptedMaterials.length > 0) {
    const adoptedMap = new Map<string, string>();
    const allAdoptedValues: string[] = [];
    for (const m of adoptedMaterials) {
      adoptedMap.set(m.field, m.value.toLowerCase());
      allAdoptedValues.push(m.value.toLowerCase());
    }
    const combinedAdopted = allAdoptedValues.join(" ");

    // 1. 检查数量/包装数值篡改
    const packMatches = fullText.matchAll(/\b(\d+)\s*[-/]?\s*(?:pack|count|pcs|pieces|set)\b/gi);
    for (const match of packMatches) {
      const num = match[1];
      const adoptedPack = adoptedMap.get("quantity_or_pack_size") || "";
      const adoptedNums = Array.from(adoptedPack.matchAll(/\b\d+\b/g)).map((m) => m[0]);
      if (adoptedNums.length > 0 && !adoptedNums.includes(num)) {
        violations.push(`文案包含未采纳的数量/包装数值 (${num})，可能存在篡改`);
      }
    }

    // 2. 检查颜色篡改
    const COLOR_WORDS = [
      "black", "white", "silver", "gold", "gray", "grey", "red", "blue",
      "green", "yellow", "purple", "pink", "orange", "brown", "bronze", "beige"
    ];
    const colorRegex = new RegExp(`\\b(${COLOR_WORDS.join("|")})\\b`, "gi");
    const colorMatches = fullText.matchAll(colorRegex);
    for (const match of colorMatches) {
      const colorFound = match[1].toLowerCase();
      if (!combinedAdopted.includes(colorFound)) {
        violations.push(`文案包含未采纳的颜色规格 (${match[1]})，可能存在篡改`);
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * 主入口：生成参考初稿
 */
export function generateReferenceListingDraft(
  readiness: ReferenceDraftReadiness,
  taskId: string,
): ReferenceListingDraft {
  const substantiveCount = readiness.adoptedMaterials.filter((m) =>
    SUBSTANTIVE_FIELDS.has(m.field)
  ).length;

  const nowIso = new Date().toISOString();
  const emptySnapshot: DraftGenerationSnapshot = {
    productName: readiness.productName,
    market: readiness.market,
    asin: readiness.asin,
    sourceFingerprint: readiness.sourceFingerprint,
    adoptedMaterials: [...readiness.adoptedMaterials],
    excludedMaterials: [...readiness.excludedMaterials],
    generatedBy: "local_rules",
    generatedAt: nowIso,
  };

  if (readiness.status !== "ready" || substantiveCount === 0 || readiness.adoptedMaterials.length === 0) {
    return {
      schema: "reference-listing-draft.v1",
      version: 1,
      status: "insufficient",
      taskId,
      productName: readiness.productName,
      market: readiness.market,
      asin: readiness.asin,
      title: "",
      bullets: [],
      description: "",
      adoptedMaterials: readiness.adoptedMaterials,
      excludedMaterials: readiness.excludedMaterials,
      generationSnapshot: emptySnapshot,
      anchoredCitations: [],
      generatedBy: "local_rules",
      humanReviewRequired: true,
      badgeLabel: "研究对象参考初稿 · 基于采集资料，待人工复核",
      sourceFingerprint: readiness.sourceFingerprint,
      generatedAt: nowIso,
      warningNotice: readiness.reason || "缺少足够的基础规格事实（颜色/尺寸/包装等），无法生成客观参考初稿",
      accessSubject: readiness.accessSubject,
    };
  }

  const title = generateReferenceTitle(readiness);
  const bullets = generateReferenceBullets(readiness);
  const description = generateReferenceDescription(readiness);

  const validation = validateDraftContent({ title, bullets, description }, readiness.adoptedMaterials);
  if (!validation.valid) {
    throw new Error(`参考初稿安全校验未通过: ${validation.violations.join("; ")}`);
  }

  const citations: DraftAnchorCitation[] = [];
  for (const item of readiness.adoptedMaterials) {
    const matchingBullet = bullets.find((b) => b.toLowerCase().includes(item.value.toLowerCase()));
    citations.push({
      text: matchingBullet || title,
      field: item.field,
      value: item.value,
    });
  }

  const generationSnapshot: DraftGenerationSnapshot = {
    productName: readiness.productName,
    market: readiness.market,
    asin: readiness.asin,
    sourceFingerprint: readiness.sourceFingerprint,
    adoptedMaterials: [...readiness.adoptedMaterials],
    excludedMaterials: [...readiness.excludedMaterials],
    generatedBy: "local_rules",
    generatedAt: nowIso,
  };

  return {
    schema: "reference-listing-draft.v1",
    version: 1,
    status: "ready",
    taskId,
    productName: readiness.productName,
    market: readiness.market,
    asin: readiness.asin,
    title,
    bullets,
    description,
    adoptedMaterials: readiness.adoptedMaterials,
    excludedMaterials: readiness.excludedMaterials,
    generationSnapshot,
    anchoredCitations: citations,
    generatedBy: "local_rules",
    humanReviewRequired: true,
    badgeLabel: "研究对象参考初稿 · 基于采集资料，待人工复核",
    sourceFingerprint: readiness.sourceFingerprint,
    generatedAt: nowIso,
    accessSubject: readiness.accessSubject,
  };
}
