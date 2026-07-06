import type { DecisionEvidenceItem, DecisionEvidenceSnapshot, EvidenceKind, EvidenceStatus, EvidenceSourceType, MissingPriority } from "@/lib/decisionEvidence";

const KIND_LABELS: Record<EvidenceKind, string> = {
  fact: "已确认事实",
  user_input: "用户输入",
  calculation: "代码计算",
  rule: "规则检查",
  ai_inference: "AI辅助推断",
  missing: "待补数据",
  conflict: "信息冲突",
  human_decision: "人工决定",
};

const STATUS_LABELS: Record<EvidenceStatus, string> = {
  confirmed: "已确认",
  unverified: "未核实",
  estimated: "估算值",
  needs_review: "待复核",
  missing: "缺失",
  conflicting: "冲突",
};

const SOURCE_TYPE_LABELS: Record<EvidenceSourceType, string> = {
  user: "用户输入",
  candidate: "候选记录",
  product_url: "商品链接",
  system_rule: "系统规则",
  calculation: "系统计算",
  ai: "AI辅助推断",
  historical_snapshot: "历史快照",
  unknown: "来源未知",
};

const MISSING_PRIORITY_LABELS: Record<MissingPriority, string> = {
  critical: "关键缺失",
  suggested: "建议补充",
  not_applicable: "当前不适用",
};

const MISSING_PRIORITY_TONES: Record<MissingPriority, string> = {
  critical: "text-rose-700 font-bold",
  suggested: "text-amber-700",
  not_applicable: "text-slate-500",
};

const KIND_TONES: Record<EvidenceKind, string> = {
  fact: "border-emerald-200 bg-emerald-50 text-emerald-700",
  user_input: "border-sky-200 bg-sky-50 text-sky-700",
  calculation: "border-indigo-200 bg-indigo-50 text-indigo-700",
  rule: "border-amber-200 bg-amber-50 text-amber-700",
  ai_inference: "border-violet-200 bg-violet-50 text-violet-700",
  missing: "border-slate-200 bg-slate-50 text-slate-600",
  conflict: "border-rose-200 bg-rose-50 text-rose-700",
  human_decision: "border-teal-200 bg-teal-50 text-teal-700",
};

function formatValue(value: DecisionEvidenceItem["value"]) {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.join(" / ");
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function countByKind(items: DecisionEvidenceItem[], kind: EvidenceKind) {
  return items.filter((item) => item.kind === kind).length;
}

function EvidenceRow({ item }: { item: DecisionEvidenceItem }) {
  const value = formatValue(item.value);
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${KIND_TONES[item.kind]}`}>
          {KIND_LABELS[item.kind]}
        </span>
        <span className="text-xs font-semibold text-slate-400">{item.sourceLabel || SOURCE_TYPE_LABELS[item.sourceType] || item.sourceType}</span>
        <span className="text-xs font-semibold text-slate-400">{STATUS_LABELS[item.status] || item.status}</span>
      </div>
      <p className="mt-2 text-sm font-bold text-slate-900">{item.label}</p>
      {value ? <p className="mt-1 break-words text-sm leading-6 text-slate-700">{value}</p> : null}
      <p className="mt-1 text-sm leading-6 text-slate-600">{item.summary}</p>
      {item.assumptions?.length ? (
        <p className="mt-1 text-xs leading-5 text-slate-500">前提：{item.assumptions.slice(0, 3).join("；")}</p>
      ) : null}
      {item.verificationNote ? (
        <p className="mt-1 text-xs leading-5 text-slate-500">核实说明：{item.verificationNote}</p>
      ) : null}
      {item.sourceUrl ? (
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block break-all text-xs font-semibold text-teal-700 underline">
          查看来源
        </a>
      ) : null}
    </div>
  );
}

export function DecisionEvidencePanel({
  evidence,
  compact = false,
}: {
  evidence: DecisionEvidenceSnapshot | null;
  compact?: boolean;
}) {
  if (!evidence) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="decision-evidence-fallback">
        <p className="text-sm font-bold text-slate-700">决策证据链</p>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          历史任务未保存完整证据元数据。系统不会倒推或伪造历史来源，请以旧版记录和人工复核为准。
        </p>
      </section>
    );
  }

  const keyItems = evidence.items
    .filter((item) => item.kind !== "missing" && item.kind !== "conflict")
    .slice(0, compact ? 4 : 8);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="decision-evidence-panel">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-bold text-slate-900">决策证据链</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            区分事实、用户假设、代码计算、规则检查、AI 推断和人工决定。没有来源的信息会标记为待补或 unknown。
          </p>
        </div>
        <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {evidence.version}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {([
          "fact",
          "user_input",
          "calculation",
          "rule",
          "ai_inference",
          "missing",
          "human_decision",
        ] as EvidenceKind[]).map((kind) => (
          <span key={kind} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${KIND_TONES[kind]}`}>
            {KIND_LABELS[kind]} {countByKind(evidence.items, kind)}
          </span>
        ))}
        {evidence.conflicts.length ? (
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${KIND_TONES.conflict}`}>
            信息冲突 {evidence.conflicts.length}
          </span>
        ) : null}
      </div>

      {evidence.humanDecision ? (
        <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/70 p-3">
          <p className="text-xs font-bold text-teal-700">人工最终决定</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{evidence.humanDecision.statusLabel}</p>
          <p className="mt-1 text-sm leading-6 text-slate-700">{evidence.humanDecision.reason}</p>
          <p className="mt-1 text-xs leading-5 text-teal-700">下一步：{evidence.humanDecision.nextAction}</p>
        </div>
      ) : null}

      <div className={`mt-4 grid gap-3 ${compact ? "lg:grid-cols-2" : "lg:grid-cols-2 xl:grid-cols-3"}`}>
        {keyItems.map((item) => <EvidenceRow key={item.id} item={item} />)}
      </div>

      {evidence.missingData.length ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-xs font-bold text-amber-700">决策前仍需补充</p>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-amber-900">
            {evidence.missingData.slice(0, 8).map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                {item.missingPriority ? (
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${MISSING_PRIORITY_TONES[item.missingPriority]} border-current/30`}>
                    {MISSING_PRIORITY_LABELS[item.missingPriority]}
                  </span>
                ) : null}
                <span>- {item.label}：{item.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {evidence.conflicts.length ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/70 p-3">
          <p className="text-xs font-bold text-rose-700">信息冲突</p>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-rose-900">
            {evidence.conflicts.map((item) => (
              <li key={item.id}>- {item.summary}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
