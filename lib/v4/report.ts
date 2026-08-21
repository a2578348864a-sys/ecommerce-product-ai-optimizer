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
