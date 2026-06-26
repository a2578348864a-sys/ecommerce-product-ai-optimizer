"use client";

import { useState } from "react";
import { buildFallbackListingPack, listingPackToMarkdown, type ListingPack } from "@/lib/listingPack";

export function ListingPackCard({
  productName,
  resultJson,
  riskReviewSnapshot,
  profitSnapshot,
  disabled,
  onGenerated,
}: {
  productName?: string | null;
  resultJson?: unknown;
  riskReviewSnapshot?: unknown;
  profitSnapshot?: unknown;
  disabled?: boolean;
  onGenerated?: (pack: ListingPack) => void;
}) {
  const [pack, setPack] = useState<ListingPack | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      // Simulate brief processing time for UX
      await new Promise(r => setTimeout(r, 600));
      const result = buildFallbackListingPack({
        productName,
        resultJson,
        riskReviewSnapshot,
        profitSnapshot,
      });
      setPack(result);
      onGenerated?.(result);
    } catch {
      setError("生成失败，请稍后重试。");
    } finally {
      setGenerating(false);
    }
  }

  function handleCopy() {
    if (!pack) return;
    const md = listingPackToMarkdown(pack);
    navigator.clipboard.writeText(md).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (disabled) {
    return (
      <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="listing-pack-disabled">
        <div className="flex items-start gap-3">
          <span className="text-xl">📝</span>
          <div>
            <h3 className="text-base font-bold text-slate-600">AI Listing 包</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              该候选不建议继续推进，暂不推荐生成 Listing 包。如需生成草稿仅供参考，请确认风险后操作。
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-2xl border border-indigo-200 bg-white p-4" data-testid="listing-pack">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-indigo-900">AI Listing 包</h3>
          <p className="mt-0.5 text-sm text-indigo-500">基于当前商品分析整理 Listing 准备材料。当前为规则草稿，发布前必须人工复核，不会自动上架。</p>
        </div>
        {pack && (
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">规则草稿</span>
            <span className="text-xs text-slate-400">发布前必须人工复核</span>
          </div>
        )}
      </div>

      {!pack ? (
        <div className="mt-4">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition"
            data-testid="listing-pack-generate"
          >
            {generating ? "生成中…" : "生成 AI Listing 包"}
          </button>
          <p className="mt-2 text-xs text-slate-400">当前为规则兜底草稿，用于快速整理上架准备材料。不会调用真实 AI，不会自动上架。</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Title drafts */}
          <div>
            <p className="text-sm font-bold text-slate-700">标题草稿</p>
            <ul className="mt-1 space-y-1">
              {pack.titleDrafts.map((t, i) => (
                <li key={i} className="text-sm text-slate-600">- {t}</li>
              ))}
            </ul>
          </div>

          {/* Bullet points */}
          <div>
            <p className="text-sm font-bold text-slate-700">五点描述</p>
            <ol className="mt-1 space-y-1">
              {pack.bulletPoints.map((b, i) => (
                <li key={i} className="flex gap-1.5 text-sm leading-6 text-slate-600">
                  <span className="font-semibold text-indigo-500">{i + 1}.</span>
                  <span>{b}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Keywords */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-sm font-bold text-slate-700">核心关键词</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {pack.coreKeywords.map(k => (
                  <span key={k.keyword} className="rounded-full border border-teal-100 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">{k.keyword}</span>
                ))}
              </div>
            </div>
            {pack.longTailKeywords.length > 0 && (
              <div>
                <p className="text-sm font-bold text-slate-700">长尾关键词</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {pack.longTailKeywords.map(k => (
                    <span key={k.keyword} className="rounded-full border border-slate-100 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">{k.keyword}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Risk terms */}
          <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
            <p className="text-sm font-bold text-rose-700">风险用词提醒</p>
            <div className="mt-1.5 space-y-1">
              {pack.riskTerms.slice(0, 6).map(r => (
                <p key={r.term} className="text-xs leading-5 text-rose-600">
                  ⚠️ <span className="font-semibold">{r.term}</span>：{r.reason} → 建议：{r.saferAlternative}
                </p>
              ))}
            </div>
          </div>

          {/* Price + images collapsed */}
          <details className="rounded-xl border border-slate-100 bg-white p-3">
            <summary className="cursor-pointer text-sm font-bold text-slate-700 select-none">价格建议与图片需求</summary>
            <div className="mt-2 space-y-2">
              <p className="text-sm leading-6 text-slate-600">{pack.priceSuggestion}</p>
              <ul className="space-y-0.5">
                {pack.imageRequirements.map((r, i) => (
                  <li key={i} className="text-xs text-slate-500">- {r}</li>
                ))}
              </ul>
            </div>
          </details>

          {/* Checklist collapsed */}
          <details className="rounded-xl border border-amber-100 bg-amber-50/30 p-3">
            <summary className="cursor-pointer text-sm font-bold text-amber-700 select-none">上架前检查清单（{pack.prePublishChecklist.length} 项）</summary>
            <div className="mt-2 space-y-1">
              {pack.prePublishChecklist.map((c, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs leading-5 text-amber-700">
                  <span className="mt-0.5 text-amber-400">☐</span>
                  <span>{c}</span>
                </div>
              ))}
            </div>
          </details>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 transition"
              data-testid="listing-pack-copy"
            >
              {copied ? "已复制" : "复制 Markdown"}
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              重新生成
            </button>
          </div>

          <p className="text-xs text-slate-400">{pack.disclaimer}</p>
        </div>
      )}

      {error && <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p>}
    </section>
  );
}
