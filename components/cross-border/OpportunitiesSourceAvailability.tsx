import { SOURCE_IMPORT_TIERS } from "@/lib/client/sourceImportLabels";

export function OpportunitiesSourceAvailability() {
  return (
    <details className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-xs">
      <summary className="cursor-pointer font-semibold text-slate-600 select-none">来源可用性说明</summary>
      <div className="mt-3 space-y-3">
        {SOURCE_IMPORT_TIERS.map((tier) => (
          <div key={tier.key} className={`rounded-lg border p-2.5 ${
            tier.tone === "green" ? "border-emerald-200 bg-emerald-50/60" :
            tier.tone === "amber" ? "border-amber-200 bg-amber-50/60" :
            tier.tone === "blue" ? "border-blue-200 bg-blue-50/60" :
            "border-slate-200 bg-slate-50/60"
          }`}>
            <p className="font-semibold text-slate-700">{tier.name} · {tier.description}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {tier.examples.map((ex) => (
                <span key={ex.label} className="inline-flex items-center rounded-full bg-white/70 px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
                  {ex.label}
                </span>
              ))}
            </div>
            <p className="mt-1 text-slate-400">{tier.recommendation}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
