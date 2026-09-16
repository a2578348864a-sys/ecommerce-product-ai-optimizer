"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * 公网 HR 演示首页（public_showcase 模式，匿名与访客一致）。
 * 一句话定位 + 唯一主按钮 + 简洁流程 + 四项核心价值 + 产品边界。
 */

const STEPS = [
  { title: "定位商品", desc: "从真实候选商品开始，AI 只做资料整理。" },
  { title: "收集证据", desc: "商品概览、关键词、竞品、评论与供应线索。" },
  { title: "AI 小结", desc: "AI 结论带证据引用，缺什么如实标注。" },
  { title: "人工决定", desc: "关键商业决定由你拍板，系统不自动上架。" },
];

const VALUES = [
  { title: "市场机会", desc: "关键词、销量估算与竞争环境。" },
  { title: "买家需求", desc: "真实评论里提炼的喜好与痛点。" },
  { title: "供应匹配", desc: "货源线索与采购条件核实。" },
  { title: "成本风险", desc: "从证据出发的风险提示，而非财务测算。" },
];

export function PublicShowcaseHome() {
  return (
    <main data-testid="showcase-home" className="mx-auto max-w-4xl px-4 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">轻选工作台</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
          帮你把「这个产品能不能做」整理成一份可核对的证据集
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          AI 收集并整理商品市场、买家需求、供应与风险证据；商业决定始终由你拍板。
        </p>
        <div className="mt-6">
          <Link
            href="/replay"
            data-testid="showcase-primary-cta"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-teal-600 px-6 text-sm font-semibold text-white hover:bg-teal-700"
          >
            查看完整商品案例
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section data-testid="showcase-workflow" className="mt-6">
        <h2 className="text-base font-bold text-slate-900">研究流程</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <div key={step.title} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold text-teal-700">步骤 {index + 1}</p>
              <p className="mt-1 text-sm font-bold text-slate-900">{step.title}</p>
              <p className="mt-1 text-sm text-slate-600">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section data-testid="showcase-values" className="mt-6">
        <h2 className="text-base font-bold text-slate-900">四项核心价值</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map((value) => (
            <div key={value.title} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-slate-900">{value.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{value.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section data-testid="showcase-boundary" className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">产品边界</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>AI 只整理已有证据，不创作事实；缺失信息如实标注。</li>
          <li>结论与数据仅供研究参考，不构成上架或投资建议。</li>
          <li>最终决定由人工完成；系统不会自动发布商品。</li>
        </ul>
      </section>
    </main>
  );
}
