"use client";

import { PublicCaseImage } from "./PublicCaseImage";
import type { PublicShowcaseCase } from "@/lib/public-showcase/case";

/** 公网「完整商品研究案例」页：真实 THERMOS 案例脱敏展示（用户语言，无技术噪声）。 */
export function PublicCasePage({ data }: { data: PublicShowcaseCase }) {
  return (
    <main data-testid="showcase-case" className="mx-auto max-w-4xl px-4 py-8">
      {/* 商品英雄区 */}
      <section data-testid="showcase-case-hero" className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <PublicCaseImage src={data.image.src} alt={data.image.alt} className="h-52 w-full sm:h-56" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-400">完整商品研究案例</p>
          <h1 className="mt-1 break-words text-xl font-bold leading-7 text-slate-950">{data.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-slate-200 px-2 py-0.5 font-medium text-slate-600">{data.market}</span>
            <span className="rounded-full border border-slate-200 px-2 py-0.5 font-medium text-slate-600">ASIN {data.asin}</span>
          </div>
          <p data-testid="showcase-case-conclusion" className="mt-3 text-sm font-semibold text-teal-700">{data.conclusion}</p>
          <p className="mt-1 text-xs text-slate-500">{data.sourceNote}</p>
        </div>
      </section>

      {/* 商品概览 */}
      <section data-testid="showcase-overview" className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-bold text-slate-900">商品概览</h2>
        <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {data.overviewSummary.fields.map((field, index) => (
            <div key={index} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 text-sm">
              <span className="text-slate-500">{field.label}</span>
              <span className="text-right font-medium text-slate-900">{field.value}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">{data.overviewSummary.note}</p>
      </section>

      {/* 关键词与竞品 */}
      <Section title="关键词" testid="showcase-keywords">
        <p className="text-sm text-slate-600">{data.keywords.source} · {data.keywords.count} 个关键词</p>
        <p className="mt-1 text-xs text-slate-500">{data.keywords.note}</p>
        <div className="mt-3 hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1.5 pr-2 font-medium">关键词</th>
                <th className="px-2 py-1.5 font-medium">类别</th>
                <th className="px-2 py-1.5 font-medium">月搜索量</th>
                <th className="px-2 py-1.5 font-medium">购买量</th>
                <th className="px-2 py-1.5 font-medium">竞争度</th>
              </tr>
            </thead>
            <tbody>
              {data.keywords.rows.map((row, index) => (
                <tr key={index} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2 font-medium text-slate-900">{row.keyword}{row.translation ? "（" + row.translation + "）" : ""}</td>
                  <td className="px-2 py-1.5 text-slate-600">{row.category}</td>
                  <td className="px-2 py-1.5 text-slate-700">{row.monthly ?? "尚未取得"}</td>
                  <td className="px-2 py-1.5 text-slate-700">{row.purchase ?? "尚未取得"}</td>
                  <td className="px-2 py-1.5 text-slate-700">{row.competition ?? "尚未取得"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div data-testid="showcase-keywords-cards" className="mt-3 space-y-3 sm:hidden">
          {data.keywords.rows.map((row, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 break-words">{row.keyword}{row.translation ? "（" + row.translation + "）" : ""}</p>
                <p className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">{row.category}</p>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <p className="text-slate-500">月搜索量<br /><span className="font-medium text-slate-800">{row.monthly ?? "尚未取得"}</span></p>
                <p className="text-slate-500">购买量<br /><span className="font-medium text-slate-800">{row.purchase ?? "尚未取得"}</span></p>
                <p className="text-slate-500">竞争度<br /><span className="font-medium text-slate-800">{row.competition ?? "尚未取得"}</span></p>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="竞品" testid="showcase-competitors">
        <p className="text-sm text-slate-600">{data.competitors.note}</p>
        <ul className="mt-3 space-y-2">
          {data.competitors.rows.map((row, index) => (
            <li key={index} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{row.name}</span>
                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-500">{row.category}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">ASIN {row.asin} · 相邻替代商品，不代表直接竞品。</p>
            </li>
          ))}
        </ul>
      </Section>
      {/* 市场机会 */}
      <Section title="市场机会" testid="showcase-module-market">
        <Bullets items={[...data.marketModule.story, ...data.marketModule.estimates]} label="结论与观察" />
        <Gaps items={data.marketModule.gaps} />
      </Section>

      {/* 买家需求与差评 */}
      <Section title="买家需求与差评" testid="showcase-module-buyers">
        <p className="text-sm text-slate-600">
          评论样本 {data.buyerDemand.sampleCount} 条 · {data.buyerDemand.starNote}
        </p>
        <Bullets items={data.buyerDemand.positive} label="买家喜好" />
        <Bullets items={data.buyerDemand.pain} label="痛点" />
        <Bullets items={data.buyerDemand.scenes} label="使用场景" />
        <Bullets items={data.buyerDemand.weak} label="弱信号" />
              </Section>

      {/* 货源与商品匹配 */}
      <Section title="货源与商品匹配" testid="showcase-module-sourcing">
        <Bullets items={data.supplyMatch.content} label="供应线索" />
        <p className="mt-2 text-sm text-amber-700">{data.supplyMatch.confirmation}</p>
        <Gaps items={data.supplyMatch.gaps} />
      </Section>

      {/* 成本与风险 */}
      <Section title="成本与风险" testid="showcase-module-costrisk">
        <Bullets items={data.costRisk.risks} label="风险提示" />
        <p className="mt-2 text-xs text-slate-500">{data.costRisk.note}</p>
        <Gaps items={data.costRisk.gaps} />
      </Section>

      {/* 人工决定 */}
      <Section title="人工决定" testid="showcase-decision">
        <p className="text-sm text-slate-700">
          决定：<span className="font-semibold text-teal-700">{data.humanDecision.label}</span>
          {" · 理由：" + data.humanDecision.reason + " · 时间：" + data.humanDecision.decidedAt}
        </p>
      </Section>

      {/* Listing 与图片结果 */}
      <Section title="Listing 与图片结果" testid="showcase-listing">
        <div className="mt-0 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p data-testid="showcase-listing-status" className="text-sm font-semibold text-amber-800">{data.listing.status}</p>
          <p className="mt-1 text-xs leading-5 text-amber-700">{data.listing.note}</p>
          <p className="mt-3 text-xs font-semibold text-slate-700">暂未通过的原因（尚未补齐的确认事实）</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-800">
            {data.listing.missingFacts.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
          <p className="mt-3 text-xs font-semibold text-slate-700">历史草稿原始搜索词（含重复，未通过质量校验）</p>
          <p className="mt-1 text-xs text-slate-600">{data.listing.keywords.join(" · ")}</p>
          <p className="mt-1 text-xs text-slate-500">{data.listing.keywordsSource}</p>
        </div>
        <div className="mt-4 space-y-2">
          {data.imageCheck.items.map((item, index) => (
            <div key={index} className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <span className="font-medium text-slate-900">图片草稿（{item.type}）</span>
              <span className="text-slate-500">{item.size}</span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{item.status}</span>
            </div>
          ))}
          <p className="text-xs text-slate-400">{data.imageCheck.disclaimer}</p>
        </div>
      </Section>
    </main>
  );
}

function Section({ title, testid, children }: { title: string; testid: string; children: React.ReactNode }) {
  return (
    <section data-testid={testid} className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Bullets({ items, label }: { items: string[]; label: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </div>
  );
}

function Gaps({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
      <p className="text-xs font-semibold text-amber-800">尚缺（未取得，不用 AI 填补）</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-800">
        {items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </div>
  );
}
