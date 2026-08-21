"use client";

/**
 * V4 P2 — 市场报告面板（Lead 集成）。
 * 展示 MarketResearchReport：分节句子 + evidenceRefs + 缺口 + 冲突 + 未知。
 */
export type ReportSentenceView = { text: string; evidenceRefs: string[]; kind: string };
export type ReportSectionView = { title: string; sentences: ReportSentenceView[] };
export type ReportView = {
  reportId: string;
  summary: string;
  sections: ReportSectionView[];
  gaps: { question: string; reason: string }[];
  conflicts: { evidenceA: string; evidenceB: string; field: string }[];
  unknowns: string[];
  planRevision: number;
};

export function ReportPanel({ report }: { report: ReportView | null }) {
  if (!report) return null;
  return (
    <section className="surface-card p-4 sm:p-5" data-testid="v4-report-panel">
      <header className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">市场研究报告</h2>
        <span className="rounded bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">计划 rev.{report.planRevision}</span>
      </header>
      <p className="muted-text mt-2 text-sm leading-6">{report.summary}</p>
      {report.sections.map((section) => (
        <div key={section.title} className="mt-4">
          <h3 className="text-sm font-semibold text-teal-700">{section.title}</h3>
          <ul className="mt-2 space-y-1.5">
            {section.sentences.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className={"mt-1.5 size-1.5 shrink-0 rounded-full " + (s.kind === "factual" ? "bg-teal-500" : s.kind === "conflict" ? "bg-amber-500" : "bg-slate-300")} />
                <span>
                  {s.text}
                  {s.evidenceRefs.length > 0 && (
                    <span className="ml-2 text-xs text-slate-400">[{s.evidenceRefs.join(", ")}]</span>
                  )}
                  {s.kind !== "factual" && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{s.kind}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {report.gaps.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <h3 className="text-sm font-semibold text-amber-700">缺口（{report.gaps.length}）</h3>
          <ul className="mt-1 list-inside list-disc text-sm text-slate-600">
            {report.gaps.map((g, i) => <li key={i}>{g.question} <span className="text-xs text-slate-400">（{g.reason}）</span></li>)}
          </ul>
        </div>
      )}
      {report.unknowns.length > 0 && (
        <p className="muted-text mt-3 text-xs">未知项：{report.unknowns.join("；")}</p>
      )}
    </section>
  );
}
