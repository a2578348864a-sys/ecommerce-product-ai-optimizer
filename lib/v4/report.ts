/**
 * V4 P2 — 市场研究报告（Lead 冻结）。
 * Evidence 合并（校验后）→ 市场报告；factual sentence 必须 100% evidenceRefs（硬指标）。
 */
import "server-only";

export type EvidenceItemV2 = {
  evidenceId: string;
  type: "amazon_page" | "keyword" | "voc" | "sellersprite" | "competitor" | "synthetic";
  entity: string;
  marketplace: string;
  observedAt: string;
  sourceRef: string; // rawArtifactRef 或现有 Evidence 引用
  fields: Record<string, unknown>;
  rawRef?: string;
  warnings: string[];
};

export type ReportSentence = {
  text: string;
  evidenceRefs: string[]; // 必须非空（factual）
  kind: "factual" | "unknown" | "conflict" | "assumption";
};

export type MarketResearchReport = {
  reportId: string;
  runId: string;
  candidateId: string;
  marketplace: string;
  generatedAt: string;
  summary: string;
  sections: { title: string; sentences: ReportSentence[] }[];
  gaps: { question: string; reason: string }[];
  conflicts: { evidenceA: string; evidenceB: string; field: string }[];
  unknowns: string[];
  evidence: EvidenceItemV2[];
  planRevision: number;
};

/** factual sentence 必须至少一个 evidenceRef；非 factual 明确标注。 */
export function validateReportCitations(report: MarketResearchReport): { ok: true } | { ok: false; offenders: { section: string; index: number; text: string }[] } {
  const offenders: { section: string; index: number; text: string }[] = [];
  for (const section of report.sections) {
    section.sentences.forEach((s, i) => {
      if (s.kind === "factual" && (!s.evidenceRefs || s.evidenceRefs.length === 0)) {
        offenders.push({ section: section.title, index: i, text: s.text.slice(0, 80) });
      }
    });
  }
  return offenders.length === 0 ? { ok: true } : { ok: false, offenders };
}

/** Evidence 合并前置校验：Schema/实体/单位/来源/时间。 */
export function validateEvidenceForMerge(item: EvidenceItemV2): { ok: true } | { ok: false; reason: string } {
  if (!item.evidenceId || !item.type || !item.entity || !item.marketplace) return { ok: false, reason: "missing_identity" };
  if (!item.observedAt || Number.isNaN(Date.parse(item.observedAt))) return { ok: false, reason: "invalid_observedAt" };
  if (!item.sourceRef) return { ok: false, reason: "missing_source" };
  if (item.fields && typeof item.fields !== "object") return { ok: false, reason: "fields_not_object" };
  return { ok: true };
}

/** 由已验证 Evidence 构建市场报告（factual sentence 全部带 evidenceRefs）。 */
export function buildMarketReport(input: {
  reportId: string;
  runId: string;
  candidateId: string;
  marketplace: string;
  evidence: EvidenceItemV2[];
  gaps: { question: string; reason: string }[];
  planRevision: number;
}): MarketResearchReport {
  const sections: { title: string; sentences: ReportSentence[] }[] = [];
  const grouped = new Map<string, EvidenceItemV2[]>();
  for (const item of input.evidence) {
    const list = grouped.get(item.type) ?? [];
    list.push(item);
    grouped.set(item.type, list);
  }
  for (const [type, items] of grouped.entries()) {
    const title =
      type === "amazon_page" ? "Amazon 页面证据" :
      type === "keyword" ? "关键词证据" :
      type === "voc" ? "评论与 VOC" :
      type === "sellersprite" ? "SellerSprite 市场指标" : "其他证据";
    const sentences: ReportSentence[] = items.map((item) => {
      const asin = typeof item.fields?.asin === "string" ? String(item.fields.asin) : item.entity;
      const price = item.fields?.price;
      const rating = item.fields?.rating;
      const parts: string[] = [];
      if (price !== undefined) parts.push(`可见价格 ${price}`);
      if (rating !== undefined) parts.push(`评分 ${rating}`);
      if (typeof item.fields?.reviewCount === "number") parts.push(`评论数 ${item.fields.reviewCount}`);
      const base = parts.length ? parts.join("，") : "存在采集记录";
      return {
        text: `${asin}：${base}。`,
        evidenceRefs: [item.evidenceId],
        kind: "factual",
      };
    });
    sections.push({ title, sentences });
  }
  if (input.gaps.length) {
    sections.push({
      title: "缺口",
      sentences: input.gaps.map((gap) => ({ text: gap.question, evidenceRefs: [], kind: "unknown" })),
    });
  }
  return {
    reportId: input.reportId,
    runId: input.runId,
    candidateId: input.candidateId,
    marketplace: input.marketplace,
    generatedAt: new Date().toISOString(),
    summary: `市场研究报告（${input.evidence.length} 条已验证证据，${input.gaps.length} 项缺口）。`,
    sections,
    gaps: input.gaps,
    conflicts: [],
    unknowns: input.gaps.map((g) => g.question),
    evidence: input.evidence,
    planRevision: input.planRevision,
  };
}
