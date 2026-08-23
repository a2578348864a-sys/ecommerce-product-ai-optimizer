/**
 * 公网 HR 演示案例 —— 只读脱敏快照模型。
 * 数据来自 data/public-showcase/thermos-case.json（由真实研究任务只读提取并脱敏）。
 * 供公网首页/案例页使用；禁止出现内部标识、运行细节与技术英文术语。
 */
import caseJson from "../../data/public-showcase/thermos-case.json";

export type ShowcaseField = { label: string; value: string };

export type PublicShowcaseCase = {
  title: string;
  market: string;
  asin: string;
  image: { src: string; alt: string };
  conclusion: string;
  overviewSummary: { note: string; fields: ShowcaseField[] };
  keywords: {
    source: string;
    count: number;
    note: string;
    rows: Array<{ keyword: string; translation: string | null; monthly: string | null; purchase: string | null; competition: string | null; category: string }>;
  };
  competitors: {
    count: number;
    rows: Array<{ asin: string; name: string; category: string; note: string | null }>;
    note: string;
    savedAt: string;
  };
  marketModule: { story: string[]; estimates: string[]; gaps: string[] };
  buyerDemand: {
    sampleCount: string;
    starNote: string;
    positive: string[];
    pain: string[];
    scenes: string[];
    weak: string[];
  };
  supplyMatch: { content: string[]; confirmation: string; gaps: string[] };
  costRisk: { risks: string[]; gaps: string[]; note: string };
  humanDecision: { label: string; reason: string; decidedAt: string };
  listing: {
    status: string;
    draftTitle: string | null;
    draftBullets: string[];
    keywords: string[];
    note: string;
    keywordsSource: string;
    missingFacts: string[];
    reviewChecklist: string[];
  };
  imageCheck: { items: Array<{ type: string; size: string; status: string }>; status: string; disclaimer: string };
  sourceNote: string;
};

export function loadPublicShowcaseCase(): PublicShowcaseCase {
  return caseJson as PublicShowcaseCase;
}

/**
 * 案例完整性硬门槛（目标任务书 §三）：返回缺失/不合格项；空数组 = 通过。
 */
export function completenessIssues(c: PublicShowcaseCase): string[] {
  const issues: string[] = [];
  if (!/THERMOS FUNTAINER/.test(c.title)) issues.push("商品名称不是 THERMOS FUNTAINER");
  if (c.market !== "美国站") issues.push("市场不是美国站");
  if (!/^\/public-showcase\/.+/.test(c.image.src)) issues.push("商品图不是同源资产");
  if (c.overviewSummary.fields.length < 12) issues.push("商品概览不足 12 项");
  if (c.marketModule.story.length + c.marketModule.estimates.length + c.marketModule.gaps.length === 0) issues.push("市场机会无内容");
  if (!c.buyerDemand.sampleCount) issues.push("买家评论无样本");
  if (c.supplyMatch.content.length + c.supplyMatch.gaps.length === 0) issues.push("货源与商品匹配无内容");
  if (c.costRisk.risks.length + c.costRisk.gaps.length === 0) issues.push("成本与风险无内容");
  if (!c.humanDecision.label) issues.push("无人决定");
  if (!c.listing.draftTitle) issues.push("无 Listing 草稿标题");
  if (c.listing.draftBullets.length < 3) issues.push("Listing 草稿五点少于 3 条");
  if (c.imageCheck.items.length === 0) issues.push("无图片检查状态");
  return issues;
}

/**
 * Listing 质量校验（轮 15）：标题品牌不重复、五点须为 3–5 条完整句子、无 1–2 词事实碎片。
 */
export function listingQualityCheck(c: PublicShowcaseCase): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const title = c.listing.draftTitle || "";
  const brandCount = (title.match(/THERMOS/gi) || []).length;
  if (brandCount > 1) reasons.push("标题重复品牌名（THERMOS 出现 " + brandCount + " 次）");
  const bullets = c.listing.draftBullets || [];
  if (bullets.length < 3 || bullets.length > 5) reasons.push("五点数量 " + bullets.length + " 条，不在 3–5 条范围");
  for (const b of bullets) {
    const trimmed = String(b).trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length <= 2 || trimmed.length < 12) reasons.push("存在事实碎片：" + JSON.stringify(trimmed));
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * 禁止术语（公网可见内容与技术英文/内部枚举，目标任务书 §五）。
 */
export const BANNED_TERMS = [
  "V4",
  "Replay",
  "Evidence",
  "Gate",
  "Human Decision",
  "Opportunity",
  "Market Research",
  "SupplierClaim",
  "Content Guard",
  "Bundle",
  "Run",
  "blocked",
  "unknown",
  "no_results",
  "continue_sourcing",
  "content_ready",
  "approve_export",
  "taskId",
  "candidateId",
  "productKey",
  "bundleId",
  "evidenceRef",
  "schema",
  "revision",
  "hash",
];

/** 扫描文本中的禁止术语（大小写不敏感，按子串）；返回命中列表。 */
export function scanBannedTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_TERMS.filter((term) => lower.includes(term.toLowerCase()));
}
