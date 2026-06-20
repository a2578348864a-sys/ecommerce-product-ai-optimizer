type ConfidenceConfirmationCardProps = {
  confidence?: string | null;
  assumptions?: string[];
  confirmations?: string[];
};

const fallbackAssumptions = [
  "采购价、售价、物流、广告成本可能为估算。",
  "AI 基于当前输入信息判断，信息越少越保守。",
  "平台规则和认证要求需要人工复查。",
];

const fallbackConfirmations = [
  "是否涉及认证、侵权、儿童用品、食品接触、带电、带磁。",
  "供应商资质和真实报价。",
  "目标平台最新规则。",
];

function normalizeConfidence(value: string | null | undefined) {
  const text = (value || "").trim();
  if (text.includes("高")) return "高";
  if (text.includes("中")) return "中";
  if (text.includes("低")) return "低";
  return "中";
}

function cleanItems(items: string[] | undefined, fallback: string[]) {
  const cleaned = (items || []).map((item) => item.trim()).filter(Boolean);
  return cleaned.length ? cleaned.slice(0, 4) : fallback;
}

export function ConfidenceConfirmationCard({
  confidence,
  assumptions,
  confirmations,
}: ConfidenceConfirmationCardProps) {
  const confidenceLabel = normalizeConfidence(confidence);
  const assumptionItems = cleanItems(assumptions, fallbackAssumptions);
  const confirmationItems = cleanItems(confirmations, fallbackConfirmations);

  return (
    <section className="rounded-2xl border border-teal-200 bg-teal-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-950">可信度与人工确认</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            AI 结果仅供初筛，关键动作必须由人工确认后再继续。
          </p>
        </div>
        <span className="rounded-full border border-teal-200 bg-white px-3 py-1 text-sm font-bold text-teal-700">
          当前可信度：{confidenceLabel}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-teal-100 bg-white/85 p-3">
          <p className="text-xs font-bold text-slate-500">主要假设</p>
          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">
            {assumptionItems.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-amber-100 bg-white/85 p-3">
          <p className="text-xs font-bold text-slate-500">必须人工确认</p>
          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">
            {confirmationItems.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
