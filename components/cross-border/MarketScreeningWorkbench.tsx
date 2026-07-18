"use client";

import Link from "next/link";
import { ChevronDown, ImageOff, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  EvidenceField,
  MarketScreeningBatchHealthView,
  MarketScreeningBriefView,
  MarketScreeningSourceView,
  MarketScreeningWorkbenchRenderModel,
  MarketScreeningWorkbenchView,
} from "@/lib/marketScreeningWorkbench";

function assertNever(value: never): never {
  throw new Error(`Unhandled market screening state: ${JSON.stringify(value)}`);
}

function evidenceNote(field: EvidenceField<unknown>) {
  return field.value === null
    ? `缺失：${field.missingReason ?? "未说明"}`
    : `来源 ${field.source} · ${field.capturedAt ?? "时间未记录"} · ${field.confidence}`;
}

function BriefRegion({ brief, embedded = false }: { brief: MarketScreeningBriefView; embedded?: boolean }) {
  return (
    <section className={embedded ? "p-5 sm:p-6" : "surface-card p-5"} data-region="selection-brief">
      <p className="text-xs font-semibold text-teal-700">调查范围</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-950">调查目标与硬边界</h2>
      <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["平台", brief.marketplace.value, evidenceNote(brief.marketplace)],
          ["市场", brief.market.value, evidenceNote(brief.market)],
          ["查询词", brief.query.value, evidenceNote(brief.query)],
          ["目标场景", brief.targetScenario.value, evidenceNote(brief.targetScenario)],
          [
            "价格范围",
            brief.priceRange.value
              ? `${brief.priceRange.value.currency} ${brief.priceRange.value.min}–${brief.priceRange.value.max}`
              : null,
            evidenceNote(brief.priceRange),
          ],
        ].map(([label, value, note]) => (
          <div key={label}>
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value ?? "未记录"}</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">{note}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">必需证据</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">{brief.requiredEvidence.join(" · ") || "未声明"}</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">硬排除项</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">{brief.hardExclusions.join(" · ") || "未声明"}</p>
        </div>
      </div>
    </section>
  );
}

function SourcesRegion({ sources, embedded = false }: { sources: MarketScreeningSourceView[]; embedded?: boolean }) {
  return (
    <section className={embedded ? "border-t border-slate-200 p-5 sm:p-6" : "surface-card p-5"} data-region="source-health">
      <p className="text-xs font-semibold text-teal-700">来源健康</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-950">采集与适配结果</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {sources.map((source) => (
          <article key={source.sourceBatchId} className="border-t border-slate-200 pt-3 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-900">{source.sourceId}</p>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                {source.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">接受 {source.acceptedCount} · 隔离 {source.quarantinedCount}</p>
            <p className="mt-1 break-all text-xs text-slate-400">{source.sourceBatchId}</p>
            <p className="mt-1 text-xs text-slate-400">
              {source.reasonCodes.length > 0 ? source.reasonCodes.join(" · ") : "无来源错误码"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function detailStatusLabel(status: MarketScreeningBatchHealthView["optionalDetailStatus"]) {
  if (status === "verified") return "可选详情证据：已验证";
  if (status === "incomplete_omitted") return "可选详情证据：不完整，已整体省略";
  return "可选详情证据：未附加";
}

function HealthSummary({ health }: { health: MarketScreeningBatchHealthView }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ["唯一商品", health.acceptedUniqueProductCount],
        ["本地图片", health.imageAvailableCount],
        ["图片未缓存", health.imageNotCachedCount],
        ["详情组", detailStatusLabel(health.optionalDetailStatus)],
      ].map(([label, value]) => (
        <div key={label} className="border-t border-slate-200 pt-3 first:border-t-0 first:pt-0 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0 sm:first:border-l-0 sm:first:pl-0">
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
        </div>
      ))}
    </div>
  );
}

function screeningStatusMeta(status: string) {
  if (status === "advance") return { label: "继续调查", className: "border-teal-200 bg-teal-50 text-teal-800" };
  if (status === "watch") return { label: "暂时观察", className: "border-amber-200 bg-amber-50 text-amber-800" };
  if (status === "reject") return { label: "不建议继续", className: "border-slate-200 bg-slate-100 text-slate-700" };
  return { label: "证据不足", className: "border-rose-200 bg-rose-50 text-rose-800" };
}

function ReadyWorkbench({ view, partial }: { view: MarketScreeningWorkbenchView; partial: boolean }) {
  const [statusFilter, setStatusFilter] = useState("advance");
  const summaryCounts = [
    ["继续调查", view.stage15Summary.advance, "text-teal-800"],
    ["暂时观察", view.stage15Summary.watch, "text-amber-800"],
    ["不建议继续", view.stage15Summary.reject, "text-slate-800"],
    ["证据不足", view.stage15Summary.insufficient, "text-rose-800"],
  ] as const;
  const filterOptions = [
    ["advance", "只看继续调查", view.stage15Summary.advance],
    ["all", "全部商品", view.items.length],
    ["watch", "暂时观察", view.stage15Summary.watch],
    ["reject", "不建议继续", view.stage15Summary.reject],
    ["insufficient", "证据不足", view.stage15Summary.insufficient],
  ] as const;
  const filteredItems = useMemo(
    () => statusFilter === "all" ? view.items : view.items.filter((item) => item.status === statusFilter),
    [statusFilter, view.items],
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section className="surface-card-strong overflow-hidden" data-region="screening-summary">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]">
          <div className="p-5 sm:p-7">
            <p className="text-sm font-semibold text-teal-700">预筛已完成</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              {view.stage1Summary.inputCount} 个商品已完成初筛
            </h2>
            <p className="mt-3 text-base leading-7 text-slate-600">
              建议继续调查 {view.stage15Summary.advance} 个，还不是商业候选。
            </p>
            {partial ? (
              <p className="mt-3 text-sm font-semibold text-amber-700">部分来源失败，结果仅用于受限预筛</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 border-t border-slate-200 bg-slate-50/70 lg:border-l lg:border-t-0">
            {summaryCounts.map(([label, value, tone]) => (
              <div key={label} className="border-b border-r border-slate-200 p-4 last:border-b-0 sm:p-5">
                <p className="text-xs font-semibold text-slate-500">{label}</p>
                <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <details className="surface-card overflow-hidden" data-testid="screening-run-details">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-slate-700 sm:px-6">
          <span className="inline-flex min-w-0 items-center gap-2"><ChevronDown className="details-chevron size-4 shrink-0" />查看本批调查范围与运行信息</span>
          <span className="hidden truncate text-xs font-normal text-slate-400 sm:block">批次 {view.manifestId}</span>
        </summary>
        <div className="border-t border-slate-200">
          <BriefRegion brief={view.brief} embedded />
          <SourcesRegion sources={view.sourceRuns} embedded />

          <section className="border-t border-slate-200 p-5 sm:p-6" data-region="evidence-quality">
            <p className="text-xs font-semibold text-teal-700">证据质量</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">证据完整度与门禁</h2>
            <div className="mt-4"><HealthSummary health={view.batchHealth} /></div>
            <p className="mt-4 text-sm leading-6 text-slate-500">
              质量门禁通过 {view.gateSummary.qualityPassedCount} · 最小证据包通过 {view.gateSummary.minimumEvidencePassedCount}
              · 证据不足 {view.gateSummary.insufficientCount}
              {view.gateSummary.reasonCodes.length > 0 ? ` · ${view.gateSummary.reasonCodes.join(" · ")}` : ""}
            </p>
          </section>

          <section className="border-t border-slate-200 p-5 sm:p-6" data-region="stage-1">
            <p className="text-xs font-semibold text-teal-700">初筛结果</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">确定性排序结果</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              输入 {view.stage1Summary.inputCount} · 进入下一轮 {view.stage1Summary.promoted} · 淘汰 {view.stage1Summary.rejected}
              · 证据不足 {view.stage1Summary.insufficientEvidence}
            </p>
            <p className="mt-1 break-all text-xs text-slate-400">
              {view.stage1Summary.rankingRunId} · {view.stage1Summary.ruleVersion}
            </p>
          </section>
        </div>
      </details>

      <section data-region="stage-1-5">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <p className="text-sm font-semibold text-teal-700">商品结果</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">先处理值得继续调查的商品</h2>
            <p className="mt-2 text-sm text-slate-500">先看状态和关键数据，需要时再展开判断依据。</p>
            {partial ? (
              <p className="mt-2 text-sm font-semibold text-amber-700">部分来源失败，结果仅用于受限预筛</p>
            ) : null}
          </div>
          <span className="text-xs text-slate-400">{detailStatusLabel(view.batchHealth.optionalDetailStatus)}</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="商品状态筛选">
          <SlidersHorizontal className="mr-1 size-4 text-slate-400" aria-hidden="true" />
          {filterOptions.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={statusFilter === value}
              onClick={() => setStatusFilter(value)}
              className={statusFilter === value
                ? "inline-flex h-11 items-center whitespace-nowrap rounded-full border border-teal-200 bg-teal-50 px-3 text-sm font-semibold text-teal-800"
                : "inline-flex h-11 items-center whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:border-slate-300"}
            >
              {label} · {count}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => {
            const status = screeningStatusMeta(item.status);
            return (
              <article
                key={item.productKey}
                data-testid="market-screening-item"
                className="market-product-card overflow-hidden rounded-2xl border border-slate-200 bg-white"
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-slate-100">
                  {item.image.status === "available" && item.image.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image.dataUrl} alt={item.title.value ?? item.asin} className="size-full object-contain" />
                  ) : (
                    <div className="px-4 text-center text-slate-400">
                      <ImageOff className="mx-auto size-6" aria-hidden="true" />
                      <p className="mt-2 text-sm font-semibold">{item.image.status === "image_integrity_failed" ? "图片校验失败" : "暂无本地图片"}</p>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="text-xs text-slate-400">{item.asin}</span>
                  </div>
                  <h3 className="mt-3 line-clamp-3 text-base font-semibold leading-6 text-slate-950">
                    {item.title.value ?? "标题缺失"}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">{evidenceNote(item.title)}</p>
                  <dl className="mt-4 grid grid-cols-3 divide-x divide-slate-200 border-y border-slate-200 py-3 text-center">
                    <div>
                      <dt className="text-xs text-slate-400">价格</dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-800">
                        {item.price.value ? `${item.price.value.currency} ${item.price.value.amount}` : "缺失"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">评分</dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-800">{item.rating.value ?? "缺失"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">评论数</dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-800">{item.reviewCount.value ?? "缺失"}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                    <p className="font-semibold text-slate-800">下一步验证</p>
                    <p className="mt-1">{item.nextActions.slice(0, 2).join(" · ") || "等待人工指定"}</p>
                  </div>
                  <details className="mt-2 border-t border-slate-100 pt-3">
                    <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-slate-600"><ChevronDown className="details-chevron size-4" />查看判断依据与详情证据</summary>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      {item.reasonCodes.slice(0, 3).join(" · ") || "无额外原因码"}
                    </p>
                    {item.features.value ? (
                      <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                        {item.features.value.slice(0, 3).map((feature) => <li key={feature}>- {feature}</li>)}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">{item.features.missingReason}</p>
                    )}
                  </details>
                  {item.status === "advance" ? (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <Link
                        href={`/agent/run?productName=${encodeURIComponent(item.title.value ?? item.asin)}`}
                        className="linear-button-primary inline-flex h-10 w-full items-center justify-center whitespace-nowrap px-4 text-sm font-semibold"
                      >
                        带入临时分析
                      </Link>
                      <p className="mt-2 text-center text-xs text-slate-400">只带入商品名，不会创建候选或任务</p>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <details className="surface-card-soft p-5" data-region="advanced-import-history">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-slate-700"><ChevronDown className="details-chevron size-4" />更多入口</summary>
        <h2 className="mt-3 text-lg font-semibold text-slate-950">其他入口</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          手工 URL、RSS、Sitemap 导入与历史候选仍保留，但不能绕过证据门禁。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/opportunities/import" className="linear-button-soft inline-flex h-10 items-center px-4 text-sm font-semibold">
            高级手工导入
          </Link>
        </div>
      </details>
    </div>
  );
}

export function MarketScreeningWorkbench({ model }: { model: MarketScreeningWorkbenchRenderModel }) {
  switch (model.status) {
    case "ready":
      return <ReadyWorkbench view={model.view} partial={model.readiness === "ready_partial"} />;
    case "upstream_only":
      return (
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          <section className="surface-card border-amber-200 bg-amber-50/60 p-5">
            <p className="text-sm font-semibold text-amber-700">工作台状态</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">来源证据可用，初筛尚未完成</h2>
            <p className="mt-2 text-sm text-slate-600">暂不展示排名、调查分区或商品卡。</p>
          </section>
          <BriefRegion brief={model.view.brief} />
          <SourcesRegion sources={model.view.sourceRuns} />
          <section className="surface-card p-5">
            <p className="text-sm font-semibold text-teal-700">批次健康</p>
            <div className="mt-4"><HealthSummary health={model.view.batchHealth} /></div>
          </section>
        </div>
      );
    case "blocked":
      return (
        <section className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-rose-700">批次已阻断</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">证据身份或完整性未通过</h1>
          <p className="mt-3 break-all text-sm text-slate-600">错误码：{model.errorCode}</p>
          <p className="mt-2 text-sm text-slate-500">{model.reasonCodes.join(" · ")}</p>
        </section>
      );
    default:
      return assertNever(model);
  }
}
