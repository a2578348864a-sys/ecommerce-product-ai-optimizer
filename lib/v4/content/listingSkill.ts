/**
 * V4 P5 — Listing Skill：claims 生成器 + factRefs/keywordRefs 绑定（Owner A，D3）。
 *
 * 原则（对齐 07 / CONTENT_SKILLS_SPEC / P5_CONTRACT D3、D7）：
 * - 只从「已确认事实」（FactRecord.status === "confirmed" 且有 confirmationMethod）
 *   生成自有 claim；SupplierClaim / 竞品 / VOC / unknown / conflict 一律不生成。
 * - 每条 claim 绑定一个或多个 factRefs；每个关键词绑定 evidenceRefs。
 * - handoff.forbidden 中的词不进入草稿（命中事实被跳过并记 warning）。
 * - 本模块是确定性生成器：不调用 LLM、不读外部信源、不做付费调用。
 *   语言表达用中性模板把已确认数值原样落进文案，避免虚构。
 */
import "server-only";

import type { ContentHandoff } from "./handoff";
import type { PolicyPack } from "./policyPack";
import type { ComplianceIssue } from "./complianceGuard";

export const LISTING_DRAFT_SCHEMA = "listing-draft.v1" as const;

export type ListingFactStatus = "confirmed" | "rejected" | "unknown" | "conflict" | "revoked";

/** 输入事实：与 factStore.ts 的 FactRecord 结构兼容，另加可选 claimType 以区分来源。 */
export type ListingFactInput = {
  id: string;
  field: string;
  value: string;
  status: ListingFactStatus | "supplier_claim";
  confirmationMethod?: string | null;
  claimType?: "confirmed" | "supplier_claim" | "competitor" | "voc" | "unknown";
  variantKey?: string;
  claimRefs?: string[];
  documentRefs?: string[];
  evidenceRefs?: string[];
};

/** 一条可验证产品主张：text 为文案片段，factRefs 指向已确认事实 id。 */
export type ListingClaimSpan = {
  text: string;
  factRefs: string[];
};

/** 一个被放置的关键词及其证据引用。 */
export type ListingKeyword = {
  term: string;
  evidenceRefs: string[];
};

export type ListingFieldName = "title" | "bullets" | "description" | "search_terms";

export type ListingField = {
  name: ListingFieldName;
  /** 字段完整文本（bullets 用换行连接，search_terms 用空格连接）。 */
  text: string;
  /** 事实性 claim 片段；语言优化/结构文本不要求进入 claims。 */
  claims: ListingClaimSpan[];
  /** 本字段放置关键词时所引用的证据 id（search_terms 才有）。 */
  keywordRefs: string[];
};

export type ListingDraft = {
  schemaVersion: typeof LISTING_DRAFT_SCHEMA;
  variant: string;
  marketplace: string;
  category: string;
  locale: string;
  factRevision: number;
  policyPackVersion: string;
  fields: ListingField[];
  /** 已落入草稿的关键词（每个都带 evidenceRefs）。 */
  keywords: ListingKeyword[];
  /** 因缺少 evidenceRefs 而未使用的关键词（不进入草稿）。 */
  unusedKeywords: ListingKeyword[];
};

export type GenerateListingDraftInput = {
  handoff: ContentHandoff;
  facts: ListingFactInput[];
  keywords?: ListingKeyword[];
  policyPack?: PolicyPack | null;
};

export type GenerateListingResult = {
  draft: ListingDraft;
  issues: ComplianceIssue[];
  blocked: boolean;
};

/** 只允许「已确认人工事实」（status=confirmed + confirmationMethod；若给了 claimType 则须为 confirmed）。 */
export function isConfirmedListingFact(fact: ListingFactInput): boolean {
  if (fact.status !== "confirmed") return false;
  if (!fact.confirmationMethod) return false;
  if (fact.claimType != null && fact.claimType !== "confirmed") return false;
  return true;
}

/** true 表示该事实属于「值敏感」字段——Guard 会强制 claim 文本包含该事实值（用于拦截错颜色/错数量）。 */
export function isValueSensitiveField(field: string): boolean {
  const f = field.toLowerCase().replace(/[\s_-]+/g, "").trim();
  return [
    "color",
    "colour",
    "quantity",
    "count",
    "packagecount",
    "packagequantity",
    "capacity",
    "weight",
    "dimensions",
    "size",
    "material",
    "accessorycount",
    "packcount",
  ].includes(f);
}

/** 标题身份字段（产物名/款式），非身份用首位事实兜底。 */
const IDENTITY_FIELDS = new Set(["product_name", "productname", "name", "title", "item_name", "itemname", "product", "variant"]);

const LABELS: Record<string, string> = {
  material: "Material",
  color: "Color",
  colour: "Color",
  quantity: "Quantity",
  count: "Count",
  package_count: "Package content",
  package_quantity: "Package quantity",
  capacity: "Capacity",
  weight: "Weight",
  dimensions: "Dimensions",
  size: "Size",
  uses: "Use",
  use: "Use",
  feature: "Feature",
  benefit: "Benefit",
  finish: "Finish",
  warranty: "Warranty",
  special_feature: "Feature",
};

function humanize(field: string): string {
  const key = field.toLowerCase().replace(/[\s_-]+/g, "_");
  if (LABELS[key]) return LABELS[key];
  return field.charAt(0).toUpperCase() + field.slice(1);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\uFF0C\uFF0E]+/gu, " ").replace(/\s+/g, " ").trim();
}

function containsForbidden(text: string, forbidden: string[]): string | null {
  const t = normalize(text);
  for (const f of forbidden) {
    const n = normalize(f);
    if (n && t.includes(n)) return f;
  }
  return null;
}

/** 生成一条 bullet 文案（保证把已确认数值原样落进去，便于 Guard 逐值比对）。 */
function bulletText(field: string, value: string): string {
  const label = humanize(field);
  return label + ": " + value.trim();
}

function descriptionSentence(field: string, value: string): string {
  return humanize(field) + ": " + value.trim() + ".";
}

function emptyDraft(handoff: ContentHandoff): ListingDraft {
  return {
    schemaVersion: LISTING_DRAFT_SCHEMA,
    variant: handoff.variant,
    marketplace: handoff.marketplace,
    category: handoff.category,
    locale: handoff.locale,
    factRevision: handoff.factRevision,
    policyPackVersion: handoff.policyPackVersion,
    fields: [],
    keywords: [],
    unusedKeywords: [],
  };
}

/**
 * 生成 Listing 草稿。
 * - 无可用已确认事实 → blocked=true，issue=NO_CONFIRMED_FACTS。
 * - 命中 handoff.forbidden 的事实被跳过并记 warning。
 * - 每个生成字段附 claims（逐 claim 绑 factRefs）与 keywordRefs（逐关键词绑 evidenceRefs）。
 */
export function generateListingDraft(input: GenerateListingDraftInput): GenerateListingResult {
  const { handoff, facts, keywords = [] } = input;
  const issues: ComplianceIssue[] = [];
  const forbidden = handoff.forbidden ?? [];

  // 1. 先按 handoff.forbidden 过滤，再判已确认。
  const confirmedBase = facts.filter((f) => !containsForbidden(f.value, forbidden));
  const skippedForbidden = facts.filter((f) => containsForbidden(f.value, forbidden));
  for (const f of skippedForbidden) {
    issues.push({
      field: f.field,
      code: "FORBIDDEN_TERM_SKIPPED",
      severity: "warning",
      message: "事实 " + f.id + " 命中 handoff 禁止词，跳过：" + f.value,
      span: { text: f.value },
    });
  }

  const usable = confirmedBase.filter(isConfirmedListingFact);

  if (usable.length === 0) {
    return {
      draft: emptyDraft(handoff),
      issues: [
        ...issues,
        {
          field: "draft",
          code: "NO_CONFIRMED_FACTS",
          severity: "error",
          message:
            "无法生成 Listing：没有可用的已确认事实（status=confirmed 且含 confirmationMethod）。竞品/SupplierClaim/VOC 不得作为自有 claim。",
        },
      ],
      blocked: true,
    };
  }

  // 2. 标题：身份事实 + 材质 + 一个值敏感属性，末尾追加类目（类目为结构文本，不要求 factRefs）。
  const identityFact = usable.find((f) => IDENTITY_FIELDS.has(f.field.toLowerCase().replace(/[\s_-]+/g, "")));
  const identityToken = identityFact
    ? { text: identityFact.value.trim(), factRefs: [identityFact.id] }
    : null;
  const materialFact = usable.find((f) => f.field.toLowerCase().replace(/[\s_-]+/g, "") === "material");
  const secondAttr = usable.find((f) => f !== identityFact && f !== materialFact && isValueSensitiveField(f.field));
  const attrFacts = [materialFact, secondAttr].filter((x): x is ListingFactInput => !!x);

  const titleClaims: ListingClaimSpan[] = [];
  const titleTokens: string[] = [];
  if (identityToken) {
    titleTokens.push(identityToken.text);
    titleClaims.push(identityToken);
  }
  for (const f of attrFacts) {
    const token = f.value.trim();
    if (!token) continue;
    if (titleTokens.includes(token)) continue;
    titleTokens.push(token);
    titleClaims.push({ text: token, factRefs: [f.id] });
  }
  const titleText = titleTokens.join(" - ") + (handoff.category ? " - " + handoff.category : "");

  // 3. Bullets：值敏感/用途字段，最多 5 条；每条为一 claim（绑 factRefs）。
  const bulletCandidates = usable
    .filter((f) => isValueSensitiveField(f.field) || /^(uses|use|feature|benefit|finish|warranty|special_feature)$/i.test(f.field.toLowerCase()))
    .slice(0, 5);
  const bulletClaims: ListingClaimSpan[] = [];
  const bulletLines: string[] = [];
  for (const f of bulletCandidates) {
    const text = bulletText(f.field, f.value);
    if (!text) continue;
    bulletLines.push(text);
    bulletClaims.push({ text, factRefs: [f.id] });
  }

  // 4. Description：逐事实成句（每句为一 claim）。
  const descFacts = usable
    .filter((f) => isValueSensitiveField(f.field) || /^(uses|use|feature|benefit|finish|warranty|special_feature)$/i.test(f.field.toLowerCase()))
    .slice(0, 5);
  const descClaims: ListingClaimSpan[] = [];
  const descSentences: string[] = [];
  for (const f of descFacts) {
    const s = descriptionSentence(f.field, f.value);
    descSentences.push(s);
    descClaims.push({ text: s, factRefs: [f.id] });
  }

  // 5. Search terms / 关键词：仅放置带 evidenceRefs 的关键词；未带证据的进 unusedKeywords。
  const placedKeywords: ListingKeyword[] = [];
  const unusedKeywords: ListingKeyword[] = [];
  for (const k of keywords) {
    if (Array.isArray(k.evidenceRefs) && k.evidenceRefs.length > 0) placedKeywords.push(k);
    else unusedKeywords.push(k);
  }
  const keywordRefs = [...new Set(placedKeywords.flatMap((k) => k.evidenceRefs))];
  const searchTermsText = placedKeywords.map((k) => k.term).join(" ");

  const fields: ListingField[] = [];
  if (titleText) fields.push({ name: "title", text: titleText, claims: titleClaims, keywordRefs: [] });
  if (bulletLines.length > 0) fields.push({ name: "bullets", text: bulletLines.join("\n"), claims: bulletClaims, keywordRefs: [] });
  if (descSentences.length > 0) fields.push({ name: "description", text: descSentences.join(" "), claims: descClaims, keywordRefs: [] });
  if (searchTermsText) fields.push({ name: "search_terms", text: searchTermsText, claims: [], keywordRefs });

  const draft: ListingDraft = {
    schemaVersion: LISTING_DRAFT_SCHEMA,
    variant: handoff.variant,
    marketplace: handoff.marketplace,
    category: handoff.category,
    locale: handoff.locale,
    factRevision: handoff.factRevision,
    policyPackVersion: handoff.policyPackVersion,
    fields,
    keywords: placedKeywords,
    unusedKeywords,
  };

  return { draft, issues, blocked: false };
}
