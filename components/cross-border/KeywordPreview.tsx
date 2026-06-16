"use client";

import type {
  CrossBorderProductFormInput,
  KeywordGenerationResult,
  StructuredListingData,
} from "@/lib/types";

type KeywordPreviewProps = {
  form: CrossBorderProductFormInput;
  listingData: StructuredListingData;
  keywords?: KeywordGenerationResult | null;
  loading?: boolean;
  error?: string | null;
  onGenerate?: () => void;
};

function KeywordGroup({
  title,
  items,
  tone = "default",
}: {
  title: string;
  items?: string[];
  tone?: "default" | "risk" | "muted";
}) {
  const hasItems = Boolean(items?.length);
  const badgeClass = tone === "risk"
    ? "border-red-200 bg-red-50 text-red-700"
    : tone === "muted"
      ? "border-slate-200 bg-slate-50 text-slate-600"
      : "border-cyan-100 bg-cyan-50 text-cyan-800";

  return (
    <div className="surface-card-soft rounded-[22px] p-3">
      <p className="text-sm font-bold text-slate-950">{title}</p>
      {hasItems ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {items?.map((item) => (
            <span key={item} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-500">暂无</p>
      )}
    </div>
  );
}

export function KeywordPreview({
  form,
  listingData,
  keywords,
  loading = false,
  error = null,
  onGenerate,
}: KeywordPreviewProps) {
  const hasKeywords = Boolean(keywords);
  const buttonLabel = loading
    ? "关键词生成中..."
    : hasKeywords
      ? "重新生成关键词"
      : "生成关键词";

  return (
    <section className="surface-card rounded-[28px] p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-cyan-700">关键词生成</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">
            {hasKeywords ? "英文关键词结果" : "关键词待生成"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            关键词仅供上架运营参考。品牌词、侵权词、平台禁限词必须人工复核，风险词不要直接混进推荐关键词里。
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="glass-button-primary inline-flex h-10 shrink-0 items-center justify-center px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      </div>

      {loading ? (
        <p className="mb-4 rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm text-cyan-700">
          AI 正在根据商品、平台和利润信息生成关键词...
        </p>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!hasKeywords && !loading ? (
        <div className="mb-4 rounded-lg border border-dashed border-cyan-200 bg-white px-3 py-2 text-sm leading-6 text-slate-600">
          当前还没有真实关键词结果。填写商品名称和成本信息后，可以点击按钮调用服务端接口生成。
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border border-dashed border-cyan-200 bg-white/70 p-3 text-sm leading-6 text-slate-600">
        输入来源：{form.name.trim() || "未填写商品名称"} ｜ SKU：{listingData.sku}
      </div>

      <div className="grid gap-3">
        <KeywordGroup title="核心关键词" items={keywords?.coreKeywords} />
        <KeywordGroup title="长尾关键词" items={keywords?.longTailKeywords} />
        <KeywordGroup title="搜索词" items={keywords?.searchTerms} />
        <KeywordGroup title="标题关键词" items={keywords?.titleKeywords} />
        <KeywordGroup title="卖点关键词" items={keywords?.sellingPointKeywords} />
        <KeywordGroup title="风险词提醒" items={keywords?.riskWords} tone="risk" />
        <KeywordGroup title="排除词" items={keywords?.negativeKeywords} tone="muted" />
      </div>

      <div className="mt-3 rounded-xl border border-cyan-100 bg-white p-3">
        <p className="text-sm font-bold text-slate-950">平台关键词建议</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {keywords?.platformNotes || "暂无"}
        </p>
      </div>
    </section>
  );
}
