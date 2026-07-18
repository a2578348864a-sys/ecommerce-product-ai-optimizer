import Link from "next/link";
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

function BriefRegion({ brief }: { brief: MarketScreeningBriefView }) {
  return (
    <section className="surface-card p-5" data-region="selection-brief">
      <p className="eyebrow">Selection Brief</p>
      <h2 className="mt-1 text-xl font-semibold text-slate-950">调查目标与硬边界</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
          <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 break-words text-sm font-bold text-slate-900">{value ?? "未记录"}</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">{note}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-3">
          <p className="text-sm font-semibold text-teal-800">必需证据</p>
          <p className="mt-1 text-sm leading-6 text-teal-700">{brief.requiredEvidence.join(" · ") || "未声明"}</p>
        </div>
        <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3">
          <p className="text-sm font-semibold text-rose-800">硬排除项</p>
          <p className="mt-1 text-sm leading-6 text-rose-700">{brief.hardExclusions.join(" · ") || "未声明"}</p>
        </div>
      </div>
    </section>
  );
}

function SourcesRegion({ sources }: { sources: MarketScreeningSourceView[] }) {
  return (
    <section className="surface-card p-5" data-region="source-health">
      <p className="eyebrow">来源健康</p>
      <h2 className="mt-1 text-xl font-semibold text-slate-950">采集与适配结果</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {sources.map((source) => (
          <article key={source.sourceBatchId} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-900">{source.sourceId}</p>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
                {source.status}
              </span>
            </div>
            <p className="mt-2 break-all text-xs text-slate-400">{source.sourceBatchId}</p>
            <p className="mt-3 text-sm text-slate-600">
              接受 {source.acceptedCount} · 隔离 {source.quarantinedCount}
            </p>
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
        <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-1 text-base font-bold text-slate-900">{value}</p>
        </div>
      ))}
    </div>
  );
}

function ReadyWorkbench({ view, partial }: { view: MarketScreeningWorkbenchView; partial: boolean }) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <section className="surface-card border-teal-200 bg-teal-50/50 p-5" data-region="workbench-status">
        <p className="eyebrow">工作台状态</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">市场预筛工作台</h1>
            <p className="mt-2 text-sm text-slate-600">
              冻结批次 {view.manifestId} · {view.batchReadiness.status} · 只读证据投影
            </p>
            {partial ? (
              <p className="mt-2 font-semibold text-amber-700">部分来源失败，结果仅用于受限预筛</p>
            ) : null}
          </div>
          <span className="rounded-full border border-teal-200 bg-white px-3 py-1 text-sm font-semibold text-teal-700">
            frozen_validation_batch
          </span>
        </div>
      </section>

      <BriefRegion brief={view.brief} />
      <SourcesRegion sources={view.sourceRuns} />

      <section className="surface-card p-5" data-region="evidence-quality">
        <p className="eyebrow">Evidence / Quality Gate</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">证据完整度与门禁</h2>
        <div className="mt-4"><HealthSummary health={view.batchHealth} /></div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
          Quality Gate 通过 {view.gateSummary.qualityPassedCount} · 最小证据包通过 {view.gateSummary.minimumEvidencePassedCount}
          · 证据不足 {view.gateSummary.insufficientCount}
          <span className="ml-2 text-slate-400">
            {view.gateSummary.reasonCodes.length > 0 ? view.gateSummary.reasonCodes.join(" · ") : "无门禁错误码"}
          </span>
        </div>
      </section>

      <section className="surface-card p-5" data-region="stage-1">
        <p className="eyebrow">Stage 1 初筛</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">确定性排序结果</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          输入 {view.stage1Summary.inputCount} · promoted {view.stage1Summary.promoted} · rejected {view.stage1Summary.rejected}
          · insufficient {view.stage1Summary.insufficientEvidence}
        </p>
        <p className="mt-1 break-all text-xs text-slate-400">
          {view.stage1Summary.rankingRunId} · {view.stage1Summary.ruleVersion}
        </p>
      </section>

      <section className="surface-card p-5" data-region="stage-1-5">
        <p className="eyebrow">Stage 1.5 调查短名单</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">最多 5 个继续调查对象，不是商业候选</h2>
            <p className="mt-2 text-sm text-slate-600">
              advance {view.stage15Summary.advance} · watch {view.stage15Summary.watch} · reject {view.stage15Summary.reject}
              · insufficient {view.stage15Summary.insufficient}
            </p>
            {partial ? (
              <p className="mt-2 font-semibold text-amber-700">部分来源失败，结果仅用于受限预筛</p>
            ) : null}
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            {detailStatusLabel(view.batchHealth.optionalDetailStatus)}
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {view.items.map((item) => (
            <article
              key={item.productKey}
              data-testid="market-screening-item"
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
            >
              <div className="flex aspect-[4/3] items-center justify-center bg-slate-100">
                {item.image.status === "available" && item.image.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image.dataUrl} alt={item.title.value ?? item.asin} className="size-full object-contain" />
                ) : (
                  <p className="px-4 text-center text-sm font-semibold text-slate-400">
                    {item.image.status === "image_integrity_failed" ? "图片完整性校验失败" : "图片未缓存"}
                  </p>
                )}
              </div>
              <div className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700">
                    {item.status}
                  </span>
                  <span className="text-xs text-slate-400">{item.asin}</span>
                </div>
                <h3 className="mt-3 line-clamp-3 text-base font-semibold leading-6 text-slate-950">
                  {item.title.value ?? "标题缺失"}
                </h3>
                <p className="mt-1 text-xs text-slate-400">{evidenceNote(item.title)}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-xs text-slate-400">价格</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">
                      {item.price.value ? `${item.price.value.currency} ${item.price.value.amount}` : "缺失"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-xs text-slate-400">评分</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">{item.rating.value ?? "缺失"}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-xs text-slate-400">评论数</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">{item.reviewCount.value ?? "缺失"}</p>
                  </div>
                </div>
                <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-700">功能、材料与详情证据</summary>
                  {item.features.value ? (
                    <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
                      {item.features.value.slice(0, 3).map((feature) => <li key={feature}>- {feature}</li>)}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">{item.features.missingReason}</p>
                  )}
                </details>
                <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3 text-xs leading-5 text-amber-800">
                  <p className="font-semibold">为什么进入当前分区</p>
                  <p className="mt-1">{item.reasonCodes.slice(0, 3).join(" · ") || "无额外原因码"}</p>
                  <p className="mt-2 font-semibold">下一步只验证</p>
                  <p className="mt-1">{item.nextActions.slice(0, 2).join(" · ") || "等待人工指定"}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="surface-card p-5" data-region="advanced-import-history">
        <p className="eyebrow">高级导入 / 历史候选</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">兼容入口仅作补充</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          手工 URL、RSS、Sitemap 导入与历史候选仍保留，但不能绕过 Evidence 与 Quality Gate。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/opportunities/import" className="linear-button-soft inline-flex h-10 items-center px-4 text-sm font-semibold">
            高级手工导入
          </Link>
          <Link href="/opportunities" className="linear-button inline-flex h-10 items-center px-4 text-sm font-semibold">
            查看现有兼容页面
          </Link>
        </div>
      </section>
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
            <p className="eyebrow">工作台状态</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">上游证据可信，Stage 尚未就绪</h1>
            <p className="mt-2 text-sm text-slate-600">不展示排名、Stage 1.5 分区或商品卡。</p>
          </section>
          <BriefRegion brief={model.view.brief} />
          <SourcesRegion sources={model.view.sourceRuns} />
          <section className="surface-card p-5">
            <p className="eyebrow">批次健康</p>
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
