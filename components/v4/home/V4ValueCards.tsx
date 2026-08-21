"use client";

/**
 * V4.1 — 四张核心价值卡（文案按契约 §1.A / §4，无夸大）。
 */

export const V4_VALUE_CARDS = [
  {
    key: "evidence",
    title: "Evidence，而不是无来源答案",
    desc: "研究结论与证据、来源和缺口一一对应；没有来源的推断不作为答案。",
  },
  {
    key: "fact",
    title: "SupplierClaim 不自动成为产品事实",
    desc: "供应商声明需经事实核验与人工确认，才进入产品事实。",
  },
  {
    key: "human",
    title: "AI 提建议，人做商业决策",
    desc: "AI 整理证据与方案；继续、修改或放弃由你决定。",
  },
  {
    key: "content",
    title: "Listing/Image 只能读取已确认事实",
    desc: "内容草稿只引用已确认的产品事实，不夸大、不编造。",
  },
] as const;

export function V4ValueCards() {
  return (
    <section data-testid="v4-value-cards" aria-labelledby="v4-value-cards-title" className="surface-card p-5 sm:p-6">
      <p className="linear-kicker">核心价值</p>
      <h2 id="v4-value-cards-title" className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
        证据与人工决策，贯穿每一步
      </h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {V4_VALUE_CARDS.map((card) => (
          <article
            key={card.key}
            data-testid={"v4-value-card-" + card.key}
            className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4"
          >
            <h3 className="text-base font-semibold text-slate-950">{card.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{card.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
