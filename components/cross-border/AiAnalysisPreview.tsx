"use client";

import type {
  AiAnalysisResult,
  CrossBorderProductFormInput,
  StructuredListingData,
} from "@/lib/types";

type AiAnalysisPreviewProps = {
  form: CrossBorderProductFormInput;
  listingData: StructuredListingData;
  analysis?: AiAnalysisResult | null;
  loading?: boolean;
  error?: string | null;
  onGenerate?: () => void;
};

const recommendationLabels: Record<AiAnalysisResult["recommendation"], string> = {
  recommend: "建议尝试",
  caution: "谨慎上架",
  reject: "不建议上架",
};

const recommendationClasses: Record<AiAnalysisResult["recommendation"], string> = {
  recommend: "border-emerald-200 bg-emerald-50 text-emerald-700",
  caution: "border-amber-200 bg-amber-50 text-amber-700",
  reject: "border-red-200 bg-red-50 text-red-700",
};

function pendingText(value?: string | number | boolean) {
  if (typeof value === "boolean") return value ? "适合新手" : "不太适合新手";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "待生成";
  return value?.trim() || "待生成";
}

function ListBlock({ label, items }: { label: string; items?: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      {items?.length ? (
        <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-800">
          {items.map((item) => (
            <li key={item}>- {item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm leading-6 text-slate-500">等待接入 AI 后生成</p>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-sm leading-6 text-slate-800">{value}</p>
    </div>
  );
}

export function AiAnalysisPreview({
  form,
  listingData,
  analysis,
  loading = false,
  error,
  onGenerate,
}: AiAnalysisPreviewProps) {
  const hasAnalysis = Boolean(analysis);
  const buttonText = loading
    ? "AI 分析中..."
    : hasAnalysis
      ? "重新生成 AI 分析"
      : "生成 AI 选品分析";

  return (
    <section className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-700">AI 选品分析</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">
            {hasAnalysis ? "AI 结构化分析结果" : "根据商品、利润和平台生成分析"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            AI 结果仅供运营参考，不等于平台最终规则。侵权、物流限制和平台禁售规则仍然必须人工复核。
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          {buttonText}
        </button>
      </div>

      {loading ? (
        <p className="mb-4 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-indigo-700">
          AI 正在分析商品、利润和平台适配度...
        </p>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!hasAnalysis && !loading ? (
        <div className="mb-4 rounded-xl border border-dashed border-indigo-200 bg-white/70 p-3 text-sm leading-6 text-slate-600">
          当前还没有真实 AI 分析结果。填写商品名称和成本信息后，可以点击按钮调用服务端接口生成。
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border border-dashed border-indigo-200 bg-white/70 p-3 text-sm leading-6 text-slate-600">
        当前商品：{form.name.trim() || "未填写商品名称"} ｜ 平台：{listingData.targetPlatform} ｜ 国家：{listingData.targetCountry || "未填写目标国家"}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-500">推荐结论</p>
          {analysis ? (
            <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-sm font-bold ${recommendationClasses[analysis.recommendation]}`}>
              {recommendationLabels[analysis.recommendation]}
            </span>
          ) : (
            <p className="mt-1 text-sm leading-6 text-slate-500">待生成</p>
          )}
        </div>
        <InfoRow label="综合评分" value={analysis ? `${analysis.score}/100` : "待生成"} />
        <ListBlock label="推荐理由" items={analysis?.reasons} />
        <ListBlock label="风险点" items={analysis?.risks} />
        <ListBlock label="目标人群" items={analysis?.targetAudience} />
        <ListBlock label="使用场景" items={analysis?.scenarios} />
        <InfoRow label="平台适配度" value={pendingText(analysis?.platformFit)} />
        <InfoRow label="物流风险" value={pendingText(analysis?.logisticsRisk)} />
        <InfoRow label="售后风险" value={pendingText(analysis?.afterSalesRisk)} />
        <InfoRow label="侵权风险" value={pendingText(analysis?.infringementRisk)} />
        <InfoRow label="敏感品类风险" value={pendingText(analysis?.sensitiveCategoryRisk)} />
        <InfoRow label="是否适合新手" value={analysis ? pendingText(analysis.newbieFriendly) : "待生成"} />
      </div>
    </section>
  );
}
